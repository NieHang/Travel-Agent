import { decodeCursor, encodeCursor } from './cursor.js';

describe('cursor', () => {
  it('往返', () => {
    const d = new Date('2026-10-03T08:00:00.123Z');
    expect(decodeCursor(encodeCursor(d, 'abc'))).toEqual({
      sortKey: d,
      id: 'abc',
    });
  });

  it('游标是 base64url', () =>
    expect(encodeCursor(new Date(), 'a')).toMatch(/^[A-Za-z0-9_-]+$/));

  it.each([
    '',
    '!!!',
    'bm90LWpzb24',
    Buffer.from('{"t":"bad","id":"a"}').toString('base64url'),
    Buffer.from('{"t":"2026-10-03T08:00:00.000Z","id":1}').toString(
      'base64url',
    ),
  ])('非法游标 %s 抛 VALIDATION_FAILED', (raw) => {
    expect(() => decodeCursor(raw)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});
