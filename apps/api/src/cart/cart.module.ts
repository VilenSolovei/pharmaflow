import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Cart, CartItem } from './cart.entities.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';
@Module({imports:[AuthModule,TypeOrmModule.forFeature([Cart,CartItem])],controllers:[CartController],providers:[CartService],exports:[CartService]})
export class CartModule {}
