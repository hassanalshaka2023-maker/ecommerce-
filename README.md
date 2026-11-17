# Distributed Real-Time E-Commerce Platform

A NestJS API split into four modules (Users, Products, Orders, Notifications), backed by PostgreSQL, plus a separate **warehouse service written in Python** that owns the stock and talks to the API over **gRPC**. Reads are sped up with indexes, a **Redis** cache, a **read replica** and HTTP **ETags**. Order events go through **RabbitMQ**: a separate **worker** sends the confirmation email, and the screens are updated live over **Socket.IO**. Everything runs in Docker.

## Run it

```bash
docker compose up --build
```

| What | Where |
|---|---|
| API | `http://localhost:3001/api/v1` |
| Swagger (try every endpoint) | `http://localhost:3001/api/docs` |
| Database, for tools and tests | `localhost:5433` (user `postgres`, password `postgres`) |
| Read replica of the database | `localhost:5435` |
| Redis | `localhost:6379` |
| RabbitMQ management page | `http://localhost:15672` (`guest` / `guest`) |
| Mailpit: every email the worker sends | `http://localhost:8025` |
| Warehouse gRPC service | `localhost:50051` |
| Warehouse database | `localhost:5434` |
| Web interface (`cd frontend && npm install && npm run dev`) | `http://localhost:5173` |

An admin account is created on first start: `admin@shop.local` / `Admin12345` (set in `docker-compose.yml`). Every registration is a `customer`; there is deliberately no endpoint for becoming an admin.

## Tests

With everything running (`docker compose up -d`):

```bash
cd backend
npm run test:e2e
```

The required proof (a customer trying to open or change someone else's order is rejected) is the `PROOF` test in [backend/test/requirement1.e2e-spec.ts](backend/test/requirement1.e2e-spec.ts).

The proof for requirement 2 (20 customers order the last unit at the same moment and exactly one succeeds) is the `PROOF` test in [backend/test/requirement2.e2e-spec.ts](backend/test/requirement2.e2e-spec.ts).

The proofs for requirement 3 (an edited product shows at once, and a customer sees a new order at once, both while the replica is held back) are the `PROOF` tests in [backend/test/requirement3.e2e-spec.ts](backend/test/requirement3.e2e-spec.ts).

The proofs for requirement 4 (stopping the worker loses no email, a failing email ends in the dead-letter queue, a new order and an approval show at once) are the `PROOF` tests in [backend/test/requirement4.e2e-spec.ts](backend/test/requirement4.e2e-spec.ts). They use their own exchange and queues (`test.*`).

## Structure

```
proto/warehouse.proto        the gRPC contract shared by both services
warehouse/server.py          the Python warehouse service (stock + reservations)
frontend/                    React interface
db/pg_hba.conf               lets the read replica connect to the primary database
.env.example                 how to send real emails (SMTP settings for the worker)
perf/                        fake data, the k6 load test and the measured results
backend/src/
  main.ts                    starts the app
  app.setup.ts               security headers, /api/v1, validation, error format, Swagger
  app.module.ts              database, JWT and the four modules
  common/
    auth.ts                  JWT guard, roles, @Auth() and @CurrentUser()
    all-exceptions.filter.ts one error format for everything
    cache.service.ts         Redis: cached reads, and who wrote recently
    page-query.dto.ts        page and limit for every list
  messaging/broker.ts        RabbitMQ names, event shapes and the connection, shared by the api and the worker
  events/                    the outbox table and the relay that sends its events to RabbitMQ
  realtime/                  Socket.IO channels (who may join) and the RabbitMQ listener that feeds them
  worker/                    the email worker, a separate program (dist/worker/main.js)
  users/                     register, login (rate-limited), admin seeding
  products/                  add with image (admin), list with filter + pagination, view one
  orders/                    create, view (owner or admin), change status (admin)
  notifications/             each user's notification feed
  warehouse/                 gRPC client for the warehouse service
```

Every module has the same five files: `*.entity.ts` (table), `*.dto.ts` (validated input), `*.service.ts` (logic), `*.controller.ts` (routes), `*.module.ts` (wiring).

Each module owns its tables. Other modules reach its data only through its service; for example, Orders calls `ProductsService.getForOrder()` and `UsersService.contactOf()` instead of reading the `products` and `users` tables.

## API

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/auth/register` | anyone | returns a JWT |
| POST | `/auth/login` | anyone | 5 attempts per minute per IP |
| GET | `/products` | anyone | `?category=&page=&limit=` |
| GET | `/products/:id` | anyone | includes live `stock` from the warehouse (`null` if it is down) |
| PATCH | `/products/:id` | admin | any of `name`, `description`, `price`, `category` |
| PUT | `/products/:id/stock` | admin | `{ "quantity" }`, stored in the warehouse |
| POST | `/products` | admin | `multipart/form-data`, optional `image` (JPEG/PNG/WEBP, max 5 MB) |
| POST | `/orders` | logged in | `{ "items": [{ "productId", "quantity" }] }`, saved only after the warehouse reserves every item |
| GET | `/orders` | logged in | own orders; an admin sees all; `?page=&limit=` |
| GET | `/orders/:id` | owner or admin | anyone else gets `403` |
| PATCH | `/orders/:id/status` | admin | |
| GET | `/notifications` | logged in | own notifications |

## Order flow and the warehouse

1. Orders gets the prices from `ProductsService` and generates the order id.
2. It asks the warehouse to reserve all items in one gRPC call. The warehouse does it in one transaction with `UPDATE stock SET quantity = quantity - q WHERE quantity >= q`, so two orders can never take the same last unit. If any item is short, nothing is reserved and the API returns `409`.
3. Only then is the order saved. If saving fails, the reservation is released. If the warehouse did not answer in time, the API also releases, since it cannot know whether the reservation happened; releasing twice is harmless.
4. Every gRPC call has a 2-second deadline, so a stopped warehouse gives a clear `503`/`504` instead of a hanging request.

## Performance (requirement 3)

Measured with k6 against 300,000 orders, one change at a time. From the unoptimized API to the final one: p50 198 → 50 ms, p95 361 → 89 ms, p99 494 → 125 ms, throughput 231 → 911 requests/s. The full report with every step, the numbers and the pictures is [REQUIREMENT_3_REPORT.md](REQUIREMENT_3_REPORT.md); the raw results are in `perf/results/`.

- **Indexes** on `orders(user_id, created_at)`, `order_items(order_id)` and `notifications(user_id, created_at)`; "my orders" went from a full table scan (24.6 ms) to an index lookup (0.8 ms).
- **Pagination** on `GET /orders`, and the order items of a page are loaded with one query (no N+1).
- **Redis** caches product lists and product pages for 60 seconds; any product change makes the old entries unreachable. Stock is never cached.
- **Read replica** (`db-replica`) serves the product, order and notification reads. A user who has just written something reads the primary for a few seconds, so they always see their own change.
- **ETag**: an unchanged product answers `304` with no body.

Run the load test (fake data first, see the header of each file):

```powershell
Get-Content perf/seed.sql | docker compose exec -T db psql -U postgres -d ecommerce
docker compose restart api
docker run --rm -v ${PWD}/perf:/perf grafana/k6 run /perf/load-test.js
```

## Events, worker and live updates (requirement 4)

```
POST /orders ─▶ order + "order.created" row in outbox_events (one transaction) ─▶ 201 at once
                                  │ relay (right away, and every second)
                                  ▼
                       RabbitMQ exchange "orders.events"
                  ┌───────────────┴────────────────┐
           queue "emails"                  one temporary queue per api instance
                  │                                │
            email worker                    Socket.IO channels
   (ack only after the email is sent)   "admin" (admins) · "order:<id>" (its owner)
   fails ─▶ "emails.retry" (5 s) ─▶ back, 3 attempts ─▶ "emails.dlq"
```

- **The user never waits for the email.** The order is answered at once; the worker sends the email from the queue.
- **No email is lost.** The event is saved with the order (outbox), so it is sent even if RabbitMQ was down. Queues and messages are durable. The worker acknowledges a message only after the email went out, so a worker that stops or crashes leaves it in the queue for the next one. A failing email is retried twice after 5 seconds, then kept in `emails.dlq`.
- **Live channels, checked before joining.** The connection needs a valid token and closes when it expires. `admin` (new orders, every status change) is for admins only; `order:<id>` (that order's status) is for its owner or an admin, the same rule as `GET /orders/:id`.
- **Pages:** *Live dashboard* (admin) and *Track live* (a customer's order).

The emails go to Mailpit by default. For a real mail service, copy `.env.example` to `.env`, fill in the SMTP settings and run `docker compose up -d worker`.

## Status codes and errors

`200` ok · `201` created · `304` not modified (the client's copy is still current) · `400` malformed id in the URL · `401` missing or invalid token · `403` not allowed · `404` not found · `409` email already registered or not enough stock · `422` invalid input · `429` too many login attempts · `503` warehouse unavailable · `504` warehouse did not respond in time

Every error has the same shape:

```json
{
  "statusCode": 403,
  "error": "FORBIDDEN",
  "message": "This order belongs to another user",
  "path": "/api/v1/orders/…",
  "timestamp": "…"
}
```
