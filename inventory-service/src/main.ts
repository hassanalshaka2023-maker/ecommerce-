import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.GRPC,
    options: {
      package: 'inventory',
      protoPath: join(import.meta.dirname, 'proto', 'inventory.proto'),
      url: process.env.GRPC_URL ?? '0.0.0.0:50051',
      // Without `defaults`, proto3 drops zero values, so quantity 0 would arrive as undefined.
      loader: { defaults: true },
    },
  });
  await app.listen();
}
await bootstrap();
