# Inventory service

gRPC server that owns product stock for the e-commerce platform (Requirement 2). It has its own PostgreSQL database and is reached only through the contract in `src/proto/inventory.proto`. See the main [README](../README.md) for the full picture.

## RPCs

| RPC | Purpose |
|---|---|
| `GetStock` | Available quantity of one product |
| `Reserve` | Reserve every item of an order, all or nothing |
| `Release` | Give back what an order reserved; safe to call more than once |
| `SetStock` | Record a product's stock |

## Running locally

```bash
cp .env.example .env
docker compose up -d inventory-db   # from the repository root
npm run start:dev
```

The server listens on `GRPC_URL` (default `0.0.0.0:50051`).

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `GRPC_URL` | `0.0.0.0:50051` | Address the gRPC server binds to |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` | — | Its own PostgreSQL database |
| `INVENTORY_SIMULATED_DELAY_MS` | `0` | Delays `GetStock` and `Reserve`, to demonstrate the API's deadline |

`src/proto/inventory.proto` must stay identical to `backend/src/proto/inventory.proto`.
