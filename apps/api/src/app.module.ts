import { CatalogAdminModule } from './admin/catalog-admin.module.js';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationsModule } from './notifications/notifications.module.js';
import { LoyaltyModule } from './loyalty/loyalty.module.js';
import { AccountModule } from './account/account.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { CartModule } from './cart/cart.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { AuthModule } from './auth/auth.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(import.meta.dirname, '../../../.env'),
      validate: validateEnvironment,
    }),
    DatabaseModule,
    EventEmitterModule.forRoot(),
    NotificationsModule,
    HealthModule,
    AuthModule,
    AccountModule,
    LoyaltyModule,
    CatalogModule,
    CatalogAdminModule,
    CartModule,
    OrdersModule,
  ],
})
export class AppModule {}
