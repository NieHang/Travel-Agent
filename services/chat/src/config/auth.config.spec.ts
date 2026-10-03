import { describe, expect, it } from 'vitest';
import { isLlmFakeEnabled, loadAuthConfig } from './auth.config.js';

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

  it.each(['15m', '900s', '1h', '7d'])('JWT_ACCESS_TTL=%s 合法', (ttl) =>
    expect(loadAuthConfig({ ...base, JWT_ACCESS_TTL: ttl }).accessTtl).toBe(ttl));

  it.each(['900', 'abc', '0m', '-5m', '15 m', '15M', '1.5h', '15m '])(
    'JWT_ACCESS_TTL=%j 非法时启动失败',
    (ttl) => expect(() => loadAuthConfig({ ...base, JWT_ACCESS_TTL: ttl })).toThrow(/JWT_ACCESS_TTL/),
  );

  it('JWT_ACCESS_TTL 为空串时与其他变量一样取默认值', () =>
    expect(loadAuthConfig({ ...base, JWT_ACCESS_TTL: '' }).accessTtl).toBe('15m'));

  it('LLM_FAKE 的取值只有一种解释', () => {
    for (const on of ['1', 'true', 'TRUE']) {
      expect(isLlmFakeEnabled({ LLM_FAKE: on })).toBe(true);
      expect(loadAuthConfig({ ...base, LLM_FAKE: on }).llmFake).toBe(true);
      expect(() => loadAuthConfig({ ...base, NODE_ENV: 'production', LLM_FAKE: on })).toThrow(/LLM_FAKE/);
    }
    for (const off of [undefined, '', '0', 'false']) {
      expect(isLlmFakeEnabled({ LLM_FAKE: off })).toBe(false);
      expect(loadAuthConfig({ ...base, LLM_FAKE: off }).llmFake).toBe(false);
    }
  });
});
