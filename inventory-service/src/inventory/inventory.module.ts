import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stock } from './entities/stock.entity.js';
import { Reservation } from './entities/reservation.entity.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Stock, Reservation])],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
