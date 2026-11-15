import amqp, { type Channel, type ChannelModel } from 'amqplib';

// Tests set RABBIT_PREFIX=test., so they never touch the real exchange and queues.
const prefix = process.env.RABBIT_PREFIX ?? '';

export const RABBITMQ_URL =
  process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
export const EXCHANGE = `${prefix}orders.events`; // topic: order.created, order.status_changed
export const EMAIL_QUEUE = `${prefix}emails`; // the worker reads from here
export const RETRY_QUEUE = `${prefix}emails.retry`; // waits a few seconds, then goes back to EMAIL_QUEUE
export const DLQ = `${prefix}emails.dlq`; // dead letters: messages that failed every attempt
export const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 5000);

export interface OrderCreated {
  order: {
    id: string;
    userId: string;
    status: string;
    totalPrice: string;
    createdAt: string;
    items: {
      productId: string;
      name: string;
      quantity: number;
      unitPrice: string;
    }[];
  };
  customer: { name: string; email: string };
}

export interface OrderStatusChanged {
  orderId: string;
  userId: string;
  status: string;
  updatedAt: string;
}

/** Declares what both sides need. Declaring something that already exists is a no-op. */
export async function assertTopology(channel: Channel) {
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(DLQ, { durable: true });
  await channel.assertQueue(RETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-message-ttl': RETRY_DELAY_MS,
      'x-dead-letter-exchange': '', // the default exchange...
      'x-dead-letter-routing-key': EMAIL_QUEUE, // ...routes it back to the email queue
    },
  });
  await channel.assertQueue(EMAIL_QUEUE, { durable: true });
  await channel.bindQueue(EMAIL_QUEUE, EXCHANGE, 'order.created');
}

/** Connects without waiting, and reconnects by itself. `setup` runs after every (re)connection. */
export function connectBroker(
  setup: (connection: ChannelModel) => Promise<void>,
  onDisconnect?: () => void,
) {
  return amqp
    .connect(RABBITMQ_URL, {
      recovery: {
        initialDelay: 500,
        maxDelay: 5000,
        waitForConnect: false,
        setup,
      },
    })
    .then((connection) => {
      connection.on('error', () => {});
      connection.on('disconnect', () => onDisconnect?.());
      return connection;
    });
}
