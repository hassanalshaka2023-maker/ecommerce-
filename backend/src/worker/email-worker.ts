import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  assertTopology,
  connectBroker,
  DLQ,
  EMAIL_QUEUE,
  MAX_ATTEMPTS,
  type OrderCreated,
  RETRY_QUEUE,
} from '../messaging/broker.js';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export type SendEmail = (email: Email) => Promise<void>;

const escape = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

export function buildEmail({ order, customer }: OrderCreated): Email {
  const lines = order.items.map(
    (i) => `${i.quantity} x ${i.name} - $${i.unitPrice} each`,
  );
  const ref = order.id.slice(0, 8);
  return {
    to: customer.email,
    subject: `Order #${ref} confirmed`,
    text: `Hi ${customer.name},\n\nWe received your order #${ref}:\n${lines.join('\n')}\n\nTotal: $${order.totalPrice}\n`,
    html:
      `<p>Hi ${escape(customer.name)},</p><p>We received your order <b>#${ref}</b>:</p>` +
      `<ul>${lines.map((l) => `<li>${escape(l)}</li>`).join('')}</ul><p>Total: <b>$${order.totalPrice}</b></p>`,
  };
}

/**
 * Sends the confirmation email of every new order. `send` is injected, so tests can fake the mail server.
 *
 * The message is acknowledged only after the email was sent, so if the worker dies in the
 * middle, RabbitMQ gives the message to the next worker. A failure is retried after a delay;
 * after MAX_ATTEMPTS the message is moved to the dead-letter queue (DLQ) to be looked at.
 */
export function startEmailWorker(send: SendEmail) {
  return connectBroker(async (connection) => {
    const channel = await connection.createConfirmChannel();
    channel.on('error', () => {});
    await assertTopology(channel);
    await channel.prefetch(1); // one email at a time
    await channel.consume(EMAIL_QUEUE, async (message) => {
      if (!message) return;
      try {
        await send(buildEmail(JSON.parse(message.content.toString())));
        channel.ack(message);
        console.log(`email sent (message ${message.properties.messageId})`);
      } catch (error) {
        await retryOrBury(channel, message, error);
      }
    });
  });
}

async function retryOrBury(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  error: unknown,
) {
  const attempts = Number(message.properties.headers?.['x-attempts'] ?? 0) + 1;
  const target = attempts < MAX_ATTEMPTS ? RETRY_QUEUE : DLQ;
  console.warn(
    `email failed (attempt ${attempts}/${MAX_ATTEMPTS}) -> ${target}: ${String(error)}`,
  );
  try {
    channel.sendToQueue(target, message.content, {
      persistent: true,
      messageId: message.properties.messageId,
      headers: { 'x-attempts': attempts, 'x-error': String(error) },
    });
    await channel.waitForConfirms();
    channel.ack(message); // the copy is safe in the other queue, so the original can go
  } catch {
    channel.nack(message, false, true); // could not move it: put it back, nothing is lost
  }
}
