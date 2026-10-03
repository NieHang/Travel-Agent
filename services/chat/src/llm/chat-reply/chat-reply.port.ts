export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export interface ChatReplyPort {
  streamReply(
    history: ChatTurn[],
    signal: AbortSignal,
  ): AsyncIterable<string>;
}

export const CHAT_REPLY_PORT = Symbol('CHAT_REPLY_PORT');

export const TRAVEL_SYSTEM_PROMPT =
  '你是 Hilda，一位旅行规划助手。根据用户的目的地、天数、预算和偏好给出具体可执行的建议。信息不足时先提出最关键的一个问题。使用用户所用的语言回答，保持简洁。';
