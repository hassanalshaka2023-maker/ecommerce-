import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('stock')
@Check('"quantity" >= 0')
export class Stock {
  @PrimaryColumn('uuid', { name: 'product_id' })
  productId: string;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
