import { defineConfig } from 'vitest/config';

// Runs against the Docker services (`docker compose up -d`) through their host ports.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    // One file at a time: a test that holds the replica back must not affect the others.
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5433/ecommerce',
      DATABASE_REPLICA_URL:
        'postgres://postgres:postgres@localhost:5435/ecommerce',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'e2e-test-secret',
      ADMIN_EMAIL: 'admin@shop.local',
      ADMIN_PASSWORD: 'Admin12345',
    },
  },
});
