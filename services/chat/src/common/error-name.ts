/**
 * 写日志用的错误类别：只取错误的名字。
 * 错误的 message / stack 可能带着模型输出或用户原文（例如结构化输出解析失败），不进日志。
 */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
