import { ConflictException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { Component, Message, SendTurnRequest, TripStreamEvent, TripUIState } from '@autix/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toMessageContract } from '../conversations/conversations.service.js';
import { deriveTitle } from '../chat/derive-title.js';
import { errorName } from '../common/error-name.js';
import { ContextManager } from '../llm/context-manager.js';
import { CommandError, assertAllowed, reduce, uncheckedDestination } from './commands.js';
import { copy } from './copy.js';
import { TRIP_LLM, type TripLlm } from './llm.js';
import { groundResults, linkStays, mergeStays } from './results.js';
import { readState, toTripView, type TripState } from './state.js';
import { MAX_STORED_RESULTS } from './tool-loop.js';
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
    const claim = await this.prisma.conversation.updateMany({
      where: { id: conversationId, tripRevision: request.revision },
      data: { tripRevision: { increment: 1 } },
    });
    if (claim.count !== 1) throw new ConflictException('Trip state has changed');

    const user = await this.saveUserMessage(conversationId, describe(request.command, copy(state.locale)));
    yield { type: 'start', userMessage: toMessageContract(user) };
    const context = await this.context(conversationId, user.id);
    const current = new HumanMessage(user.content);
    context.addMessage(current);

    let text = '';
    let saved = false;
    try {
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

      if (effect) {
        const input = { text: command.type === 'message' ? command.text : null, state: next, history };
        for await (const event of this.llm.respond(effect, input, signal)) {
          signal.throwIfAborted();
          switch (event.type) {
            case 'tool_call':
              yield { type: 'status', phase: 'searching' };
              break;
            case 'text':
              if (!text) yield { type: 'status', phase: 'writing' };
              text += event.delta;
              yield { type: 'text', delta: event.delta };
              break;
            case 'tool_results':
              next.toolResults = event.results.slice(-MAX_STORED_RESULTS);
              break;
            case 'show_results': {
              const group = groundResults(event.input, event.results);
              if (effect === 'itinerary' && group.panel === 'hotels') next.stays = mergeStays(next.stays, group);
              else if (group.items.length) next.results.push(group);
              break;
            }
          }
        }
      }
      if (effect === 'itinerary') {
        if (!text.trim()) throw new Error('Empty itinerary');
        next.itinerary = text;
        yield { type: 'status', phase: 'organizing' };
        next.days = linkStays(await this.llm.extractDays(text, next.stays, next.locale, signal), next.stays);
      }
      signal.throwIfAborted();
      const c = copy(next.locale);
      const reply = text || stageMessage(next, c);
      const components = render(next, c);
      const message = await this.saveTurn(conversationId, next, reply, components, user.createdAt);
      saved = true;
      yield { type: 'done', message, components, trip: toTripView(next) };
    } catch (error) {
      if (signal.aborted) return;
      this.logger.error(`Trip turn failed (${errorName(error)}) conversation=${conversationId}`);
      const message = await this.saveAssistant(conversationId, text, 'error', user.createdAt, request.revision);
      saved = true;
      yield { type: 'error', code: 'MODEL_FAILED', message };
    } finally {
      // Reached on abort, including when the consumer stops iterating: keep what was streamed.
      if (!saved) await this.saveAssistant(conversationId, text, 'partial', user.createdAt, request.revision);
    }
  }

  private async load(conversationId: string): Promise<TripState> {
    const row = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { tripState: true, tripRevision: true },
    });
    return readState(row.tripState, row.tripRevision);
  }

  private async saveUserMessage(conversationId: string, content: string) {
    const [row] = await this.prisma.$transaction([
      this.prisma.message.create({ data: { conversationId, role: 'USER', content } }),
      this.prisma.conversation.updateMany({ where: { id: conversationId, title: '' }, data: { title: deriveTitle(content) } }),
    ]);
    return row;
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
    revision: number,
  ): Promise<Message> {
    const at = this.after(userCreatedAt);
    const [row] = await this.prisma.$transaction([
      this.prisma.message.create({ data: { conversationId, role: 'ASSISTANT', content, status, createdAt: at } }),
      this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: at } }),
      // Release the claim: the state did not advance, so the previous turn's components stay active.
      this.prisma.conversation.updateMany({
        where: { id: conversationId, tripRevision: revision + 1 },
        data: { tripRevision: revision },
      }),
    ]);
    this.remember(conversationId, content);
    return toMessageContract(row);
  }
}
