import amqp from 'amqplib';

// Runs once, after every test file: removes the test exchange and queues (RABBIT_PREFIX=test.)
// so they never show up next to the real ones in RabbitMQ's management page.
export default function setup() {
  return async function teardown() {
    const connection = await amqp.connect('amqp://guest:guest@localhost:5672');
    const channel = await connection.createChannel();
    for (const queue of [
      'test.emails',
      'test.emails.retry',
      'test.emails.dlq',
    ]) {
      await channel.deleteQueue(queue);
    }
    await channel.deleteExchange('test.orders.events');
    await connection.close();
  };
}
