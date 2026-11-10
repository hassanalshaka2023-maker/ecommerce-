import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity.js';
import { ProductsService } from './products.service.js';
import { ProductsController } from './products.controller.js';
import { InventoryModule } from '../inventory/inventory.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Product]), InventoryModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
