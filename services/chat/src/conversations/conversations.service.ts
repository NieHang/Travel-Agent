import { Inject, Injectable } from '@nestjs/common';
import type { Conversation, Message, MessageMetadata, Page } from '@autix/contracts';
import { AppException } from '../common/app.exception.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import type {
  Conversation as ConversationRow,
  Message as MessageRow,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type { ConversationRow, MessageRow };

export function toConversationContract(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMessageContract(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    status: row.status,
    metadata: (row.metadata as MessageMetadata | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Prisma 的 contains 不转义 LIKE 通配符；Postgres 默认转义符是反斜杠。 */
function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Injectable()
export class ConversationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 不存在或不属于该用户一律 404，不泄露存在性。 */
  async assertOwned(userId: string, id: string): Promise<ConversationRow> {
    const row = await this.prisma.conversation.findFirst({ where: { id, userId } });
    if (!row) throw new AppException('CONVERSATION_NOT_FOUND', 404);
    return row;
  }

  async list(
    userId: string,
    query: { cursor?: string; limit: number; q?: string },
  ): Promise<Page<Conversation>> {
    const where: Prisma.ConversationWhereInput = {
      userId,
      messages: { some: {} },
    };
    if (query.q) where.title = { contains: escapeLike(query.q), mode: 'insensitive' };
    if (query.cursor) {
      const { sortKey, id } = decodeCursor(query.cursor);
      where.AND = [{ OR: [{ updatedAt: { lt: sortKey } }, { updatedAt: sortKey, id: { lt: id } }] }];
    }
    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      items: items.map(toConversationContract),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.updatedAt, last.id) : null,
    };
  }

  async create(userId: string, title?: string): Promise<Conversation> {
    const row = await this.prisma.conversation.create({ data: { userId, title: title ?? '' } });
    return toConversationContract(row);
  }

  async rename(userId: string, id: string, title: string): Promise<Conversation> {
    const existing = await this.assertOwned(userId, id);
    // 显式写回原 updatedAt，否则 @updatedAt 会把它刷新。
    const row = await this.prisma.conversation.update({
      where: { id: existing.id },
      data: { title, updatedAt: existing.updatedAt },
    });
    return toConversationContract(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);
    await this.prisma.conversation.deleteMany({ where: { id, userId } });
  }

  async listMessages(
    userId: string,
    id: string,
    query: { cursor?: string; limit: number },
  ): Promise<Page<Message>> {
    await this.assertOwned(userId, id);
    const where: Prisma.MessageWhereInput = { conversationId: id };
    if (query.cursor) {
      const { sortKey, id: cursorId } = decodeCursor(query.cursor);
      where.AND = [
        { OR: [{ createdAt: { lt: sortKey } }, { createdAt: sortKey, id: { lt: cursorId } }] },
      ];
    }
    const rows = await this.prisma.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      items: items.map(toMessageContract),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
}
