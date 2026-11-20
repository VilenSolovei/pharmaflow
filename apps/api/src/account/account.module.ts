import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { Prescription } from './prescription.entity.js';
@Module({imports:[AuthModule,TypeOrmModule.forFeature([Prescription])],controllers:[AccountController],providers:[AccountService]})
export class AccountModule {}
