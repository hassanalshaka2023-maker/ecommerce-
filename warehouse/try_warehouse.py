import uuid
from concurrent.futures import ThreadPoolExecutor

import grpc

import warehouse_pb2 as pb
import warehouse_pb2_grpc as rpc

warehouse = rpc.WarehouseStub(grpc.insecure_channel("localhost:50051"))


def stock_of(product_id):
    return warehouse.GetStock(pb.ProductId(product_id=product_id)).quantity


def reserve(order_id, product_id, quantity):
    items = [pb.Stock(product_id=product_id, quantity=quantity)]
    try:
        warehouse.ReserveStock(pb.Reservation(order_id=order_id, items=items))
        return "reserved"
    except grpc.RpcError as error:
        return f"rejected ({error.details()})"


product = str(uuid.uuid4())

print("--- 1. Set and read stock ---")
warehouse.SetStock(pb.Stock(product_id=product, quantity=5))
print("stock:", stock_of(product))

print("--- 2. Reserve 3, then release ---")
order = str(uuid.uuid4())
print(reserve(order, product, 3), "| stock:", stock_of(product))
warehouse.ReleaseStock(pb.OrderId(order_id=order))
print("after release | stock:", stock_of(product))
warehouse.ReleaseStock(pb.OrderId(order_id=order))
print("after release again | stock:", stock_of(product))

print("--- 3. Not enough stock ---")
print(reserve(str(uuid.uuid4()), product, 99))

print("--- 4. Race: 20 orders at once for the last unit ---")
warehouse.SetStock(pb.Stock(product_id=product, quantity=1))
with ThreadPoolExecutor(max_workers=20) as pool:
    results = list(pool.map(lambda _: reserve(str(uuid.uuid4()), product, 1), range(20)))
print("reserved:", results.count("reserved"), "| rejected:", 20 - results.count("reserved"))
print("stock:", stock_of(product))
