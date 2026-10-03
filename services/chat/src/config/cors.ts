import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

/** 前端与 API 跨源，Retry-After 不在默认可读的响应头里，倒计时依赖它，须显式放开。 */
export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  return {
    origin: env.CORS_ORIGIN || 'http://localhost:3002',
    credentials: true,
    exposedHeaders: ['Retry-After'],
  };
}
