import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from './auth.config.js';

const base = { JWT_ACCESS_SECRET: 's'.repeat(32) };

describe('loadAuthConfig', () => {
  it('默认值', () =>
    expect(loadAuthConfig(base)).toEqual({
      accessSecret: 's'.repeat(32),
      accessTtl: '15m',
      refreshTtlDays: 30,
      cookieSecure: false,
      trustProxy: false,
      llmFake: false,
    }));

  it('缺少或过短的密钥启动失败', () => {
    expect(() => loadAuthConfig({})).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadAuthConfig({ JWT_ACCESS_SECRET: 's'.repeat(31) })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('生产环境禁止假模型', () => {
    expect(() => loadAuthConfig({ ...base, NODE_ENV: 'production', LLM_FAKE: '1' })).toThrow(/LLM_FAKE/);
    expect(loadAuthConfig({ ...base, LLM_FAKE: '1' }).llmFake).toBe(true);
  });

  it('读取覆盖值', () => {
    const c = loadAuthConfig({
      ...base,
      JWT_ACCESS_TTL: '5m',
      REFRESH_TTL_DAYS: '7',
      COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
    });
    expect(c).toMatchObject({ accessTtl: '5m', refreshTtlDays: 7, cookieSecure: true, trustProxy: true });
  });
});
