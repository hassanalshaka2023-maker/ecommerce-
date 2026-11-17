import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { WarehouseModule } from '../warehouse/warehouse.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product]),
    TypeOrmModule.forFeature([Product], 'replica'),
    WarehouseModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
