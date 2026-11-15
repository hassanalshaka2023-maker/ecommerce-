import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from './common/cache.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { EventsModule } from './events/events.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ProductsModule } from './products/products.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { UsersModule } from './users/users.module.js';
import { WarehouseModule } from './warehouse/warehouse.module.js';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        autoLoadEntities: true,
        synchronize: true,
        // DB_LOGGING=true prints every SQL query, to see what a request really costs.
        logging: process.env.DB_LOGGING === 'true',
      }),
    }),
    // Read-only copy of the database, used by the busiest read endpoints.
    // Without DATABASE_REPLICA_URL those reads simply go to the primary.
    TypeOrmModule.forRootAsync({
      name: 'replica',
      useFactory: () => ({
        type: 'postgres',
        url: process.env.DATABASE_REPLICA_URL ?? process.env.DATABASE_URL,
        autoLoadEntities: true,
        logging: process.env.DB_LOGGING === 'true',
      }),
    }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: '1h' },
      }),
    }),
    CacheModule,
    UsersModule,
    ProductsModule,
    OrdersModule,
    NotificationsModule,
    WarehouseModule,
    EventsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
