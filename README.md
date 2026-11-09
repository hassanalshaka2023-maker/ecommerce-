# Distributed Real-Time E-Commerce Platform — Requirements 1 & 2

- **Requirement 1 — API Design & Security:** the main NestJS API (`backend/`), organized into four modules (Users, Products, Orders, Notifications), backed by PostgreSQL.
- **Requirement 2 — Inter-Service Communication:** a separate inventory service (`inventory-service/`) with its own PostgreSQL database, which the API talks to over **gRPC**.

Everything runs inside Docker.

## Stack

- **Framework:** NestJS 12 (TypeScript, ESM)
- **Database:** PostgreSQL + TypeORM
- **Auth:** JWT (passport-jwt), bcrypt password hashing
- **Docs:** Swagger / OpenAPI (interactive, try-it-out)
- **Service-to-service:** gRPC (`@nestjs/microservices`, `@grpc/grpc-js`), contract in a `.proto` file
- **Containerization:** Docker + Docker Compose

## Running the project

```bash
docker compose up --build
```

This starts four containers:

- `db` — PostgreSQL 16 for the API
- `api` — the NestJS API, on `http://localhost:3000`
- `inventory-db` — PostgreSQL 16 owned by the inventory service only (host port `5434`)
- `inventory` — the inventory gRPC server, on `localhost:50051`

Once it's up:

- API base URL: `http://localhost:3000/api/v1`
- Swagger docs (interactive): `http://localhost:3000/api/docs`
- Health check: `http://localhost:3000/api/v1/health`

No manual `.env` setup is required to run via Docker — `docker-compose.yml` already sets matching credentials for every container. For local development without Docker, copy `backend/.env.example` to `backend/.env` and `inventory-service/.env.example` to `inventory-service/.env`, and point the `DATABASE_*` settings at your PostgreSQL instances.

## Project structure

```
backend/
  src/
    users/        # register, login, roles, JWT strategy
      auth/
      entities/
      dto/
    products/      # create (admin, with image upload), list (paginated, filterable), view one
      entities/
      dto/
    orders/        # create, view (owner or admin only), change status (admin only)
      entities/
      dto/
    notifications/  # per-user notification feed
      entities/
    inventory/     # gRPC client for the inventory service (deadline + error mapping)
    proto/         # inventory.proto — the contract (copy of the one below)
    common/        # guards, decorators, enums, error filter shared across modules
  test/            # end-to-end tests for Requirement 1 and Requirement 2
  uploads/products/ # uploaded product images (served at /uploads/products/...)
  Dockerfile
inventory-service/
  src/
    inventory/     # gRPC handlers, stock + reservation tables, reserve/release logic
    proto/         # inventory.proto — the contract (must match backend/src/proto)
  Dockerfile
docker-compose.yml
```

## Roles & security model

Two roles: `customer` (default on registration) and `admin`. There is no public "become admin" endpoint on purpose — promote a user by running, against the running `db` container:

```sql
UPDATE users SET role = 'admin' WHERE email = 'someone@example.com';
```

Enforced rules:

- Every route except `GET /products`, `GET /products/:id`, `POST /auth/register` and `POST /auth/login` requires a valid `Authorization: Bearer <token>` header.
- Only an `admin` can create products or change an order's status.
- A customer can only see and list their **own** orders; an admin can see all of them. Attempting to open someone else's order returns `403 Forbidden`.
- Login is rate-limited to 5 attempts per minute per client.

## API overview

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/register` | public | Create an account, returns a JWT |
| POST | `/auth/login` | public (rate-limited) | Returns a JWT |
| GET | `/users/me` | authenticated | Current user's profile |
| GET | `/products` | public | Paginated list, `?page=&limit=&category=` |
| GET | `/products/:id` | public | Single product, with `availableQuantity` from the inventory service |
| POST | `/products` | admin | Create product, `multipart/form-data` with an `image` file and an initial `quantity` |
| POST | `/orders` | authenticated | Create an order from a list of `{ productId, quantity }` |
| GET | `/orders` | authenticated | Own orders (all orders if admin) |
| GET | `/orders/:id` | owner or admin | A single order |
| PATCH | `/orders/:id/status` | admin | Change order status |
| GET | `/notifications` | authenticated | Current user's notifications |

Every error response follows the same shape:

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this order",
    "statusCode": 403,
    "path": "/api/v1/orders/...",
    "timestamp": "..."
  }
}
```

## Demonstrating the required security scenario

1. Register two customers, A and B.
2. A creates an order: `POST /orders`.
3. B tries `GET /orders/:id` for A's order with their own token → `403 Forbidden`.
4. B (a customer) tries `PATCH /orders/:id/status` → `403 Forbidden`.
5. No token at all on any protected route → `401 Unauthorized`.

This exact flow was run against a live instance of this API during development (register → login → create product as admin → create order → cross-user access attempt → status change attempt) and every response matched the expected status code.

## Requirement 2 — Inventory service over gRPC

### Architecture

```
 client ──HTTP──▶ api (NestJS) ──gRPC──▶ inventory (NestJS gRPC server)
                    │                       │
                    ▼                       ▼
                   db                  inventory-db
       users, products, orders      stock, reservations
```

The two services never share a database. The API only knows about stock through the gRPC contract. (The course staff allowed both services to use the same framework, so the inventory service is NestJS too.)

### The contract — `inventory.proto`

| RPC | Purpose |
|---|---|
| `GetStock(product_id)` | Available quantity of one product (shown on product details) |
| `Reserve(order_ref, items[])` | Check and reserve **all** items of an order in one call, all or nothing |
| `Release(order_ref)` | Give back everything an order reserved (compensation); safe to repeat |
| `SetStock(product_id, quantity)` | Record the initial stock when an admin creates a product (an addition to the three required operations) |

### Order flow

1. The API checks the products exist and prices the order from its own database.
2. It generates an `order_ref` (which becomes the order id) and calls `Reserve` once for the whole order.
3. If the reservation is refused, no order is created.
4. If it succeeds, the order is saved. If that save fails, the API calls `Release(order_ref)`.

### Failure cases

| Case | What happens | What the user sees |
|---|---|---|
| Not enough stock | `Reserve` returns `FAILED_PRECONDITION`; its transaction rolls back, so no item of the order is reserved | `400` — `Insufficient stock for product …` |
| Inventory down or too slow | Every gRPC call has a deadline (`INVENTORY_TIMEOUT_MS`, default 3 s). On a timeout the API also sends a `Release`, in case the reservation went through late | `503` — the inventory service is unavailable / did not respond in time |
| Order save fails after reserving | The API calls `Release(order_ref)`, which returns the stock and marks the reservation `RELEASED` | `500`, and the stock is back to what it was |
| Race for the last unit | Each item is taken with one conditional `UPDATE stock SET quantity = quantity - n WHERE product_id = … AND quantity >= n`. Postgres row locks make concurrent reservations of the same product wait for each other, and the second one re-checks the condition and matches no row. A `CHECK (quantity >= 0)` constraint backs this up | Exactly one order succeeds, the rest get `400` |

When the inventory service is down, product details still load, with `availableQuantity: null` and `stockAvailable: false`. Creating a product while it is down is rolled back, so no product exists without stock.

### Demonstrating it

- **Race condition:** create a product with `quantity` 1, then send several `POST /orders` for it at the same moment. One returns `201`, the others `400`.
- **Inventory stopped:** `docker compose stop inventory`, then place an order → `503` after about 3 seconds. `docker compose start inventory` to bring it back.
- **Inventory slow:** `INVENTORY_SIMULATED_DELAY_MS=5000 docker compose up -d inventory` makes the service answer late → `503` "did not respond in time".
- **Save failure:** `SIMULATE_ORDER_SAVE_FAILURE=true docker compose up -d api`, place an order → `500`, and `GET /products/:id` shows the stock unchanged. Set it back to `false` afterwards.

All of these are also covered by `backend/test/requirement2.e2e-spec.ts`, which needs both databases and the inventory service running:

```bash
cd backend
npm run test:e2e
```

## Notes on design decisions

- `Product` has **no stock column**. Stock belongs to the inventory service; the API reads it over gRPC.
- `OrderItem` snapshots the unit price at the time of purchase, so later price changes on a product don't retroactively change past orders' totals.
