import { describe, expect, it } from 'vitest';
import { TITLE_LENGTH, deriveTitle } from './derive-title.js';

describe('deriveTitle', () => {
  it('压缩连续空白并截取前 30 个字符', () => {
    expect(deriveTitle('  去\n\n里斯本   5 天  ')).toBe('去 里斯本 5 天');
    expect(deriveTitle('a'.repeat(40))).toBe('a'.repeat(30));
    expect(TITLE_LENGTH).toBe(30);
  });

  it('按字符而非码元截断，不切开表情', () => {
    const t = deriveTitle('a'.repeat(29) + '😀' + 'tail');
    expect(Array.from(t)).toHaveLength(30);
    expect(t.endsWith('😀')).toBe(true);
    // String.prototype.isWellFormed 属于 ES2024，运行时有，但本项目的 lib 是 ES2023。
    expect((t as string & { isWellFormed(): boolean }).isWellFormed()).toBe(true);
  });
});
