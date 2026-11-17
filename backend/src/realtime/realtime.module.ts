import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { RealtimeConsumer } from './realtime.consumer.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [OrdersModule],
  providers: [RealtimeGateway, RealtimeConsumer],
})
export class RealtimeModule {}
