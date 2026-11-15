import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';

// Needs the warehouse running too: `docker compose up -d db warehouse-db warehouse`.
describe('Requirement 2 — warehouse service over gRPC', () => {
  let app: NestExpressApplication;
  let adminToken: string;

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

  async function productWithStock(quantity: number) {
    const { body } = await api()
      .post('/api/v1/products')
      .auth(adminToken, { type: 'bearer' })
      .field('name', 'Mouse')
      .field('price', '5.00')
      .field('category', 'e2e');
    await api()
      .put(`/api/v1/products/${body.id}/stock`)
      .auth(adminToken, { type: 'bearer' })
      .send({ quantity })
      .expect(200);
    return body.id as string;
  }

  function order(token: string, items: object[]) {
    return api()
      .post('/api/v1/orders')
      .auth(token, { type: 'bearer' })
      .send({ items });
  }

  async function stockOf(productId: string) {
    return (await api().get(`/api/v1/products/${productId}`)).body.stock;
  }

  beforeAll(async () => {
    const nest = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });
    app = await setupApp(nest).init();
    adminToken = (
      await api().post('/api/v1/auth/login').send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
    ).body.accessToken;
  });

  afterAll(() => app.close());

  it('lets only an admin set stock, and never below zero', async () => {
    const productId = await productWithStock(1);
    const token = await customerToken();
    await api()
      .put(`/api/v1/products/${productId}/stock`)
      .auth(token, { type: 'bearer' })
      .send({ quantity: 5 })
      .expect(403);
    await api()
      .put(`/api/v1/products/${productId}/stock`)
      .auth(adminToken, { type: 'bearer' })
      .send({ quantity: -1 })
      .expect(422);
  });

  it('shows the live stock on the product page', async () => {
    const productId = await productWithStock(7);
    expect(await stockOf(productId)).toBe(7);
  });

  it('takes the ordered quantity out of the warehouse', async () => {
    const productId = await productWithStock(7);
    const token = await customerToken();
    await order(token, [{ productId, quantity: 3 }]).expect(201);
    expect(await stockOf(productId)).toBe(4);
  });

  it('reserves all items or none, and saves no order when stock is short', async () => {
    const enough = await productWithStock(5);
    const short = await productWithStock(1);
    const token = await customerToken();

    await order(token, [
      { productId: enough, quantity: 2 },
      { productId: short, quantity: 2 },
    ]).expect(409);

    expect(await stockOf(enough)).toBe(5);
    const orders = await api()
      .get('/api/v1/orders')
      .auth(token, { type: 'bearer' });
    expect(orders.body).toHaveLength(0);
  });

  it('PROOF: 20 customers race for the last unit and exactly one wins', async () => {
    const productId = await productWithStock(1);
    const tokens = await Promise.all(
      Array.from({ length: 20 }, () => customerToken()),
    );

    const results = await Promise.all(
      tokens.map((token) => order(token, [{ productId, quantity: 1 }])),
    );
    const statuses = results.map((res) => res.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
    expect(await stockOf(productId)).toBe(0);
  });
});
