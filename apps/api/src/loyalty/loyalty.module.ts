import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminLoyaltyController, LoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';
import { PricingService } from './pricing.service.js';
@Module({imports:[AuthModule],controllers:[LoyaltyController,AdminLoyaltyController],providers:[LoyaltyService,PricingService],exports:[LoyaltyService,PricingService]})
export class LoyaltyModule {}
