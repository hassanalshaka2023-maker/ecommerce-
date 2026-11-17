import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProductsModule } from '../products/products.module.js';
import { UsersModule } from '../users/users.module.js';
import { WarehouseModule } from '../warehouse/warehouse.module.js';
import { Order, OrderItem } from './order.entity.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem]),
    TypeOrmModule.forFeature([Order, OrderItem], 'replica'),
    ProductsModule,
    NotificationsModule,
    WarehouseModule,
    EventsModule,
    UsersModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
