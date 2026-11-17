import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConsumeMessage, RecoveringChannelModel } from 'amqplib';
import type { OrderStatusChanged } from '../messaging/broker.js';
import {
  assertTopology,
  connectBroker,
  EXCHANGE,
} from '../messaging/broker.js';
import { RealtimeGateway } from './realtime.gateway.js';

/** Listens to the order events in RabbitMQ and pushes them to the screens that follow them. */
@Injectable()
export class RealtimeConsumer implements OnModuleInit, OnModuleDestroy {
  private connection?: RecoveringChannelModel;

  constructor(private readonly gateway: RealtimeGateway) {}

  async onModuleInit() {
    this.connection = await connectBroker(async (connection) => {
      const channel = await connection.createChannel();
      channel.on('error', () => {});
      await assertTopology(channel);
      // Every API instance gets its own temporary queue, so every instance sees every event.
      const { queue } = await channel.assertQueue('', {
        exclusive: true,
        autoDelete: true,
      });
      await channel.bindQueue(queue, EXCHANGE, '#');
      await channel.consume(queue, (message) => message && this.push(message), {
        noAck: true,
      });
    });
  }

  async onModuleDestroy() {
    await this.connection?.close().catch(() => {});
  }

  private push(message: ConsumeMessage) {
    const event = JSON.parse(message.content.toString());
    const { server } = this.gateway;

    if (message.fields.routingKey === 'order.created') {
      server.to('admin').emit('order.created', event);
    } else if (message.fields.routingKey === 'order.status_changed') {
      const { orderId } = event as OrderStatusChanged;
      server
        .to(`order:${orderId}`)
        .to('admin')
        .emit('order.status_changed', event);
    }
  }
}
