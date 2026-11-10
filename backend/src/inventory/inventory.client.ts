import { status } from '@grpc/grpc-js';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout, TimeoutError } from 'rxjs';
import type { InventoryGrpcService, ReserveItem } from './inventory.interfaces.js';

export const INVENTORY_PACKAGE = 'INVENTORY_PACKAGE';

/**
 * The only place the API talks to the inventory service. Every call has a
 * deadline, and every gRPC failure is turned into an HTTP exception here so
 * callers never see raw gRPC errors.
 */
@Injectable()
export class InventoryClient implements OnModuleInit {
  private readonly logger = new Logger(InventoryClient.name);
  private readonly timeoutMs: number;
  private inventoryService: InventoryGrpcService;

  constructor(
    @Inject(INVENTORY_PACKAGE) private readonly client: ClientGrpc,
    configService: ConfigService,
  ) {
    this.timeoutMs = Number(configService.get('INVENTORY_TIMEOUT_MS', 3000));
  }

  onModuleInit() {
    this.inventoryService = this.client.getService<InventoryGrpcService>('InventoryService');
  }

  async getStock(productId: string): Promise<number> {
    const stock = await this.call(this.inventoryService.getStock({ productId }));
    return stock.quantity;
  }

  async setStock(productId: string, quantity: number): Promise<number> {
    const stock = await this.call(this.inventoryService.setStock({ productId, quantity }));
    return stock.quantity;
  }

  async reserve(orderRef: string, items: ReserveItem[]): Promise<void> {
    await this.call(this.inventoryService.reserve({ orderRef, items }));
  }

  /**
   * Compensation: gives back what an order reserved. Never throws, because it
   * runs while another error is already being reported to the user.
   */
  async releaseQuietly(orderRef: string): Promise<void> {
    try {
      await this.call(this.inventoryService.release({ orderRef }));
    } catch (error) {
      this.logger.error(
        `Could not release the reservation of order ${orderRef}; its stock stays reserved`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request.pipe(timeout(this.timeoutMs)));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private toHttpException(error: unknown): HttpException {
    if (error instanceof TimeoutError) {
      return new ServiceUnavailableException(
        'The inventory service did not respond in time, please try again later',
      );
    }

    const { code, details } = (error ?? {}) as { code?: number; details?: string };
    switch (code) {
      case status.INVALID_ARGUMENT:
      case status.FAILED_PRECONDITION:
        return new BadRequestException(details);
      case status.NOT_FOUND:
        return new NotFoundException(details);
      case status.UNAVAILABLE:
      case status.DEADLINE_EXCEEDED:
        return new ServiceUnavailableException(
          'The inventory service is unavailable, please try again later',
        );
      default:
        this.logger.error('Unexpected inventory service error', error);
        return new BadGatewayException('The inventory service failed to handle the request');
    }
  }
}
