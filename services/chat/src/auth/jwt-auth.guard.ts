import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../common/app.exception.js';
import { AccessTokenService } from './access-token.service.js';
import { IS_PUBLIC_KEY, type AuthenticatedRequest } from './decorators.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, ...rest] = (req.headers.authorization ?? '').trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'bearer') throw new AppException('TOKEN_MISSING', 401);
    if (rest.length !== 1) throw new AppException('TOKEN_INVALID', 401);

    // 只验签名与过期时间，不查库。
    req.user = await this.accessTokens.verify(rest[0]!);
    return true;
  }
}
