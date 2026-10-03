import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from './refresh-token.js';

describe('refresh token', () => {
  it('每次不同，43 个 base64url 字符', () => {
    const a = generateRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(a);
  });

  it('哈希是确定的 64 位十六进制，且不等于原文', () => {
    expect(hashRefreshToken('x')).toBe(hashRefreshToken('x'));
    expect(hashRefreshToken('x')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken('x')).not.toBe('x');
  });
});
