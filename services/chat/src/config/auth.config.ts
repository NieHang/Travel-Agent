export interface AuthConfig {
  accessSecret: string;
  accessTtl: string;
  refreshTtlDays: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  llmFake: boolean;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

const MIN_SECRET_LENGTH = 32;
const DEFAULT_ACCESS_TTL = '15m';
/** 正整数加单位 s / m / h / d。不带单位的数字会被签发库当成毫秒，所以不接受。 */
const ACCESS_TTL_PATTERN = /^[1-9]\d*[smhd]$/;

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** `LLM_FAKE` 是否开启的唯一判定，配置校验与 LlmModule 的绑定共用。 */
export function isLlmFakeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.LLM_FAKE);
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const accessSecret = env.JWT_ACCESS_SECRET;
  if (!accessSecret || accessSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_ACCESS_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long`);
  }

  const refreshTtlDays = env.REFRESH_TTL_DAYS ? Number(env.REFRESH_TTL_DAYS) : 30;
  if (!Number.isInteger(refreshTtlDays) || refreshTtlDays <= 0) {
    throw new Error('REFRESH_TTL_DAYS must be a positive integer');
  }

  // 空串与未设置一样取默认值，和其他变量一致。
  const accessTtl = env.JWT_ACCESS_TTL || DEFAULT_ACCESS_TTL;
  if (!ACCESS_TTL_PATTERN.test(accessTtl)) {
    throw new Error('JWT_ACCESS_TTL must be a positive integer followed by s, m, h or d (e.g. 15m)');
  }

  const llmFake = isLlmFakeEnabled(env);
  if (llmFake && env.NODE_ENV === 'production') {
    throw new Error('LLM_FAKE must not be enabled in production');
  }

  return {
    accessSecret,
    accessTtl,
    refreshTtlDays,
    cookieSecure: isTruthy(env.COOKIE_SECURE),
    trustProxy: isTruthy(env.TRUST_PROXY),
    llmFake,
  };
}
