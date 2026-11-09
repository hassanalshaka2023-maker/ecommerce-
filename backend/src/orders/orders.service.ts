import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { OrderStatus } from '../common/enums/order-status.enum.js';
import type { AuthenticatedUser } from '../users/auth/jwt-payload.interface.js';
import { Role } from '../common/enums/role.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { InventoryClient } from '../inventory/inventory.client.js';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    private readonly notificationsService: NotificationsService,
    private readonly inventoryClient: InventoryClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 1. Check the products exist and price the order (local database).
   * 2. Ask the inventory service to reserve every item in one call.
   * 3. Save the order. If saving fails, release the reservation (compensation),
   *    because the two databases cannot share one transaction.
   */
  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    const productIds = [...new Set(dto.items.map((line) => line.productId))];
    const products = await this.productsRepository.findBy({ id: In(productIds) });
    const productsById = new Map(products.map((product) => [product.id, product]));

    let totalPrice = 0;
    const orderItems = dto.items.map((line) => {
      const product = productsById.get(line.productId);
      if (!product) {
        throw new BadRequestException(`Product ${line.productId} does not exist`);
      }
      totalPrice += Number(product.price) * line.quantity;
      return this.orderItemsRepository.create({
        productId: product.id,
        quantity: line.quantity,
        unitPrice: product.price,
      });
    });

    // The order id doubles as the reservation reference in the inventory service.
    const orderRef = randomUUID();
    try {
      await this.inventoryClient.reserve(
        orderRef,
        dto.items.map(({ productId, quantity }) => ({ productId, quantity })),
      );
    } catch (error) {
      // On a timeout the reservation may still have gone through on the other
      // side, so give it back. Release is a no-op if nothing was reserved.
      if (error instanceof ServiceUnavailableException) {
        void this.inventoryClient.releaseQuietly(orderRef);
      }
      throw error;
    }

    let createdOrder: Order;
    try {
      if (this.configService.get<string>('SIMULATE_ORDER_SAVE_FAILURE') === 'true') {
        throw new Error('Simulated order save failure (SIMULATE_ORDER_SAVE_FAILURE=true)');
      }
      createdOrder = await this.ordersRepository.save(
        this.ordersRepository.create({
          id: orderRef,
          userId,
          status: OrderStatus.PENDING,
          totalPrice: totalPrice.toFixed(2),
          items: orderItems,
        }),
      );
    } catch (error) {
      await this.inventoryClient.releaseQuietly(orderRef);
      throw error;
    }

    await this.notificationsService.create(
      userId,
      `Your order #${createdOrder.id} has been created.`,
    );

    return createdOrder;
  }

  async findForUser(currentUser: AuthenticatedUser): Promise<Order[]> {
    if (currentUser.role === Role.ADMIN) {
      return this.ordersRepository.find({ order: { createdAt: 'DESC' } });
    }
    return this.ordersRepository.find({
      where: { userId: currentUser.id },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, currentUser: AuthenticatedUser): Promise<Order> {
    const order = await this.ordersRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    this.assertCanAccess(order, currentUser);
    return order;
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const order = await this.ordersRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    order.status = status;
    const saved = await this.ordersRepository.save(order);
    await this.notificationsService.create(
      order.userId,
      `Your order #${order.id} status changed to ${status}.`,
    );
    return saved;
  }

  private assertCanAccess(order: Order, currentUser: AuthenticatedUser): void {
    const isOwner = order.userId === currentUser.id;
    const isAdmin = currentUser.role === Role.ADMIN;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('You do not have access to this order');
    }
  }
}
