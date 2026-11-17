import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity.js';
import { Session } from './session.entity.js';
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AdminGuard, AuthRateGuard, OriginGuard, SessionGuard } from './auth.guards.js';
@Module({ imports: [TypeOrmModule.forFeature([User, Session])], controllers: [AuthController], providers: [AuthService, SessionGuard, AdminGuard, OriginGuard, AuthRateGuard],
  exports: [AuthService, SessionGuard, AdminGuard, OriginGuard] })
export class AuthModule {}
