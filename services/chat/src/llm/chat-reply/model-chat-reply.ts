import { Injectable } from '@nestjs/common';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createChatModel } from '../model.factory.js';
import {
  TRAVEL_SYSTEM_PROMPT,
  type ChatReplyPort,
  type ChatTurn,
} from './chat-reply.port.js';

@Injectable()
export class ModelChatReply implements ChatReplyPort {
  async *streamReply(
    history: ChatTurn[],
    signal: AbortSignal,
  ): AsyncIterable<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(TRAVEL_SYSTEM_PROMPT),
      ...history.map((turn) =>
        turn.role === 'user'
          ? new HumanMessage(turn.content)
          : new AIMessage(turn.content),
      ),
    ];
    const chunks = await createChatModel().stream(messages, { signal });
    for await (const chunk of chunks) {
      if (typeof chunk.content === 'string' && chunk.content !== '')
        yield chunk.content;
    }
  }
}
