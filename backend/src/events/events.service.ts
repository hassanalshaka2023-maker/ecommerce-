import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { ConfirmChannel, RecoveringChannelModel } from 'amqplib';
import { EntityManager, LessThan, Repository } from 'typeorm';
import {
  assertTopology,
  connectBroker,
  EXCHANGE,
} from '../messaging/broker.js';
import { OutboxEvent } from './outbox-event.entity.js';

@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private connection?: RecoveringChannelModel;
  private channel?: ConfirmChannel;
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outbox: Repository<OutboxEvent>,
  ) {}

  async onModuleInit() {
    // Does not wait for RabbitMQ: the API starts and serves orders even if it is down.
    this.connection = await connectBroker(
      async (connection) => {
        const channel = await connection.createConfirmChannel();
        channel.on('error', () => (this.channel = undefined));
        await assertTopology(channel);
        this.channel = channel;
        void this.flush();
      },
      () => (this.channel = undefined),
    );

    // Safety net: whatever is still in the outbox (broker was down, app crashed) goes out within a second.
    let ticks = 0;
    this.timer = setInterval(() => {
      void this.flush();
      if (++ticks % 600 === 0) void this.deleteOldEvents();
    }, 1000);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.connection?.close().catch(() => {});
  }

  /** Saves the event inside the caller's transaction. */
  record(manager: EntityManager, routingKey: string, payload: object) {
    return manager.save(OutboxEvent, {
      exchange: EXCHANGE,
      routingKey,
      payload,
    });
  }

  /** Sends the waiting events and marks them as sent once RabbitMQ has confirmed them. */
  async flush() {
    if (this.flushing || !this.channel) return;
    this.flushing = true;
    try {
      await this.outbox.manager.transaction(async (tx) => {
        const events = await tx
          .createQueryBuilder(OutboxEvent, 'event')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked') // two API instances never send the same event
          .where('event.publishedAt IS NULL AND event.exchange = :exchange', {
            exchange: EXCHANGE,
          })
          .orderBy('event.createdAt')
          .limit(50)
          .getMany();
        if (!events.length) return;

        for (const event of events) {
          this.channel!.publish(
            event.exchange,
            event.routingKey,
            Buffer.from(JSON.stringify(event.payload)),
            {
              persistent: true, // survives a RabbitMQ restart
              messageId: event.id,
              contentType: 'application/json',
            },
          );
          event.publishedAt = new Date();
        }
        await this.channel!.waitForConfirms();
        await tx.save(events);
      });
    } catch (error) {
      this.logger.warn(
        `Outbox flush failed, will retry: ${(error as Error).message}`,
      );
    } finally {
      this.flushing = false;
    }
  }

  private deleteOldEvents() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.outbox
      .delete({ publishedAt: LessThan(yesterday) })
      .catch(() => {});
  }
}
