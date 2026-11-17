import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';

const ADMIN = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
};

async function startApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });
  return setupApp(app).init();
}

function expectError(res: request.Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    statusCode: status,
    error: expect.any(String),
    message: expect.anything(),
    path: expect.any(String),
    timestamp: expect.any(String),
  });
}

describe('Requirement 1 — API design & security', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let productId: string;

  const api = () => request(app.getHttpServer());

  async function newCustomer() {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({
        name: 'Customer',
        email: `${randomUUID()}@test.com`,
        password: 'Passw0rd!',
      });
    return {
      id: res.body.user.id as string,
      token: res.body.accessToken as string,
    };
  }

  function addProduct(token: string, category = 'e2e') {
    return api()
      .post('/api/v1/products')
      .auth(token, { type: 'bearer' })
      .field('name', 'Keyboard')
      .field('price', '10.00')
      .field('category', category);
  }

  function placeOrder(
    token: string,
    items: object[] = [{ productId, quantity: 1 }],
  ) {
    return api()
      .post('/api/v1/orders')
      .auth(token, { type: 'bearer' })
      .send({ items });
  }

  beforeAll(async () => {
    app = await startApp();
    adminToken = (await api().post('/api/v1/auth/login').send(ADMIN)).body
      .accessToken;
    productId = (await addProduct(adminToken)).body.id;
    await api()
      .put(`/api/v1/products/${productId}/stock`)
      .auth(adminToken, { type: 'bearer' })
      .send({ quantity: 1000 });
  });

  afterAll(() => app.close());

  describe('API rules', () => {
    it('puts the version in the path', async () => {
      await api().get('/api/v1/products').expect(200);
      await api().get('/api/products').expect(404);
    });

    it('returns every error in the same shape', async () => {
      expectError(await api().get(`/api/v1/products/${randomUUID()}`), 404);
      expectError(await api().get('/api/v1/orders'), 401);
    });

    it('serves interactive Swagger docs', async () => {
      await api().get('/api/docs').expect(200).expect('content-type', /html/);
    });

    it('sends the basic security headers', async () => {
      const res = await api().get('/api/v1/products');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('users', () => {
    it('registers new users as customers and rejects duplicate emails', async () => {
      const email = `${randomUUID()}@test.com`;
      const body = { name: 'Lina', email, password: 'Passw0rd!' };

      const res = await api()
        .post('/api/v1/auth/register')
        .send(body)
        .expect(201);
      expect(res.body.user.role).toBe('customer');
      expect(res.body.accessToken).toEqual(expect.any(String));

      expectError(await api().post('/api/v1/auth/register').send(body), 409);
    });

    it('rejects invalid input with 422, including trying to set the role', async () => {
      const bad = { name: 'x', email: 'not-an-email', password: '123' };
      expectError(await api().post('/api/v1/auth/register').send(bad), 422);

      const sneaky = {
        name: 'Lina',
        email: `${randomUUID()}@test.com`,
        password: 'Passw0rd!',
        role: 'admin',
      };
      expectError(await api().post('/api/v1/auth/register').send(sneaky), 422);
    });

    it('logs in with the right password only', async () => {
      const email = `${randomUUID()}@test.com`;
      await api()
        .post('/api/v1/auth/register')
        .send({ name: 'Omar', email, password: 'Passw0rd!' });

      await api()
        .post('/api/v1/auth/login')
        .send({ email, password: 'Passw0rd!' })
        .expect(200);
      expectError(
        await api()
          .post('/api/v1/auth/login')
          .send({ email, password: 'wrong-pass' }),
        401,
      );
    });
  });

  describe('products', () => {
    it('lets only an admin add products', async () => {
      const customer = await newCustomer();
      expectError(await api().post('/api/v1/products').field('name', 'x'), 401);
      expectError(await addProduct(customer.token), 403);
      const res = await addProduct(adminToken).expect(201);
      expect(res.body.imageUrl).toBeNull();
    });

    it('stores the uploaded image and serves it back', async () => {
      const res = await addProduct(adminToken)
        .attach('image', Buffer.from('fake image'), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(res.body.imageUrl).toMatch(/^\/uploads\/products\/.+\.png$/);
      await api().get(res.body.imageUrl).expect(200);
    });

    it('rejects non-image files and invalid prices with 422', async () => {
      const textFile = await addProduct(adminToken).attach(
        'image',
        Buffer.from('hi'),
        { filename: 'a.txt', contentType: 'text/plain' },
      );
      expectError(textFile, 422);

      const badPrice = await api()
        .post('/api/v1/products')
        .auth(adminToken, { type: 'bearer' })
        .field('name', 'x')
        .field('price', '-5')
        .field('category', 'x');
      expectError(badPrice, 422);
    });

    it('lists products publicly, filtered by category and paginated', async () => {
      const category = randomUUID();
      for (let i = 0; i < 3; i++) await addProduct(adminToken, category);

      const page1 = await api()
        .get('/api/v1/products')
        .query({ category, limit: 2 })
        .expect(200);
      expect(page1.body).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(page1.body.items).toHaveLength(2);

      const page2 = await api()
        .get('/api/v1/products')
        .query({ category, limit: 2, page: 2 });
      expect(page2.body.items).toHaveLength(1);
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      expectError(await api().get(`/api/v1/products/${randomUUID()}`), 404);
      expectError(await api().get('/api/v1/products/not-a-uuid'), 400);
    });
  });

  describe('orders', () => {
    it('creates an order and computes the total on the server', async () => {
      const customer = await newCustomer();
      const res = await placeOrder(customer.token, [
        { productId, quantity: 3 },
      ]).expect(201);
      expect(res.body).toMatchObject({
        status: 'pending',
        totalPrice: '30.00',
        userId: customer.id,
      });
      expect(res.body.items[0]).toMatchObject({
        productId,
        quantity: 3,
        unitPrice: '10.00',
      });
    });

    it('rejects unknown products, duplicated lines and bad quantities with 422', async () => {
      const { token } = await newCustomer();
      expectError(
        await placeOrder(token, [{ productId: randomUUID(), quantity: 1 }]),
        422,
      );
      expectError(
        await placeOrder(token, [
          { productId, quantity: 1 },
          { productId, quantity: 2 },
        ]),
        422,
      );
      expectError(await placeOrder(token, [{ productId, quantity: 0 }]), 422);
      expectError(await placeOrder(token, []), 422);
    });

    it('PROOF: a customer cannot open or change an order that is not theirs', async () => {
      const owner = await newCustomer();
      const stranger = await newCustomer();
      const orderId = (await placeOrder(owner.token)).body.id;
      const open = (token?: string) => {
        const req = api().get(`/api/v1/orders/${orderId}`);
        return token ? req.auth(token, { type: 'bearer' }) : req;
      };

      await open(owner.token).expect(200);
      await open(adminToken).expect(200);
      expectError(await open(stranger.token), 403);
      expectError(await open(), 401);
      expectError(await open('forged-token'), 401);

      const setStatus = (token: string) =>
        api()
          .patch(`/api/v1/orders/${orderId}/status`)
          .auth(token, { type: 'bearer' })
          .send({ status: 'shipped' });

      expectError(await setStatus(owner.token), 403);
      expectError(await setStatus(stranger.token), 403);
      const res = await setStatus(adminToken).expect(200);
      expect(res.body.status).toBe('shipped');
    });

    it('validates status changes', async () => {
      const { token } = await newCustomer();
      const orderId = (await placeOrder(token)).body.id;
      const patch = (id: string, status: string) =>
        api()
          .patch(`/api/v1/orders/${id}/status`)
          .auth(adminToken, { type: 'bearer' })
          .send({ status });

      expectError(await patch(orderId, 'teleported'), 422);
      expectError(await patch(randomUUID(), 'shipped'), 404);
    });

    it('lists only your own orders, while an admin sees everyone’s', async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      await placeOrder(a.token);
      await placeOrder(b.token);

      const mine = await api()
        .get('/api/v1/orders')
        .auth(a.token, { type: 'bearer' });
      expect(mine.body.length).toBeGreaterThan(0);
      expect(
        mine.body.every((o: { userId: string }) => o.userId === a.id),
      ).toBe(true);

      const all = await api()
        .get('/api/v1/orders')
        .auth(adminToken, { type: 'bearer' });
      const owners = all.body.map((o: { userId: string }) => o.userId);
      expect(owners).toEqual(expect.arrayContaining([a.id, b.id]));
    });
  });

  describe('notifications', () => {
    it('notifies only the order owner, on creation and on status change', async () => {
      const owner = await newCustomer();
      const other = await newCustomer();
      const orderId = (await placeOrder(owner.token)).body.id;
      await api()
        .patch(`/api/v1/orders/${orderId}/status`)
        .auth(adminToken, { type: 'bearer' })
        .send({ status: 'confirmed' });

      const inbox = (token: string) =>
        api().get('/api/v1/notifications').auth(token, { type: 'bearer' });
      const ownerMessages = (await inbox(owner.token)).body.map(
        (n: { message: string }) => n.message,
      );
      expect(ownerMessages).toEqual([
        `Order ${orderId} is now confirmed`,
        `Order ${orderId} was created`,
      ]);
      expect((await inbox(other.token)).body).toEqual([]);
      expectError(await api().get('/api/v1/notifications'), 401);
    });
  });
});

describe('login rate limiting', () => {
  it('blocks the 6th login attempt within a minute with 429', async () => {
    const app = await startApp(); // fresh app = fresh attempt counter
    const login = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.com', password: 'wrong-pass' });

    for (let i = 0; i < 5; i++) expect((await login()).status).toBe(401);
    expectError(await login(), 429);
    await app.close();
  });
});
