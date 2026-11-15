import { isDeepStrictEqual } from 'node:util';
import { ConflictException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { Command, Component, Message, SendTurnRequest, TripStreamEvent, TripUIState } from '@autix/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toMessageContract } from '../conversations/conversations.service.js';
import { deriveTitle } from '../chat/derive-title.js';
import { errorName } from '../common/error-name.js';
import { ContextManager } from '../llm/context-manager.js';
import { CommandError, assertAllowed, reduce, uncheckedDestination } from './commands.js';
import { copy } from './copy.js';
import { TRIP_LLM, type TripLlm } from './llm.js';
import { runEffect } from './effect.js';
import { readState, toTripView, type TripState } from './state.js';
import { describe, render, stageMessage } from './view.js';

@Injectable()
export class TurnService {
  private readonly logger = new Logger(TurnService.name);
  /** Each conversation's model context, kept across turns. */
  private readonly contexts = new Map<string, ContextManager>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TRIP_LLM) private readonly llm: TripLlm,
  ) {}

  async getState(conversationId: string): Promise<TripUIState> {
    const state = await this.load(conversationId);
    return { revision: state.revision, trip: toTripView(state), components: render(state, copy(state.locale)) };
  }

  /**
   * One turn. Everything before the first yield (revision check, stage check, claim) throws plain
   * HTTP errors, so the controller can still answer with JSON instead of SSE.
   */
  async *run(conversationId: string, request: SendTurnRequest, signal: AbortSignal): AsyncGenerator<TripStreamEvent> {
    const loaded = await this.load(conversationId);
    if (loaded.revision !== request.revision) throw new ConflictException('Trip state has changed');
    const state: TripState = { ...loaded, locale: request.locale ?? loaded.locale };
    try {
      assertAllowed(state, request.command);
    } catch (error) {
      if (error instanceof CommandError) throw new HttpException(error.message, error.status);
      throw error;
    }
    let text = '';
    let turn:
      | { status: 'unclaimed' }
      | { status: 'preparing' | 'streaming'; userCreatedAt: Date }
      | { status: 'saved' }
      | { status: 'settled'; message: Message } = { status: 'unclaimed' };
    let status: 'partial' | 'error' = 'partial';
    try {
      const user = await this.saveUserMessage(conversationId, describe(request.command, copy(state.locale), state), loaded, request.command);
      turn = { status: 'preparing', userCreatedAt: user.createdAt };
      const context = await this.context(conversationId, user.id);
      const current = new HumanMessage(user.content);
      context.addMessage(current);
      yield { type: 'start', userMessage: toMessageContract(user) };
      turn = { status: 'streaming', userCreatedAt: user.createdAt };

      // Compact before classifying, so every model call of this turn gets the compacted context.
      await context.maybeCompact(signal);
      // classify and respond add this turn's message themselves.
      const history = context.getMessages().filter((m) => m !== current);
      const command = request.command;
      const classified =
        command.type === 'message' ? await this.llm.classify({ text: command.text, state, history }, signal) : undefined;
      const destination = uncheckedDestination(state, command, classified);
      const place = destination ? { destination, ...(await this.llm.locate(destination, signal)) } : undefined;
      const { state: next, effect } = reduce(state, command, classified, place);
      if (classified && !request.locale) next.locale = classified.locale;

      let reply: string | null = null;
      if (effect) {
        const input = { text: command.type === 'message' ? command.text : null, state: next, history };
        const events = runEffect(this.llm, effect, input, signal);
        try {
          for (let step = await events.next(); ; step = await events.next()) {
            signal.throwIfAborted();
            if (step.done) {
              reply = step.value;
              break;
            }
            const event = step.value;
            // Only chat text is kept as a partial reply; a half-written draft never lands in the chat.
            if (event.type === 'text') text += event.delta;
            if (event.type === 'status' && event.phase === 'searching') text = '';
            yield event;
          }
        } finally {
          await events.return(null);
        }
      }
      signal.throwIfAborted();
      const c = copy(next.locale);
      const components = render(next, c);
      const message = await this.saveTurn(conversationId, next, reply ?? stageMessage(next, c, command), components, user.createdAt);
      turn = { status: 'saved' };
      yield { type: 'done', message, components, trip: toTripView(next) };
    } catch (error) {
      if (signal.aborted) return;
      status = 'error';
      if (turn.status !== 'streaming') throw error;
      this.logger.error(`Trip turn failed (${errorName(error)}) conversation=${conversationId}`);
    } finally {
      // Reached on abort, including when the consumer stops iterating: keep what was streamed.
      if (turn.status === 'preparing' || turn.status === 'streaming') {
        const message = await this.saveAssistant(conversationId, text, status, turn.userCreatedAt, state);
        turn = { status: 'settled', message };
      }
    }
    if (turn.status === 'settled') yield { type: 'error', code: 'MODEL_FAILED', message: turn.message };
  }

  private async load(conversationId: string): Promise<TripState> {
    const row = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { tripState: true, tripRevision: true },
    });
    return readState(row.tripState, row.tripRevision);
  }

  private async saveUserMessage(conversationId: string, content: string, loaded: TripState, command: Command) {
    // A failed user save must roll back the claim without creating an orphan assistant reply.
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.conversation.updateMany({
        where: { id: conversationId, tripRevision: loaded.revision },
        data: { tripRevision: { increment: 1 } },
      });
      if (claim.count !== 1) throw new ConflictException('Trip state has changed');
      // A commit keeps the revision, so a turn that loaded while another turn held this revision
      // can still claim it after that turn saved. Re-read under the row lock the claim now holds.
      const row = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { tripState: true } });
      if (!isDeepStrictEqual(readState(row.tripState, loaded.revision), loaded)) throw new ConflictException('Trip state has changed');
      const user = await tx.message.create({ data: { conversationId, role: 'USER', content, metadata: { command } } });
      await tx.conversation.updateMany({ where: { id: conversationId, title: '' }, data: { title: deriveTitle(content) } });
      return user;
    });
  }

  /** The conversation's context; built from its saved messages the first time (e.g. after a restart). */
  private async context(conversationId: string, excludeId: string): Promise<ContextManager> {
    const cached = this.contexts.get(conversationId);
    if (cached) return cached;
    const rows = await this.prisma.message.findMany({
      where: { conversationId, content: { not: '' }, id: { not: excludeId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { role: true, content: true },
    });
    const context = new ContextManager(rows.map((m) => (m.role === 'USER' ? new HumanMessage(m.content) : new AIMessage(m.content))));
    this.contexts.set(conversationId, context);
    return context;
  }

  /** Every saved assistant message goes into the context too, so it matches what a reload would build. */
  private remember(conversationId: string, content: string) {
    if (content) this.contexts.get(conversationId)?.addMessage(new AIMessage(content));
  }

  /** Assistant messages sort after their user message even within the same millisecond. */
  private after(userCreatedAt: Date): Date {
    return new Date(Math.max(Date.now(), userCreatedAt.getTime() + 1));
  }

  private async saveTurn(
    conversationId: string,
    next: TripState,
    content: string,
    components: Component[],
    userCreatedAt: Date,
  ): Promise<Message> {
    const at = this.after(userCreatedAt);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.conversation.updateMany({
        where: { id: conversationId, tripRevision: next.revision },
        data: { tripState: next as unknown as Prisma.InputJsonValue, updatedAt: at },
      });
      if (updated.count !== 1) throw new ConflictException('Trip state has changed');
      return tx.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content,
          status: 'complete',
          createdAt: at,
          metadata: { components, revision: next.revision } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    this.remember(conversationId, content);
    return toMessageContract(row);
  }

  private async saveAssistant(
    conversationId: string,
    content: string,
    status: 'partial' | 'error',
    userCreatedAt: Date,
    state: TripState,
  ): Promise<Message> {
    const at = this.after(userCreatedAt);
    const row = await this.prisma.$transaction(async (tx) => {
      // Lock the row while checking ownership so a new claim cannot precede these components.
      const owned = await tx.conversation.updateMany({
        where: { id: conversationId, tripRevision: state.revision + 1 },
        data: { updatedAt: at },
      });
      const metadata = owned.count === 1
        ? { components: render(state, copy(state.locale)), revision: state.revision + 1 }
        : undefined;
      return tx.message.create({
        data: { conversationId, role: 'ASSISTANT', content, status, createdAt: at, metadata: metadata as Prisma.InputJsonValue | undefined },
      });
    });
    this.remember(conversationId, content);
    return toMessageContract(row);
  }
}
