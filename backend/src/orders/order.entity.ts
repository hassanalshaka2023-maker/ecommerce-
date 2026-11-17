import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

// Users and products belong to other modules, so we keep only their ids here.
@Entity('orders')
// "My orders, newest first" is answered from this index alone.
@Index(['userId', 'createdAt'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({ name: 'total_price', type: 'decimal', precision: 10, scale: 2 })
  totalPrice: string;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: Relation<Order>;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column('int')
  quantity: number;

  // Price at the time of purchase, so later price changes don't alter old orders.
  @Column({ name: 'unit_price', type: 'decimal', precision: 10, scale: 2 })
  unitPrice: string;
}
