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

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
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

  const llmFake = isTruthy(env.LLM_FAKE);
  if (llmFake && env.NODE_ENV === 'production') {
    throw new Error('LLM_FAKE must not be enabled in production');
  }

  return {
    accessSecret,
    accessTtl: env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays,
    cookieSecure: isTruthy(env.COOKIE_SECURE),
    trustProxy: isTruthy(env.TRUST_PROXY),
    llmFake,
  };
}
