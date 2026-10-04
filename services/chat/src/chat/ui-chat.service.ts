import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { SendMessageRequest, StreamMessage } from '@autix/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UIStreamService } from '../llm/ui-protocol/ui-stream.service.js';
import {
  readUIFlowSnapshot,
  requestContent,
  type PreparedUITurn,
} from '../llm/ui-protocol/ui-session.js';
import { toMessageContract } from '../conversations/conversations.service.js';
import { deriveTitle } from './derive-title.js';
import { validateUIAction } from '../llm/ui-protocol/ui-action.validation.js';

@Injectable()
export class UIChatService {
  private readonly active = new Set<string>();
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UIStreamService) private readonly stream: UIStreamService,
  ) {}

  private latest(conversationId: string) {
    return this.prisma.message.findFirst({
      where: {
        conversationId,
        role: 'ASSISTANT',
        status: 'complete',
        metadata: { path: ['uiFlowSnapshot', 'version'], equals: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
  async getState(conversationId: string) {
    const latest = await this.latest(conversationId);
    const snapshot = readUIFlowSnapshot(latest?.metadata);
    return {
      trip: snapshot?.trip ?? null,
      activeMessage: latest && snapshot ? toMessageContract(latest) : null,
    };
  }

  async *send(
    conversationId: string,
    request: SendMessageRequest,
    signal: AbortSignal,
  ): AsyncGenerator<StreamMessage> {
    if (this.active.has(conversationId))
      throw new ConflictException('Conversation is already generating');
    this.active.add(conversationId);
    const abort = new AbortController();
    const onAbort = () => abort.abort(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    let user:
      Awaited<ReturnType<PrismaService['message']['create']>> | undefined;
    let saved = false;
    let text = '';
    let turn: PreparedUITurn | undefined;
    const messageId = randomUUID();
    const timestamp = () => new Date().toISOString();
    const save = async (status: 'complete' | 'partial' | 'error') => {
      const at = new Date(Math.max(Date.now(), user!.createdAt.getTime() + 1));
      const metadata =
        status === 'complete' && turn
          ? {
              components: turn.response.components,
              interactionState: {
                sourceMessageId: messageId,
                revision: turn.snapshot.revision,
                active: true,
              },
              trip: turn.snapshot.trip,
              uiFlowSnapshot: turn.snapshot,
            }
          : undefined;
      const [row] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: {
            id: messageId,
            conversationId,
            role: 'ASSISTANT',
            content: text,
            status,
            createdAt: at,
            metadata: metadata as Prisma.InputJsonValue | undefined,
          },
        }),
        this.prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: at },
        }),
      ]);
      saved = true;
      return toMessageContract(row);
    };
    try {
      abort.signal.throwIfAborted();
      const latest = await this.latest(conversationId);
      const snapshot = readUIFlowSnapshot(latest?.metadata);
      if (
        'action' in request &&
        (!latest ||
          request.sourceMessageId !== latest.id ||
          request.revision !== snapshot?.revision ||
          !snapshot.response.components.some(
            (c) => c.id === request.action.componentId,
          ))
      )
        throw new ConflictException('UI component is no longer active');
      if ('action' in request) validateUIAction(snapshot!, request.action);
      const content = requestContent(request, snapshot);
      const [row] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: { conversationId, role: 'USER', content },
        }),
        this.prisma.conversation.updateMany({
          where: { id: conversationId, title: '' },
          data: { title: deriveTitle(content) },
        }),
      ]);
      user = row;
      yield {
        messageType: 'meta',
        timestamp: timestamp(),
        payload: { conversationId, userMessage: toMessageContract(row) },
      };
      const history = await this.prisma.message.findMany({
        where: { conversationId, content: { not: '' }, id: { not: row.id } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      });
      try {
        for await (const event of this.stream.streamTurn(
          snapshot,
          request,
          history
            .reverse()
            .map((m) =>
              m.role === 'USER'
                ? new HumanMessage(m.content)
                : new AIMessage(m.content),
            ),
          abort.signal,
        )) {
          abort.signal.throwIfAborted();
          if (event.type === 'progress')
            yield {
              messageType: 'progress',
              timestamp: timestamp(),
              payload: event.payload,
            };
          if (event.type === 'markdown') {
            text += event.content;
            yield {
              messageType: 'markdown',
              timestamp: timestamp(),
              payload: { messageId, content: event.content, isChunk: true },
            };
          }
          if (event.type === 'final') turn = event.turn;
        }
        abort.signal.throwIfAborted();
        if (!turn) throw new Error('UI stream ended without a final turn');
        if (!text) {
          text = turn.response.message;
          yield {
            messageType: 'markdown',
            timestamp: timestamp(),
            payload: { messageId, content: text, isChunk: false },
          };
        }
        yield {
          messageType: 'progress',
          timestamp: timestamp(),
          payload: {
            agent: 'save',
            step: 4,
            totalSteps: 4,
            status: 'started',
            label: 'save',
          },
        };
        const message = await save('complete');
        // Publish actionable UI only after the corresponding state is durable.
        yield {
          messageType: 'ui',
          timestamp: timestamp(),
          payload: {
            messageId,
            components: turn.response.components,
            interactionState: message.metadata?.interactionState,
          },
        };
        yield {
          messageType: 'meta',
          timestamp: timestamp(),
          payload: { conversationId, trip: turn.snapshot.trip },
        };
        yield {
          messageType: 'done',
          timestamp: timestamp(),
          payload: { message, trip: turn.snapshot.trip },
        };
      } catch (error) {
        if (abort.signal.aborted) return;
        if (saved) throw error;
        const message = await save('error');
        yield {
          messageType: 'error',
          timestamp: timestamp(),
          payload: { code: 'MODEL_FAILED', message },
        };
      }
    } finally {
      abort.abort();
      signal.removeEventListener('abort', onAbort);
      try {
        if (user && !saved) await save('partial');
      } finally {
        this.active.delete(conversationId);
      }
    }
  }
}
