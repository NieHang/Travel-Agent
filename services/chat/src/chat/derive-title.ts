export const TITLE_LENGTH = 30;

/** 压缩连续空白后取前 `TITLE_LENGTH` 个字符；按码点切分，不会切开代理对。 */
export function deriveTitle(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return Array.from(collapsed).slice(0, TITLE_LENGTH).join('');
}
