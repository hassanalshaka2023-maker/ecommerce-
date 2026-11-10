import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { InventoryService } from './inventory.service.js';
import type {
  GetStockRequest,
  ReleaseRequest,
  ReleaseResponse,
  ReserveRequest,
  ReserveResponse,
  SetStockRequest,
  StockResponse,
} from './inventory.interfaces.js';

@Controller()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @GrpcMethod('InventoryService', 'GetStock')
  async getStock({ productId }: GetStockRequest): Promise<StockResponse> {
    const stock = await this.inventoryService.getStock(productId);
    return { productId: stock.productId, quantity: stock.quantity };
  }

  @GrpcMethod('InventoryService', 'SetStock')
  async setStock({ productId, quantity }: SetStockRequest): Promise<StockResponse> {
    const stock = await this.inventoryService.setStock(productId, quantity);
    return { productId: stock.productId, quantity: stock.quantity };
  }

  @GrpcMethod('InventoryService', 'Reserve')
  async reserve({ orderRef, items }: ReserveRequest): Promise<ReserveResponse> {
    await this.inventoryService.reserve(orderRef, items);
    return { success: true };
  }

  @GrpcMethod('InventoryService', 'Release')
  async release({ orderRef }: ReleaseRequest): Promise<ReleaseResponse> {
    return { released: await this.inventoryService.release(orderRef) };
  }
}
