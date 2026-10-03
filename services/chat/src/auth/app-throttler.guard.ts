import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequest } from './decorators.js';

/**
 * 只挂在需要限流的控制器或方法上（`@UseGuards(AppThrottlerGuard)`），不注册为全局 guard；
 * 额度由方法上的 `@Throttle` 给出。全局 JwtAuthGuard 先于它执行，所以登录后的路由按用户计数。
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const { user } = req as unknown as AuthenticatedRequest;
    if (user) return Promise.resolve(`user:${user.userId}`);
    // 父类按 req.ip 计数，并把 IPv6 地址归并到所在子网。
    return super.getTracker(req);
  }
}
