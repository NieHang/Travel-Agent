import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/app.exception.js';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config.js';

@Injectable()
export class AccessTokenService {
  private readonly jwt: JwtService;

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {
    this.jwt = new JwtService({
      secret: config.accessSecret,
      signOptions: { algorithm: 'HS256', expiresIn: config.accessTtl as never },
      verifyOptions: { algorithms: ['HS256'] },
    });
  }

  sign(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId });
  }

  async verify(token: string): Promise<{ userId: string }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      if (typeof payload.sub !== 'string' || !payload.sub) {
        throw new AppException('TOKEN_INVALID', 401);
      }
      return { userId: payload.sub };
    } catch (err) {
      if (err instanceof AppException) throw err;
      if (err instanceof Error && err.name === 'TokenExpiredError') {
        throw new AppException('TOKEN_EXPIRED', 401);
      }
      throw new AppException('TOKEN_INVALID', 401);
    }
  }
}
