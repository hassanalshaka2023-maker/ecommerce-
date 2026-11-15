import { defineConfig } from 'vitest/config';

// Runs against the Docker database (`docker compose up db`), exposed on port 5433.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    env: {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5433/ecommerce',
      JWT_SECRET: 'e2e-test-secret',
      ADMIN_EMAIL: 'admin@shop.local',
      ADMIN_PASSWORD: 'Admin12345',
    },
  },
});
