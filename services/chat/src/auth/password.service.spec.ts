import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('argon2id 哈希并校验', async () => {
    const h = await svc.hash('abcdefg1');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await svc.verify(h, 'abcdefg1')).toBe(true);
    expect(await svc.verify(h, 'abcdefg2')).toBe(false);
  });

  it('损坏的哈希返回 false 而不抛错', async () => expect(await svc.verify('garbage', 'x')).toBe(false));

  it('verifyDummy 不抛错', async () => {
    await expect(svc.verifyDummy('x')).resolves.toBeUndefined();
  });
});
