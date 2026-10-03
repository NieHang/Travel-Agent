import { Injectable } from '@nestjs/common';
import type { RequirementResult } from '@autix/contracts';
import type { ChatReplyPort, ChatTurn } from './chat-reply.port.js';

export const FAKE_REPLY_CHUNKS = ['好的，', '这是一段', '用于测试的回复。'];

export const FAKE_REQUIREMENTS: RequirementResult = {
  requirements: [
    { action: '规划行程', constraints: ['测试数据'], entities: ['行程'] },
  ],
};

@Injectable()
export class FakeChatReply implements ChatReplyPort {
  async *streamReply(
    _history: ChatTurn[],
    signal: AbortSignal,
  ): AsyncIterable<string> {
    for (const chunk of FAKE_REPLY_CHUNKS) {
      if (signal.aborted) return;
      yield chunk;
    }
  }
}

@Injectable()
export class FakeRequirementService {
  async extract(_input: string): Promise<RequirementResult> {
    return FAKE_REQUIREMENTS;
  }
}
