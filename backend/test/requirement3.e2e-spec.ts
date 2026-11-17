import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';

// Needs everything running: `docker compose up -d`.
describe('Requirement 3 — performance & caching', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  // A direct connection to the replica, to hold it back and to look inside it.
  const replica = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_REPLICA_URL,
  });

  const api = () => request(app.getHttpServer());

  async function customerToken() {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({
        name: 'Customer',
        email: `${randomUUID()}@test.com`,
        password: 'Passw0rd!',
      });
    return res.body.accessToken as string;
  }

  async function newProduct(stock = 10) {
    const { body } = await api()
      .post('/api/v1/products')
      .auth(adminToken, { type: 'bearer' })
      .field('name', 'Lamp')
      .field('price', '20.00')
      .field('category', `cat-${randomUUID()}`);
    await api()
      .put(`/api/v1/products/${body.id}/stock`)
      .auth(adminToken, { type: 'bearer' })
      .send({ quantity: stock });
    return body as { id: string; category: string };
  }

  function edit(id: string, changes: object, token = adminToken) {
    return api()
      .patch(`/api/v1/products/${id}`)
      .auth(token, { type: 'bearer' })
      .send(changes);
  }

  const getProduct = (id: string) => api().get(`/api/v1/products/${id}`);

  /** Runs `work` while the replica is frozen, so it is certainly behind the primary. */
  async function withReplicaBehind(work: () => Promise<void>) {
    await replica.query('SELECT pg_wal_replay_pause()');
    try {
      await work();
    } finally {
      await replica.query('SELECT pg_wal_replay_resume()');
    }
  }

  beforeAll(async () => {
    const nest = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });
    app = await setupApp(nest).init();
    await replica.initialize();
    adminToken = (
      await api().post('/api/v1/auth/login').send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
    ).body.accessToken;
  });

  afterAll(async () => {
    await replica.destroy();
    await app.close();
  });

  it('lets only an admin edit a product, and validates the changes', async () => {
    const { id } = await newProduct();
    const customer = await customerToken();
    await edit(id, { price: '25.00' }, customer).expect(403);
    await edit(id, { price: 'cheap' }).expect(422);
    await edit(randomUUID(), { price: '25.00' }).expect(404);
    await edit(id, { price: '25.00' }).expect(200);
  });

  it('PROOF: an edited product shows at once, on its page and in the list', async () => {
    const { id, category } = await newProduct();
    const list = () => api().get(`/api/v1/products?category=${category}`);
    // Read both first, so both are sitting in the Redis cache.
    expect((await getProduct(id)).body.price).toBe('20.00');
    expect((await list()).body.items[0].price).toBe('20.00');

    await edit(id, { name: 'Desk lamp', price: '35.50' }).expect(200);

    expect((await getProduct(id)).body).toMatchObject({
      name: 'Desk lamp',
      price: '35.50',
    });
    expect((await list()).body.items[0]).toMatchObject({
      name: 'Desk lamp',
      price: '35.50',
    });
  });

  it('PROOF: the edit shows at once even while the replica is behind', async () => {
    const { id } = await newProduct();
    await getProduct(id);

    await withReplicaBehind(async () => {
      await edit(id, { price: '99.00' }).expect(200);

      expect((await getProduct(id)).body.price).toBe('99.00');
      // The replica itself still has the old price: the API answered from the primary.
      const [row] = await replica.query(
        'SELECT price FROM products WHERE id = $1',
        [id],
      );
      expect(row.price).toBe('20.00');
    });
  });

  it('PROOF: a customer sees a new order at once even while the replica is behind', async () => {
    const { id: productId } = await newProduct();
    const token = await customerToken();
    const myOrders = () =>
      api().get('/api/v1/orders').auth(token, { type: 'bearer' });
    expect((await myOrders()).body.total).toBe(0);

    await withReplicaBehind(async () => {
      const order = await api()
        .post('/api/v1/orders')
        .auth(token, { type: 'bearer' })
        .send({ items: [{ productId, quantity: 1 }] })
        .expect(201);

      const mine = (await myOrders()).body;
      expect(mine.total).toBe(1);
      expect(mine.items[0]).toMatchObject({ id: order.body.id });
      expect(mine.items[0].items).toHaveLength(1);
      // The replica does not have the order yet.
      const rows = await replica.query('SELECT id FROM orders WHERE id = $1', [
        order.body.id,
      ]);
      expect(rows).toHaveLength(0);
    });
  });

  it('never caches stock: a change in the warehouse shows on the next read', async () => {
    const { id } = await newProduct(5);
    expect((await getProduct(id)).body.stock).toBe(5);
    await api()
      .put(`/api/v1/products/${id}/stock`)
      .auth(adminToken, { type: 'bearer' })
      .send({ quantity: 3 });
    expect((await getProduct(id)).body.stock).toBe(3);
  });

  it('answers 304 with no body while the product is unchanged, and 200 after it changes', async () => {
    const { id } = await newProduct();
    const first = await getProduct(id).expect(200);
    const etag = first.headers.etag;
    expect(etag).toBeDefined();

    const same = await getProduct(id).set('If-None-Match', etag).expect(304);
    expect(same.text).toBe('');

    await edit(id, { price: '21.00' });
    const changed = await getProduct(id).set('If-None-Match', etag).expect(200);
    expect(changed.headers.etag).not.toBe(etag);
    expect(changed.body.price).toBe('21.00');
  });

  it('returns orders one page at a time', async () => {
    const { id: productId } = await newProduct();
    const token = await customerToken();
    for (let i = 0; i < 3; i++) {
      await api()
        .post('/api/v1/orders')
        .auth(token, { type: 'bearer' })
        .send({ items: [{ productId, quantity: 1 }] });
    }
    const page = await api()
      .get('/api/v1/orders?page=2&limit=2')
      .auth(token, { type: 'bearer' });
    expect(page.body).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(page.body.items).toHaveLength(1);
    await api()
      .get('/api/v1/orders?limit=500')
      .auth(token, { type: 'bearer' })
      .expect(422);
  });
});
