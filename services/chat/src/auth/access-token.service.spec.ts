import { describe, expect, it } from 'vitest';
import type { AuthConfig } from '../config/auth.config.js';
import { AccessTokenService } from './access-token.service.js';

const config: AuthConfig = {
  accessSecret: 's'.repeat(32),
  accessTtl: '15m',
  refreshTtlDays: 30,
  cookieSecure: false,
  trustProxy: false,
  llmFake: false,
};
const svc = new AccessTokenService(config);

describe('AccessTokenService', () => {
  it('签发后可校验', async () => expect(await svc.verify(await svc.sign('u1'))).toEqual({ userId: 'u1' }));

  it('载荷只有 sub、iat、exp', async () => {
    const payload = JSON.parse(Buffer.from((await svc.sign('u1')).split('.')[1], 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('使用 HS256', async () => {
    const header = JSON.parse(Buffer.from((await svc.sign('u1')).split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
  });

  it('过期', async () => {
    const expired = new AccessTokenService({ ...config, accessTtl: '-1s' });
    await expect(svc.verify(await expired.sign('u1'))).rejects.toMatchObject({ code: 'TOKEN_EXPIRED', status: 401 });
  });

  it.each(['', 'abc', 'a.b.c'])('无效 token %s', async (t) =>
    expect(svc.verify(t)).rejects.toMatchObject({ code: 'TOKEN_INVALID' }),
  );

  it('其他密钥签发的 token 无效', async () => {
    const other = new AccessTokenService({ ...config, accessSecret: 'x'.repeat(32) });
    await expect(svc.verify(await other.sign('u1'))).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });
});
