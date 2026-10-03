import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatStreamEvent, MessageMetadata, Requirement } from '@autix/contracts';
import { AppException } from '../common/app.exception.js';
import { toMessageContract, type MessageRow } from '../conversations/conversations.service.js';
import { Prisma, type MessageStatus } from '../generated/prisma/client.js';
import {
  CHAT_REPLY_PORT,
  type ChatReplyPort,
  type ChatTurn,
} from '../llm/chat-reply/chat-reply.port.js';
import { RequirementService } from '../llm/requirement.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveTitle } from './derive-title.js';

export const HISTORY_LIMIT = 20;
export const REQUIREMENT_WAIT_MS = 15_000;

/** 抽取的结局：成功时是需求列表（可为空），否则是 `'failed'`；`undefined` 表示还没有结果。 */
type Extraction = Requirement[] | 'failed' | undefined;

/** 会话已被删除：外键不成立（P2003）或要更新的记录不存在（P2025）。 */
function isConversationGone(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2003' || error.code === 'P2025')
  );
}

const noop = () => {};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CHAT_REPLY_PORT) private readonly reply: ChatReplyPort,
    @Inject(RequirementService) private readonly requirements: Pick<RequirementService, 'extract'>,
  ) {}

  /**
   * 保存用户消息，流式产出助手回复，再保存助手消息。归属校验由调用方在此之前完成。
   *
   * 用户消息一旦落库，助手消息在每条出口上都恰好保存一次：
   * 回复正常结束为 `complete`，上游出错为 `error`，`signal` 中止或调用方提前结束迭代为 `partial`。
   */
  async *send(
    conversationId: string,
    content: string,
    signal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const userMessage = await this.saveUserMessage(conversationId, content);

    // 与传入的信号联动；生成器无论怎样结束都会中止它，让模型调用与抽取随之停止。
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    if (signal.aborted) abort.abort();
    else signal.addEventListener('abort', onAbort, { once: true });

    let text = '';
    let saved = false;
    let extraction: Extraction;
    let requirementSent = false;

    const metadata = (): MessageMetadata | undefined => {
      if (extraction === 'failed') return { requirementError: true };
      if (extraction && extraction.length > 0) return { requirements: extraction };
      return undefined;
    };

    /** 三条出口共用。会话已被删除时返回 `null`。 */
    const save = async (status: MessageStatus): Promise<MessageRow | null> => {
      saved = true;
      // 同一毫秒内写入的两行 createdAt 会相同；显式保证助手消息严格晚于用户消息。
      const at = new Date(Math.max(Date.now(), userMessage.createdAt.getTime() + 1));
      try {
        const [row] = await this.prisma.$transaction([
          this.prisma.message.create({
            data: {
              conversationId,
              role: 'ASSISTANT',
              content: text,
              status,
              metadata: metadata(),
              createdAt: at,
            },
          }),
          this.prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: at },
          }),
        ]);
        return row;
      } catch (error) {
        if (isConversationGone(error)) return null;
        throw error;
      }
    };

    const takeRequirement = (): ChatStreamEvent | null => {
      if (requirementSent || !extraction || extraction === 'failed' || extraction.length === 0) {
        return null;
      }
      requirementSent = true;
      return { event: 'requirement', data: { requirements: extraction } };
    };

    try {
      yield { event: 'user_message', data: { message: toMessageContract(userMessage) } };

      const history = await this.loadHistory(conversationId);
      if (abort.signal.aborted) return;

      // 抽取与回复并行，共用同一个中止信号。两个处理函数都不抛错，所以它不会成为未处理的拒绝。
      const extracting = (async () => this.requirements.extract(content, abort.signal))().then(
        (result) => {
          extraction ??= result.requirements;
        },
        (error: unknown) => {
          // 被我们自己中止而失败的不算抽取失败：metadata 只反映中止之前真正到达的结果。
          if (abort.signal.aborted) return;
          this.logger.warn(`Requirement extraction failed: ${String(error)}`);
          extraction ??= 'failed';
        },
      );

      let failed = false;
      const chunks = this.reply.streamReply(history, abort.signal)[Symbol.asyncIterator]();
      const pull = () => {
        const next = chunks.next();
        // 调用方可能在它还没有结果时就结束迭代，之后的拒绝不该成为未处理的拒绝。
        next.catch(noop);
        return next;
      };
      try {
        let next = pull();
        for (;;) {
          // 抽取还没有结果时两者一起等，谁先到先处理谁：抽取先到就立刻产出 requirement。
          const result = await (extraction === undefined ? Promise.race([next, extracting]) : next);
          if (abort.signal.aborted) return;
          const requirement = takeRequirement();
          if (requirement) yield requirement;
          if (!result) continue;
          if (result.done) break;
          text += result.value;
          yield { event: 'delta', data: { text: result.value } };
          next = pull();
        }
      } catch (error) {
        // 信号中止之后抛出的任何错误都算客户端中止，由 finally 存成 partial。
        if (abort.signal.aborted) return;
        this.logger.error(`Model stream failed: ${String(error)}`);
        failed = true;
        // 抽取结果已经用不上了，连同它一起中止。从这里起不再用信号区分出口，只看 failed。
        abort.abort();
      } finally {
        // 提前离开循环时让上游生成器收尾；不等待它，它可能正停在一次未完成的读取上。
        void Promise.resolve(chunks.return?.()).catch(noop);
      }

      if (failed) {
        const row = await save('error');
        if (row) {
          yield { event: 'error', data: { code: 'MODEL_FAILED', message: toMessageContract(row) } };
        }
        return;
      }

      if (extraction === undefined) {
        await waitFor(extracting, REQUIREMENT_WAIT_MS, abort.signal);
        if (abort.signal.aborted) return;
        // 超时按抽取失败处理；之后才到的结果不再采用。
        extraction ??= 'failed';
      }
      const requirement = takeRequirement();
      if (requirement) yield requirement;

      const row = await save('complete');
      if (row) yield { event: 'done', data: { message: toMessageContract(row) } };
    } finally {
      signal.removeEventListener('abort', onAbort);
      abort.abort();
      // 走到这里还没保存：信号已中止、调用方提前结束了迭代，或中途出了意外。
      if (!saved) await save('partial');
    }
  }

  /** 保存用户消息；会话标题为空时用这条消息生成标题。 */
  private async saveUserMessage(conversationId: string, content: string): Promise<MessageRow> {
    try {
      const [row] = await this.prisma.$transaction([
        this.prisma.message.create({ data: { conversationId, role: 'USER', content } }),
        this.prisma.conversation.updateMany({
          where: { id: conversationId, title: '' },
          data: { title: deriveTitle(content) },
        }),
      ]);
      return row;
    } catch (error) {
      // 归属校验之后、保存之前会话被删除。
      if (isConversationGone(error)) throw new AppException('CONVERSATION_NOT_FOUND', 404);
      throw error;
    }
  }

  /** 最近 `HISTORY_LIMIT` 条内容非空的消息，按时间正序。 */
  private async loadHistory(conversationId: string): Promise<ChatTurn[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, content: { not: '' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    });
    return rows.reverse().map((row) => ({
      role: row.role === 'USER' ? 'user' : 'assistant',
      content: row.content,
    }));
  }
}

/** 等 `promise` 完成，最长 `ms` 毫秒；`signal` 中止时立刻返回。不抛错。 */
function waitFor(promise: Promise<void>, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    void promise.then(finish);
    if (signal.aborted) finish();
  });
}
