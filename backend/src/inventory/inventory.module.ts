import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { INVENTORY_PACKAGE, InventoryClient } from './inventory.client.js';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: INVENTORY_PACKAGE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'inventory',
            protoPath: join(import.meta.dirname, '..', 'proto', 'inventory.proto'),
            url: configService.get<string>('INVENTORY_GRPC_URL', 'localhost:50051'),
            // Without `defaults`, proto3 drops zero values, so quantity 0 would arrive as undefined.
            loader: { defaults: true },
          },
        }),
      },
    ]),
  ],
  providers: [InventoryClient],
  exports: [InventoryClient],
})
export class InventoryModule {}
