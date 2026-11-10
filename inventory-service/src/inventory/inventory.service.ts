import { setTimeout as sleep } from 'node:timers/promises';
import { status } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Stock } from './entities/stock.entity.js';
import { Reservation, ReservationStatus } from './entities/reservation.entity.js';
import type { ReserveItem } from './inventory.interfaces.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(Stock)
    private readonly stockRepository: Repository<Stock>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async getStock(productId: string): Promise<Stock> {
    this.assertUuid(productId, 'productId');
    await this.simulateSlowness();

    const stock = await this.stockRepository.findOne({ where: { productId } });
    if (!stock) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `No stock record for product ${productId}`,
      });
    }
    return stock;
  }

  async setStock(productId: string, quantity: number): Promise<Stock> {
    this.assertUuid(productId, 'productId');
    this.assertQuantity(quantity, 0);

    await this.stockRepository.upsert({ productId, quantity }, ['productId']);
    return this.stockRepository.findOneByOrFail({ productId });
  }

  /**
   * Reserves every item of one order, all or nothing.
   *
   * Each item is taken with a single conditional UPDATE
   * (`quantity >= requested`), so Postgres row locks serialise concurrent
   * reservations of the same product: when two orders race for the last unit,
   * the second UPDATE re-checks the condition after the first commits and
   * matches no row. Any failure throws and rolls back the whole transaction.
   */
  async reserve(orderRef: string, items: ReserveItem[]): Promise<void> {
    this.assertUuid(orderRef, 'orderRef');
    if (!items?.length) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'At least one item is required',
      });
    }

    // Merge repeated products, then lock rows in a fixed order to avoid deadlocks.
    const quantities = new Map<string, number>();
    for (const item of items) {
      this.assertUuid(item.productId, 'productId');
      this.assertQuantity(item.quantity, 1);
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }
    const sortedItems = [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b));

    await this.simulateSlowness();

    await this.dataSource.transaction(async (manager) => {
      // A retried request with the same orderRef must not reserve twice.
      const alreadyReserved = await manager.exists(Reservation, { where: { orderRef } });
      if (alreadyReserved) return;

      for (const [productId, quantity] of sortedItems) {
        const result = await manager
          .createQueryBuilder()
          .update(Stock)
          .set({ quantity: () => 'quantity - :quantity' })
          .where('product_id = :productId AND quantity >= :quantity', { productId, quantity })
          .execute();

        if (!result.affected) {
          const exists = await manager.exists(Stock, { where: { productId } });
          throw new RpcException(
            exists
              ? {
                  code: status.FAILED_PRECONDITION,
                  message: `Insufficient stock for product ${productId}`,
                }
              : {
                  code: status.NOT_FOUND,
                  message: `No stock record for product ${productId}`,
                },
          );
        }
      }

      await manager.insert(
        Reservation,
        sortedItems.map(([productId, quantity]) => ({ orderRef, productId, quantity })),
      );
    });

    this.logger.log(`Reserved stock for order ${orderRef}`);
  }

  /**
   * Gives back everything an order reserved. Safe to call more than once and
   * for an orderRef that never reserved anything: it then returns false.
   */
  async release(orderRef: string): Promise<boolean> {
    this.assertUuid(orderRef, 'orderRef');

    const released = await this.dataSource.transaction(async (manager) => {
      const reservations = await manager.find(Reservation, {
        where: { orderRef, status: ReservationStatus.RESERVED },
        lock: { mode: 'pessimistic_write' },
      });
      if (reservations.length === 0) return false;

      for (const reservation of reservations) {
        await manager.increment(
          Stock,
          { productId: reservation.productId },
          'quantity',
          reservation.quantity,
        );
      }
      await manager.update(
        Reservation,
        reservations.map((reservation) => reservation.id),
        { status: ReservationStatus.RELEASED },
      );
      return true;
    });

    if (released) this.logger.log(`Released stock for order ${orderRef}`);
    return released;
  }

  // Lets a demo show the client-side deadline without stopping the service.
  private async simulateSlowness(): Promise<void> {
    const delayMs = Number(this.configService.get('INVENTORY_SIMULATED_DELAY_MS', 0));
    if (delayMs > 0) await sleep(delayMs);
  }

  private assertUuid(value: string, field: string): void {
    if (!UUID_PATTERN.test(value ?? '')) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `${field} must be a UUID`,
      });
    }
  }

  private assertQuantity(value: number, min: number): void {
    if (!Number.isInteger(value) || value < min) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `quantity must be an integer of at least ${min}`,
      });
    }
  }
}
