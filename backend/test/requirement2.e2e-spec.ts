import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { Role } from '../src/common/enums/role.enum.js';
import { User } from '../src/users/entities/user.entity.js';
import { Order } from '../src/orders/entities/order.entity.js';

/**
 * End-to-end coverage for Requirement 2 — communication between services.
 *
 * Needs the API's Postgres database and a running inventory service
 * (INVENTORY_GRPC_URL, default localhost:50051). The outage scenarios boot a
 * second copy of the API pointed at an address where no inventory service
 * answers, so the real inventory service never has to be stopped.
 */

async function bootstrapApp(env: Record<string, string> = {}): Promise<INestApplication<App>> {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    return app;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function unique(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describe('Requirement 2 — inventory service over gRPC', () => {
  let app: INestApplication<App>;
  let server: App;
  let usersRepository: Repository<User>;
  let ordersRepository: Repository<Order>;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer();
    usersRepository = app.get(getRepositoryToken(User));
    ordersRepository = app.get(getRepositoryToken(Order));

    const email = `${unique('inventory-admin')}@example.com`;
    const password = 'Str0ngPassword!';
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ name: 'Inventory Admin', email, password });
    await usersRepository.update({ id: registerRes.body.user.id }, { role: Role.ADMIN });
    const loginRes = await request(server).post('/api/v1/auth/login').send({ email, password });
    adminToken = loginRes.body.accessToken;

    // One shared customer keeps this suite under the global 60 requests/minute throttle.
    const customerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ name: 'Customer', email: `${unique('customer')}@example.com`, password });
    customerToken = customerRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProduct(quantity: number, price = '10.00') {
    const res = await request(server)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', unique('Product'))
      .field('price', price)
      .field('category', 'inventory-test')
      .field('quantity', String(quantity));
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function availableQuantity(productId: string) {
    const res = await request(server).get(`/api/v1/products/${productId}`);
    return res.body.availableQuantity as number | null;
  }

  function placeOrder(token: string, items: { productId: string; quantity: number }[]) {
    return request(server).post('/api/v1/orders').set('Authorization', `Bearer ${token}`).send({ items });
  }

  it('product details include the stock reported by the inventory service', async () => {
    const productId = await createProduct(7);
    const res = await request(server).get(`/api/v1/products/${productId}`);
    expect(res.status).toBe(200);
    expect(res.body.availableQuantity).toBe(7);
    expect(res.body.stockAvailable).toBe(true);
  });

  it('a product can start with zero stock', async () => {
    const productId = await createProduct(0);
    expect(await availableQuantity(productId)).toBe(0);
  });

  it('rejects a non-integer or negative initial stock', async () => {
    const res = await request(server)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'X')
      .field('price', '1.00')
      .field('category', 'x')
      .field('quantity', '-1');
    expect(res.status).toBe(400);
  });

  it('a successful order reserves its stock', async () => {
    const productId = await createProduct(5);
    const res = await placeOrder(customerToken, [{ productId, quantity: 2 }]);
    expect(res.status).toBe(201);
    expect(await availableQuantity(productId)).toBe(3);
  });

  it('insufficient stock: the order is refused with a clear message and nothing is reserved', async () => {
    const productId = await createProduct(2);
    const res = await placeOrder(customerToken, [{ productId, quantity: 3 }]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Insufficient stock');
    expect(await availableQuantity(productId)).toBe(2);
  });

  it('reservation is all or nothing across the items of one order', async () => {
    const plenty = await createProduct(10);
    const scarce = await createProduct(1);
    const res = await placeOrder(customerToken, [
      { productId: plenty, quantity: 4 },
      { productId: scarce, quantity: 2 },
    ]);
    expect(res.status).toBe(400);
    expect(await availableQuantity(plenty)).toBe(10);
    expect(await availableQuantity(scarce)).toBe(1);
  });

  it('race condition: many simultaneous orders for the last unit, exactly one succeeds', async () => {
    const productId = await createProduct(1);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => placeOrder(customerToken, [{ productId, quantity: 1 }])),
    );
    const statuses = results.map((res) => res.status);

    expect(statuses.filter((code) => code === 201)).toHaveLength(1);
    expect(statuses.filter((code) => code === 400)).toHaveLength(9);
    expect(await availableQuantity(productId)).toBe(0);
  });

  it('save failure after reserving: the reserved stock is given back', async () => {
    const productId = await createProduct(4);
    const ordersBefore = await ordersRepository.count();

    // The flag is read on every order, so it only needs to be set around this request.
    process.env.SIMULATE_ORDER_SAVE_FAILURE = 'true';
    let res: request.Response;
    try {
      res = await placeOrder(customerToken, [{ productId, quantity: 3 }]);
    } finally {
      delete process.env.SIMULATE_ORDER_SAVE_FAILURE;
    }

    expect(res.status).toBe(500);
    expect(await ordersRepository.count()).toBe(ordersBefore);
    expect(await availableQuantity(productId)).toBe(4);
  });

  describe('inventory service unreachable', () => {
    let downApp: INestApplication<App>;

    beforeAll(async () => {
      // Port 1 refuses connections, like a stopped container.
      downApp = await bootstrapApp({ INVENTORY_GRPC_URL: 'localhost:1' });
    });

    afterAll(async () => {
      await downApp.close();
    });

    it('placing an order fails fast with 503 and a clear message', async () => {
      const productId = await createProduct(5);

      const started = Date.now();
      const res = await request(downApp.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ productId, quantity: 1 }] });

      expect(res.status).toBe(503);
      expect(res.body.error.message).toContain('inventory service');
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it('product details still load, flagged as stock unavailable', async () => {
      const productId = await createProduct(5);
      const res = await request(downApp.getHttpServer()).get(`/api/v1/products/${productId}`);
      expect(res.status).toBe(200);
      expect(res.body.availableQuantity).toBeNull();
      expect(res.body.stockAvailable).toBe(false);
    });

    it('creating a product is undone when its stock cannot be recorded', async () => {
      const name = unique('Orphan');
      const res = await request(downApp.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('name', name)
        .field('price', '1.00')
        .field('category', 'inventory-orphan')
        .field('quantity', '3');
      expect(res.status).toBe(503);

      const list = await request(server).get('/api/v1/products').query({ category: 'inventory-orphan' });
      expect(list.body.items.some((product: { name: string }) => product.name === name)).toBe(false);
    });
  });

  describe('inventory service too slow', () => {
    let silentServer: Server;
    const sockets = new Set<Socket>();
    let slowApp: INestApplication<App>;

    beforeAll(async () => {
      // Accepts TCP connections but never answers, like a hung service.
      silentServer = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
      const { port } = silentServer.address() as AddressInfo;
      slowApp = await bootstrapApp({
        INVENTORY_GRPC_URL: `127.0.0.1:${port}`,
        INVENTORY_TIMEOUT_MS: '1000',
      });
    });

    afterAll(async () => {
      await slowApp.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => silentServer.close(() => resolve()));
    });

    it('the user is not left waiting: the deadline turns into a 503', async () => {
      const productId = await createProduct(5);

      const started = Date.now();
      const res = await request(slowApp.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ items: [{ productId, quantity: 1 }] });

      expect(res.status).toBe(503);
      expect(res.body.error.message).toContain('did not respond in time');
      expect(Date.now() - started).toBeLessThan(3000);
    });
  });
});
