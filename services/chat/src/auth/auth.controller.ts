import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthResult,
  type LoginRequest,
  type RegisterRequest,
} from '@autix/contracts';
import type { CookieOptions, Request, Response } from 'express';
import type { ClientContext } from '../audit/audit.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config.js';
import { AppThrottlerGuard } from './app-throttler.guard.js';
import { AuthService, RefreshException, type AuthSession } from './auth.service.js';
import { Public } from './decorators.js';

export const REFRESH_COOKIE = 'hilda_rt';

const USER_AGENT_MAX = 255;
const CREDENTIALS_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const SESSION_LIMIT = { default: { limit: 60, ttl: 60_000 } };

@Public()
@UseGuards(AppThrottlerGuard)
@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Throttle(CREDENTIALS_LIMIT)
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(RegisterRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    return this.respond(res, await this.auth.register(body, clientContext(req)));
  }

  @Throttle(CREDENTIALS_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    return this.respond(res, await this.auth.login(body, clientContext(req)));
  }

  @Throttle(SESSION_LIMIT)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    try {
      return this.respond(res, await this.auth.refresh(refreshCookie(req), clientContext(req)));
    } catch (error) {
      if (error instanceof RefreshException && error.clearCookie) this.clearCookie(res);
      throw error;
    }
  }

  @Throttle(SESSION_LIMIT)
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(refreshCookie(req), clientContext(req));
    this.clearCookie(res);
  }

  /** refresh token 只进 Cookie，响应体只有 `accessToken` 与 `user`。 */
  private respond(res: Response, session: AuthSession): AuthResult {
    // 向上取整到秒：Express 把 Max-Age 向下取整，否则请求耗时会让它少掉一秒。
    const maxAge = Math.ceil((session.refreshExpiresAt.getTime() - Date.now()) / 1000) * 1000;
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...this.cookieOptions(), maxAge });
    return { accessToken: session.accessToken, user: session.user };
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth',
      secure: this.config.cookieSecure,
    };
  }
}

function clientContext(req: Request): ClientContext {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, USER_AGENT_MAX),
  };
}

function refreshCookie(req: Request): string | undefined {
  // cookie-parser 会把 `j:` 前缀的值解析成对象，所以要确认是字符串。
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}
