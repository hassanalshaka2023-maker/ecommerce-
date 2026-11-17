import os
from concurrent import futures

import grpc
from psycopg_pool import ConnectionPool

import warehouse_pb2 as pb
import warehouse_pb2_grpc as rpc

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/warehouse"
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS stock (
    product_id uuid PRIMARY KEY,
    quantity integer NOT NULL CHECK (quantity >= 0)
);

CREATE TABLE IF NOT EXISTS reservations (
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    PRIMARY KEY (order_id, product_id)
);
"""


pool = ConnectionPool(DATABASE_URL, open=True)

class OutOfStock(Exception):
    pass


class Warehouse(rpc.WarehouseServicer):
    def GetStock(self, request, context):
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT quantity FROM stock WHERE product_id = %s",
                (request.product_id,),
            ).fetchone()
        return pb.Stock(product_id=request.product_id, quantity=row[0] if row else 0)

    def SetStock(self, request, context):
        if request.quantity < 0:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Quantity cannot be negative")
        with pool.connection() as conn:
            conn.execute(
                """INSERT INTO stock (product_id, quantity) VALUES (%s, %s)
                   ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity""",
                (request.product_id, request.quantity),
            )
        return request

    def ReserveStock(self, request, context):
        if any(item.quantity <= 0 for item in request.items):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Quantities must be positive")
        try:
            with pool.connection() as conn:
                # Same order every time, so two orders never wait on each other forever.
                for item in sorted(request.items, key=lambda i: i.product_id):
                    reserved = conn.execute(
                        """UPDATE stock SET quantity = quantity - %s
                           WHERE product_id = %s AND quantity >= %s""",
                        (item.quantity, item.product_id, item.quantity),
                    ).rowcount
                    if reserved == 0:
                        raise OutOfStock(item.product_id)
                    conn.execute(
                        "INSERT INTO reservations (order_id, product_id, quantity) VALUES (%s, %s, %s)",
                        (request.order_id, item.product_id, item.quantity),
                    )
        except OutOfStock as error:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, f"Not enough stock for product {error}")
        return pb.Empty()

    def ReleaseStock(self, request, context):
        with pool.connection() as conn:
            conn.execute(
                """WITH released AS (
                       DELETE FROM reservations WHERE order_id = %s
                       RETURNING product_id, quantity
                   )
                   UPDATE stock SET quantity = stock.quantity + released.quantity
                   FROM released WHERE stock.product_id = released.product_id""",
                (request.order_id,),
            )
        return pb.Empty()



def serve():
    with pool.connection() as conn:
        conn.execute(SCHEMA)

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    rpc.add_WarehouseServicer_to_server(Warehouse(), server)
    server.add_insecure_port("[::]:50051")
    server.start()
    print("Warehouse gRPC server listening on :50051")
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
