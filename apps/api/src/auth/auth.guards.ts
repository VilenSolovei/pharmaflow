import { CanActivate, ConflictException, ExecutionContext, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import type { PublicUser } from './auth.service.js';
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string; user?: PublicUser;
}
export function cookieToken(request: AuthRequest): string {
  const cookie = request.headers.cookie;
  if (typeof cookie !== 'string') return '';
  return cookie.split(';').map(x => x.trim()).find(x => x.startsWith('pharmaflow_session='))?.slice(19) ?? '';
}
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (req.headers.origin !== this.config.getOrThrow<string>('APP_ORIGIN') || req.headers['x-pharmaflow-request'] !== '1') {
      throw new ForbiddenException('Запит із недозволеного джерела.');
    }
    return true;
  }
}
@Injectable()
export class AuthRateGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  canActivate(context: ExecutionContext): boolean {
    const key = context.switchToHttp().getRequest<AuthRequest>().ip ?? 'unknown';
    const now = Date.now();
    for (const [k,v] of this.attempts) if (v.expires <= now) this.attempts.delete(k);
    const bucket = this.attempts.get(key) ?? { count: 0, expires: now + 15 * 60 * 1000 };
    if (bucket.count >= 20 || (!this.attempts.has(key) && this.attempts.size >= 10000)) {
      throw new HttpException('Забагато спроб. Спробуйте через 15 хвилин.', 429);
    }
    bucket.count++; this.attempts.set(key, bucket); return true;
  }
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    req.user = await this.auth.current(cookieToken(req)); return true;
  }
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<AuthRequest>().user?.role !== 'ADMIN') throw new ForbiddenException();
    return true;
  }
}

@Injectable()
export class AccountOwnerGuard implements CanActivate {
  canActivate(context:ExecutionContext):boolean {
    const req=context.switchToHttp().getRequest<AuthRequest>();
    if(req.headers['x-pharmaflow-user']!==req.user?.id)throw new ConflictException('Обліковий запис змінився. Оновіть сторінку.');
    return true;
  }
}
