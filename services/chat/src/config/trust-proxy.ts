import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthConfig } from './auth.config.js';

/** TRUST_PROXY 开启时信任的反向代理跳数。 */
export const TRUSTED_PROXY_HOPS = 1;

/**
 * 只信任紧邻的一跳反向代理，`req.ip` 取它追加在 X-Forwarded-For 末尾的地址。
 * 不能设为 `true`：那会信任整条链，`req.ip` 变成最左边那段，而它由客户端随意填写，
 * 轮换它就能绕过按 IP 的限流并伪造审计里的 ip。
 */
export function applyTrustProxy(
  app: Pick<NestExpressApplication, 'set'>,
  config: Pick<AuthConfig, 'trustProxy'>,
): void {
  if (config.trustProxy) app.set('trust proxy', TRUSTED_PROXY_HOPS);
}
