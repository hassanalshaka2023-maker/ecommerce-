import {
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { type AuthUser, Role } from '../common/auth.js';
import { CacheService } from '../common/cache.service.js';
import { PageQueryDto } from '../common/page-query.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProductsService } from '../products/products.service.js';
import { WarehouseService } from '../warehouse/warehouse.service.js';
import { Order, OrderItem, OrderStatus } from './order.entity.js';
import { CreateOrderDto } from './orders.dto.js';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly items: Repository<OrderItem>,
    @InjectRepository(Order, 'replica')
    private readonly ordersReplica: Repository<Order>,
    @InjectRepository(OrderItem, 'replica')
    private readonly itemsReplica: Repository<OrderItem>,
    private readonly products: ProductsService,
    private readonly notifications: NotificationsService,
    private readonly warehouse: WarehouseService,
    private readonly cache: CacheService,
  ) {}

  async create(userId: string, { items }: CreateOrderDto) {
    const prices = await this.products.getPrices(items.map((i) => i.productId));
    const lines = items.map(({ productId, quantity }) => ({
      productId,
      quantity,
      unitPrice: prices[productId],
    }));
    const total = lines.reduce(
      (sum, line) => sum + Number(line.unitPrice) * line.quantity,
      0,
    );

    // The order is saved only after the warehouse reserves all items.
    const orderId = randomUUID();
    try {
      await this.warehouse.reserve(orderId, items);
    } catch (error) {
      // After a timeout we can't know if the stock was reserved, so release it to be safe.
      // Not awaited: the customer has already waited for the deadline once.
      if (error instanceof GatewayTimeoutException) {
        void this.warehouse.release(orderId).catch(() => {});
      }
      throw error;
    }

    let order: Order;
    try {
      order = await this.orders.save({
        id: orderId,
        userId,
        totalPrice: total.toFixed(2),
        items: lines,
      });
    } catch (error) {
      await this.warehouse.release(orderId).catch(() => {});
      throw error;
    }

    await this.cache.markWrite(userId);
    await this.notifications.notify(userId, `Order ${order.id} was created`);
    return order;
  }

  async findAll(user: AuthUser, { page = 1, limit = 10 }: PageQueryDto) {
    // The replica can be a moment behind. Admins, and customers who have just
    // ordered, read the primary so they always see the latest orders.
    const fresh =
      user.role === Role.ADMIN || (await this.cache.wroteRecently(user.id));
    const orderRepo = fresh ? this.orders : this.ordersReplica;
    const itemRepo = fresh ? this.items : this.itemsReplica;

    const [orders, total] = await orderRepo.findAndCount({
      where: user.role === Role.ADMIN ? {} : { userId: user.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    // One query for the items of the whole page, not one query per order (N+1).
    const items = await itemRepo.findBy({
      orderId: In(orders.map((order) => order.id)),
    });
    for (const order of orders) {
      order.items = items.filter((item) => item.orderId === order.id);
    }
    return { items: orders, total, page, limit };
  }

  async findOne(id: string, user: AuthUser) {
    const order = await this.load(id);
    // The core rule: a customer can only open their own orders.
    if (order.userId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('This order belongs to another user');
    }
    return order;
  }

  async updateStatus(id: string, status: OrderStatus) {
    const order = await this.load(id);
    order.status = status;
    await this.orders.save(order);
    await this.cache.markWrite(order.userId);
    await this.notifications.notify(
      order.userId,
      `Order ${id} is now ${status}`,
    );
    return order;
  }

  private async load(id: string) {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
