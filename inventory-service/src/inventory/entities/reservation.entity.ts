import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum ReservationStatus {
  RESERVED = 'RESERVED',
  RELEASED = 'RELEASED',
}

@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'order_ref', type: 'uuid' })
  orderRef: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'enum', enum: ReservationStatus, default: ReservationStatus.RESERVED })
  status: ReservationStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
