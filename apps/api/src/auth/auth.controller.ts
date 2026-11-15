import { Body, Controller, Get, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { LoginDto, RegisterDto } from './auth.dto.js';
import { AdminGuard, AuthRateGuard, cookieToken, OriginGuard, SessionGuard } from './auth.guards.js';
import type { AuthRequest } from './auth.guards.js';
interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}
  private cookieOptions() {
    return { httpOnly: true, sameSite: 'lax', secure: this.config.get('NODE_ENV') === 'production', path: '/api' };
  }
  @Post('register') @UseGuards(OriginGuard, AuthRateGuard)
  register(@Body() dto: RegisterDto) { return this.auth.register(dto.email, dto.password); }
  @Post('login') @HttpCode(200) @UseGuards(OriginGuard, AuthRateGuard) @Header('Cache-Control', 'no-store')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: CookieResponse) {
    const result = await this.auth.login(dto.email, dto.password);
    response.cookie('pharmaflow_session', result.token, { ...this.cookieOptions(), expires: result.expiresAt });
    return result.user;
  }
  @Get('me') @UseGuards(SessionGuard) @Header('Cache-Control', 'no-store')
  me(@Req() req: AuthRequest) { return req.user; }
  @Post('logout') @HttpCode(204) @UseGuards(OriginGuard)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) response: CookieResponse) {
    await this.auth.logout(cookieToken(req));
    response.clearCookie('pharmaflow_session', this.cookieOptions());
  }
  @Get('admin-access') @UseGuards(SessionGuard, AdminGuard) @Header('Cache-Control', 'no-store')
  adminAccess() { return { allowed: true }; }
}
