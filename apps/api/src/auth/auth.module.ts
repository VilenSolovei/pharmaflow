import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity.js';
import { Session } from './session.entity.js';
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccountOwnerGuard, AdminGuard, AuthRateGuard, OriginGuard, SessionGuard } from './auth.guards.js';
@Module({ imports: [TypeOrmModule.forFeature([User, Session])], controllers: [AuthController], providers: [AccountOwnerGuard, AuthService, SessionGuard, AdminGuard, OriginGuard, AuthRateGuard],
  exports: [AccountOwnerGuard, AuthService, SessionGuard, AdminGuard, OriginGuard] })
export class AuthModule {}
