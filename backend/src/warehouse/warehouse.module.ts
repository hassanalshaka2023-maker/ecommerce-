import { Module } from '@nestjs/common';
import { WarehouseService } from './warehouse.service.js';

@Module({
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
