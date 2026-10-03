import { corsOptions } from './cors.js';

describe('corsOptions', () => {
  it('默认来源、带凭据、放开 Retry-After', () => {
    expect(corsOptions({})).toEqual({
      origin: 'http://localhost:3002',
      credentials: true,
      exposedHeaders: ['Retry-After'],
    });
  });
  it('来源取自 CORS_ORIGIN', () => {
    expect(corsOptions({ CORS_ORIGIN: 'https://hilda.example' }).origin).toBe('https://hilda.example');
  });
});
