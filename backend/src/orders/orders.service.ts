import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { type AuthUser, Role } from '../common/auth.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProductsService } from '../products/products.service.js';
import { Order, OrderStatus } from './order.entity.js';
import { CreateOrderDto } from './orders.dto.js';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly products: ProductsService,
    private readonly notifications: NotificationsService,
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

    const order = await this.orders.save({
      userId,
      totalPrice: total.toFixed(2),
      items: lines,
    });
    await this.notifications.notify(userId, `Order ${order.id} was created`);
    return order;
  }

  findAll(user: AuthUser) {
    return this.orders.find({
      where: user.role === Role.ADMIN ? {} : { userId: user.id },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const order = await this.orders.findOneBy({ id });
    if (!order) throw new NotFoundException('Order not found');
    // The core rule: a customer can only open their own orders.
    if (order.userId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('This order belongs to another user');
    }
    return order;
  }

  async updateStatus(id: string, status: OrderStatus) {
    const order = await this.orders.findOneBy({ id });
    if (!order) throw new NotFoundException('Order not found');
    order.status = status;
    await this.orders.save(order);
    await this.notifications.notify(
      order.userId,
      `Order ${id} is now ${status}`,
    );
    return order;
  }
}
