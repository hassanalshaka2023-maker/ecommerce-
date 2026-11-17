import { join } from 'node:path';
import {
  credentials,
  loadPackageDefinition,
  type ServiceError,
  status,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  ConflictException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

const TIMEOUT_MS = 2000;
// Same contract file the Python service uses.
const definition = loadSync(join(process.cwd(), '../proto/warehouse.proto'), {
  defaults: true,
});
const { warehouse } = loadPackageDefinition(definition) as any;

export interface StockItem {
  productId: string;
  quantity: number;
}

@Injectable()
export class WarehouseService {
  private readonly client = new warehouse.Warehouse(
    process.env.WAREHOUSE_URL ?? 'localhost:50051',
    credentials.createInsecure(),
  );

  async getStock(productId: string): Promise<number> {
    const stock = await this.call('GetStock', { productId });
    return stock.quantity;
  }

  setStock(productId: string, quantity: number) {
    return this.call('SetStock', { productId, quantity });
  }

  reserve(orderId: string, items: StockItem[]) {
    return this.call('ReserveStock', { orderId, items });
  }

  release(orderId: string) {
    return this.call('ReleaseStock', { orderId });
  }

  private call(method: string, request: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + TIMEOUT_MS;
      this.client[method](
        request,
        { deadline },
        (error: ServiceError | null, response: unknown) =>
          error ? reject(toHttpError(error)) : resolve(response),
      );
    });
  }
}

function toHttpError(error: ServiceError) {
  switch (error.code) {
    case status.FAILED_PRECONDITION:
      return new ConflictException(error.details);
    case status.INVALID_ARGUMENT:
      return new UnprocessableEntityException(error.details);
    case status.DEADLINE_EXCEEDED:
      return new GatewayTimeoutException(
        'The warehouse did not respond in time, please try again',
      );
    default:
      return new ServiceUnavailableException(
        'The warehouse service is unavailable, please try again later',
      );
  }
}
