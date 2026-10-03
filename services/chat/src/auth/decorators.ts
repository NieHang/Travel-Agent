import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/** 标在方法或类上：跳过全局 JwtAuthGuard。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthUser {
  userId: string;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

/** 取出 JwtAuthGuard 挂在请求上的当前用户。只能用在非 `@Public()` 的路由上。 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new Error('@CurrentUser() used on a route without JwtAuthGuard');
    return user;
  },
);
