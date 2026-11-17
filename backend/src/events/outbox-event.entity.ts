import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// An event waiting to be sent to RabbitMQ. It is saved in the same transaction as the
// change that caused it, so an event is never lost and never sent for a change that failed.
@Entity('outbox_events')
@Index(['createdAt'], { where: '"published_at" IS NULL' })
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Only the relay of the same exchange sends it (tests use their own).
  @Column()
  exchange: string;

  @Column({ name: 'routing_key' })
  routingKey: string;

  @Column({ type: 'jsonb' })
  payload: object;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt: Date | null;
}
