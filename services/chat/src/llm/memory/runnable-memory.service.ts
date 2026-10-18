import { BadRequestException, Injectable } from '@nestjs/common';
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import {
  RunnableLambda,
  RunnableWithMessageHistory,
} from '@langchain/core/runnables';
import type { ChatOpenAI } from '@langchain/openai';
import { createChatModel } from '../model.factory.js';

const prompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    '你是需求分析助手。结合当前会话的多轮对话记住业务目标、需求单号、功能和约束。' +
      '判断需求是否完整时，检查目标用户、业务场景、功能范围、输入输出、约束、异常处理和验收标准。' +
      '明确区分已知信息与缺失信息，说明判断依据并提出补充问题，不要编造未提供的需求。',
  ],
  new MessagesPlaceholder('history'),
  ['human', '{input}'],
]);

@Injectable()
export class RunnableMemoryService {
  private sessions = new Map<string, InMemoryChatMessageHistory>();
  private pending = new Map<string, Promise<unknown>>();

  // Share stored history and its per-session queue, while keeping prompt preparation separate.
  protected useHistoryFrom(memory: RunnableMemoryService): void {
    this.sessions = memory.sessions;
    this.pending = memory.pending;
  }

  private validateText(value: string, name: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${name} must be a non-empty string`);
    }
  }

  private history(sessionId: string) {
    let history = this.sessions.get(sessionId);
    if (!history) {
      history = new InMemoryChatMessageHistory();
      this.sessions.set(sessionId, history);
    }
    return history;
  }

  // Serialize reads and writes per session so overlapping turns cannot lose context.
  private async inSession<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.validateText(sessionId, 'sessionId');
    const previous = this.pending.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.pending.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.pending.get(sessionId) === current)
        this.pending.delete(sessionId);
    }
  }

  protected prepareMessages(
    messages: BaseMessage[],
    _model: ChatOpenAI,
  ): Promise<BaseMessage[]> {
    return Promise.resolve(messages);
  }

  async chat(sessionId: string, input: string) {
    this.validateText(input, 'input');
    return this.inSession(sessionId, async () => {
      // Create lazily: querying, appending, or clearing history needs no API key.
      const model = createChatModel();
      const runnable = prompt
        .pipe(
          RunnableLambda.from(async (value) =>
            this.prepareMessages(value.toChatMessages(), model),
          ),
        )
        .pipe(model);
      const chain = new RunnableWithMessageHistory({
        runnable,
        getMessageHistory: (id: string) => this.history(id),
        inputMessagesKey: 'input',
        historyMessagesKey: 'history',
      });
      const result = await chain.invoke(
        { input },
        { configurable: { sessionId } },
      );
      return { content: result.content };
    });
  }

  async getHistory(sessionId: string): Promise<BaseMessage[]> {
    return this.inSession(sessionId, async () => {
      const messages =
        (await this.sessions.get(sessionId)?.getMessages()) ?? [];
      // Return a snapshot; callers must not mutate the stored messages.
      return structuredClone(messages).map((message, index) =>
        messages[index].getType() === 'human'
          ? new HumanMessage(message)
          : new AIMessage(message),
      );
    });
  }

  async appendMessage(
    sessionId: string,
    human: string,
    ai: string,
  ): Promise<void> {
    this.validateText(human, 'human');
    this.validateText(ai, 'ai');
    await this.inSession(sessionId, () =>
      this.history(sessionId).addMessages([
        new HumanMessage(human),
        new AIMessage(ai),
      ]),
    );
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.inSession(sessionId, async () => {
      await this.sessions.get(sessionId)?.clear();
      this.sessions.delete(sessionId);
    });
  }
}
