import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { JwtService } from '@nestjs/jwt';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import amqp, { type Channel, type ChannelModel } from 'amqplib';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import {
  assertTopology,
  DLQ,
  EMAIL_QUEUE,
  EXCHANGE,
  MAX_ATTEMPTS,
  RABBITMQ_URL,
  RETRY_QUEUE,
} from '../src/messaging/broker.js';
import {
  type Email,
  type SendEmail,
  startEmailWorker,
} from '../src/worker/email-worker.js';

// Needs everything running: `docker compose up -d` (RabbitMQ in particular).
describe('Requirement 4 — queues, worker and real-time updates', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let adminToken: string;
  let broker: ChannelModel;
  let channel: Channel;
  const sockets: Socket[] = [];
  const workers: { close(): Promise<void> }[] = [];

  const api = () => request(app.getHttpServer());
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout = 5000,
  ) {
    const deadline = Date.now() + timeout;
    while (!(await condition())) {
      if (Date.now() > deadline)
        throw new Error('timed out waiting for the condition');
      await sleep(50);
    }
  }

  const queueSize = async (queue: string) =>
    (await channel.checkQueue(queue)).messageCount;

  /** Starts a worker like the real one, but with a fake mail server. */
  async function startWorker(send: SendEmail) {
    const worker = await startEmailWorker(send);
    workers.push(worker);
    return worker;
  }

  async function newCustomer() {
    const email = `${randomUUID()}@test.com`;
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Customer', email, password: 'Passw0rd!' });
    return {
      email,
      id: res.body.user.id as string,
      token: res.body.accessToken as string,
    };
  }

  async function newProduct() {
    const { body } = await api()
      .post('/api/v1/products')
      .auth(adminToken, { type: 'bearer' })
      .field('name', 'Reading lamp')
      .field('price', '12.50')
      .field('category', 'e2e');
    await api()
      .put(`/api/v1/products/${body.id}/stock`)
      .auth(adminToken, { type: 'bearer' })
      .send({ quantity: 1000 });
    return body.id as string;
  }

  const placeOrder = (token: string, productId: string, quantity = 2) =>
    api()
      .post('/api/v1/orders')
      .auth(token, { type: 'bearer' })
      .send({ items: [{ productId, quantity }] });

  const approve = (orderId: string) =>
    api()
      .patch(`/api/v1/orders/${orderId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .send({ status: 'confirmed' });

  function connect(token?: string) {
    const socket = io(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise<Socket>((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  const subscribe = (socket: Socket, body: object) =>
    socket.emitWithAck('subscribe', body);

  /** Resolves with the first event of that name that matches. */
  function nextEvent<T = any>(
    socket: Socket,
    name: string,
    matches: (event: T) => boolean = () => true,
  ) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no "${name}" event`)),
        3000,
      );
      socket.on(name, (event: T) => {
        if (matches(event)) {
          clearTimeout(timer);
          resolve(event);
        }
      });
    });
  }

  beforeAll(async () => {
    const nest = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });
    app = setupApp(nest);
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    adminToken = (
      await api().post('/api/v1/auth/login').send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
    ).body.accessToken;

    broker = await amqp.connect(RABBITMQ_URL);
    channel = await broker.createChannel();
    await assertTopology(channel);
    // Clean slate: events and messages left by the earlier test files are not ours.
    await app
      .get(DataSource)
      .query('DELETE FROM outbox_events WHERE exchange = $1', [EXCHANGE]);
    await sleep(1500);
    for (const queue of [EMAIL_QUEUE, RETRY_QUEUE, DLQ])
      await channel.purgeQueue(queue);
  });

  afterEach(async () => {
    for (const worker of workers.splice(0))
      await worker.close().catch(() => {});
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await app.close();
    await broker.close();
  });

  describe('queue and worker', () => {
    it('answers the order at once, and the worker sends the confirmation email later', async () => {
      const customer = await newCustomer();
      const res = await placeOrder(customer.token, await newProduct()).expect(
        201,
      );

      // No worker is running, and the order was still accepted: the email is only waiting in the queue.
      await waitFor(async () => (await queueSize(EMAIL_QUEUE)) >= 1);

      const sent: Email[] = [];
      await startWorker(async (email) => void sent.push(email));
      await waitFor(() => sent.some((email) => email.to === customer.email));

      const email = sent.find((e) => e.to === customer.email)!;
      expect(email.subject).toContain(res.body.id.slice(0, 8));
      expect(email.text).toContain('2 x Reading lamp');
      expect(email.text).toContain('$25.00');
      await waitFor(async () => (await queueSize(EMAIL_QUEUE)) === 0);
    });

    it('PROOF: stopping the worker, even in the middle of an email, loses no email', async () => {
      const [a, b, c] = [
        await newCustomer(),
        await newCustomer(),
        await newCustomer(),
      ];
      const productId = await newProduct();

      // This worker takes the first email and dies before it could finish sending it.
      let received = false;
      const dying = await startWorker(() => {
        received = true;
        return new Promise(() => {});
      });
      await placeOrder(a.token, productId).expect(201);
      await waitFor(() => received);
      await dying.close();

      // Two more orders arrive while no worker is running at all.
      await placeOrder(b.token, productId).expect(201);
      await placeOrder(c.token, productId).expect(201);
      await waitFor(async () => (await queueSize(EMAIL_QUEUE)) === 3);

      // A new worker finds all three, including the one the first worker never finished.
      const sent: Email[] = [];
      await startWorker(async (email) => void sent.push(email));
      await waitFor(() =>
        [a, b, c].every((user) =>
          sent.some((email) => email.to === user.email),
        ),
      );
    });

    it('retries a temporary failure, and the email still arrives', async () => {
      await channel.purgeQueue(DLQ);
      const customer = await newCustomer();
      let calls = 0;
      const sent: Email[] = [];
      await startWorker(async (email) => {
        if (++calls === 1) throw new Error('mail server busy');
        sent.push(email);
      });
      await placeOrder(customer.token, await newProduct()).expect(201);

      await waitFor(() => sent.some((email) => email.to === customer.email));
      expect(await queueSize(DLQ)).toBe(0);
    });

    it('PROOF: an email that always fails is retried, then moved to the dead-letter queue', async () => {
      await channel.purgeQueue(DLQ);
      let calls = 0;
      await startWorker(async () => {
        calls++;
        throw new Error('mail server down');
      });
      await placeOrder((await newCustomer()).token, await newProduct()).expect(
        201,
      );

      await waitFor(async () => (await queueSize(DLQ)) === 1, 10_000);
      expect(calls).toBe(MAX_ATTEMPTS);
      const dead = await channel.get(DLQ, { noAck: true });
      expect(dead && dead.properties.headers?.['x-attempts']).toBe(
        MAX_ATTEMPTS,
      );
      expect(String(dead && dead.properties.headers?.['x-error'])).toContain(
        'mail server down',
      );
      expect(await queueSize(EMAIL_QUEUE)).toBe(0);
      expect(await queueSize(RETRY_QUEUE)).toBe(0);
    }, 20_000);
  });

  describe('real-time channels', () => {
    it('refuses a connection without a valid token', async () => {
      await expect(connect()).rejects.toThrow('unauthorized');
      await expect(connect('not-a-token')).rejects.toThrow('unauthorized');
    });

    it('closes the connection when the token expires', async () => {
      const customer = await newCustomer();
      const short = app
        .get(JwtService)
        .sign({ sub: customer.id, role: 'customer' }, { expiresIn: '1s' });
      const socket = await connect(short);
      await waitFor(() => socket.disconnected, 4000);
    });

    it('lets a customer follow only their own order, and only an admin join the admin channel', async () => {
      const [alice, bob] = [await newCustomer(), await newCustomer()];
      const productId = await newProduct();
      const aliceOrder = (await placeOrder(alice.token, productId)).body.id;
      const bobOrder = (await placeOrder(bob.token, productId)).body.id;

      const aliceSocket = await connect(alice.token);
      expect(await subscribe(aliceSocket, { channel: 'admin' })).toEqual({
        ok: false,
        error: 'forbidden',
      });
      expect(
        await subscribe(aliceSocket, { channel: 'order', orderId: bobOrder }),
      ).toEqual({ ok: false, error: 'forbidden' });
      expect(
        await subscribe(aliceSocket, {
          channel: 'order',
          orderId: randomUUID(),
        }),
      ).toEqual({ ok: false, error: 'forbidden' });
      expect(
        await subscribe(aliceSocket, { channel: 'order', orderId: 'nonsense' }),
      ).toEqual({ ok: false, error: 'forbidden' });
      expect(
        await subscribe(aliceSocket, { channel: 'order', orderId: aliceOrder }),
      ).toEqual({ ok: true });

      const adminSocket = await connect(adminToken);
      expect(await subscribe(adminSocket, { channel: 'admin' })).toEqual({
        ok: true,
      });
      expect(
        await subscribe(adminSocket, { channel: 'order', orderId: bobOrder }),
      ).toEqual({ ok: true });
    });

    it('PROOF: a new order shows at once on the admin channel, and the approval at once on the customer page', async () => {
      const [alice, bob] = [await newCustomer(), await newCustomer()];
      const productId = await newProduct();
      const bobOrder = (await placeOrder(bob.token, productId)).body.id;

      const adminSocket = await connect(adminToken);
      await subscribe(adminSocket, { channel: 'admin' });
      const aliceSocket = await connect(alice.token);
      const bobSocket = await connect(bob.token);
      await subscribe(bobSocket, { channel: 'order', orderId: bobOrder });
      const bobEvents: unknown[] = [];
      bobSocket.onAny((_name, event) => bobEvents.push(event));

      // 1. A new order appears on the admin dashboard, with the customer and the items.
      const created = nextEvent(
        adminSocket,
        'order.created',
        (e) => e.customer.email === alice.email,
      );
      const started = Date.now();
      const aliceOrder = (await placeOrder(alice.token, productId)).body.id;
      const event = await created;
      expect(event.order).toMatchObject({
        id: aliceOrder,
        status: 'pending',
        totalPrice: '25.00',
      });
      expect(event.order.items[0]).toMatchObject({
        name: 'Reading lamp',
        quantity: 2,
      });
      expect(Date.now() - started).toBeLessThan(2000);

      // 2. The admin approves it, and the customer's page (the order channel) sees it at once.
      await subscribe(aliceSocket, { channel: 'order', orderId: aliceOrder });
      const customerSees = nextEvent(aliceSocket, 'order.status_changed');
      const adminSees = nextEvent(
        adminSocket,
        'order.status_changed',
        (e) => e.orderId === aliceOrder,
      );
      const approved = Date.now();
      await approve(aliceOrder).expect(200);
      expect(await customerSees).toMatchObject({
        orderId: aliceOrder,
        status: 'confirmed',
      });
      expect(Date.now() - approved).toBeLessThan(2000);
      expect(await adminSees).toMatchObject({
        orderId: aliceOrder,
        status: 'confirmed',
      });

      // 3. Nobody else heard about Alice's order.
      await sleep(500);
      expect(bobEvents).toEqual([]);
    });
  });
});
