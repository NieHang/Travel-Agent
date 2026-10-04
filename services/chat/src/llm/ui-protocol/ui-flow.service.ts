import { randomUUID } from 'node:crypto';
import type { SendMessageRequest, TripSnapshot } from '@autix/contracts';
import {
  buildTripSnapshot,
  type PreparedUITurn,
  type UIFlowSnapshot,
  type TurnStreaming,
} from './ui-session.js';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { AppException } from '../../common/app.exception.js';
import { actionRequestSchema, chatRequestSchema } from './ui-schemas.js';
import {
  UIResponseService,
  validateUIModelOutput,
  validateUIResponse,
} from './ui-response.service.js';
import { getPlanningFields, planningResponse } from './ui-flow.components.js';
import { validateForm } from './ui-form.validation.js';
import { validateUIAction } from './ui-action.validation.js';
import { mergePlanningRequirements } from './ui-requirements.validation.js';
import {
  getUICopy,
  normalizeLocale,
  resolveReplyLanguage,
} from './ui-localization.js';
import type {
  AIUIResponse,
  UIAction,
  UIFlowContext,
  UIModelOutput,
  PlanningRequirements,
} from './ui-types.js';

interface Session {
  streaming?: TurnStreaming;
  planDays?: TripSnapshot['days'];
  context: UIFlowContext;
  history: BaseMessage[];
  response: AIUIResponse;
  touched: number;
}
const TTL = 30 * 60 * 1000;

@Injectable()
export class UIFlowService {
  private readonly sessions = new Map<string, Session>();
  private readonly queues = new Map<string, Promise<void>>();
  constructor(
    @Inject(UIResponseService) private readonly responses: UIResponseService,
  ) {}

  async prepareTurn(
    snapshot: UIFlowSnapshot | null,
    request: SendMessageRequest,
    history: BaseMessage[],
    signal: AbortSignal,
    onChunk?: (content: string) => void,
  ): Promise<PreparedUITurn> {
    signal.throwIfAborted();
    if (
      'action' in request &&
      (!snapshot || request.revision !== snapshot.revision)
    )
      throw new ConflictException('UI revision is no longer active');
    // An isolated candidate reuses the existing deterministic flow without committing shared memory.
    const candidate = new UIFlowService(this.responses);
    const session = candidate.copy();
    if (snapshot) {
      session.context = structuredClone(snapshot.context);
      session.response = structuredClone(snapshot.response);
      session.planDays = snapshot.trip?.days;
    }
    session.history = [...history];
    if (onChunk) session.streaming = { signal, onChunk };
    candidate.sessions.set('candidate', session);
    const response =
      'content' in request
        ? await candidate.chat('candidate', request.content, request.locale)
        : await candidate.handleAction(
            'candidate',
            request.action,
            request.locale,
          );
    signal.throwIfAborted();
    const final = candidate.sessions.get('candidate')!;
    const revision = (snapshot?.revision ?? 0) + 1;
    return {
      response,
      markdownInput: null,
      snapshot: {
        version: 1,
        revision,
        context: final.context,
        response,
        trip: buildTripSnapshot(
          final.context,
          response,
          revision,
          snapshot?.trip ?? null,
          final.planDays,
        ),
      },
    };
  }

  async chat(
    sessionId: string,
    input: string,
    locale?: string,
  ): Promise<AIUIResponse> {
    const parsed = chatRequestSchema.safeParse({ sessionId, input, locale });
    if (!parsed.success) throw new BadRequestException('Invalid chat request');
    return this.serial(sessionId, async () => {
      this.expire();
      const previous = this.sessions.get(sessionId);
      if (!previous && this.sessions.size + this.pendingNew.size >= 1000)
        throw new AppException('RATE_LIMITED', 429);
      if (!previous) this.pendingNew.add(sessionId);
      try {
        const candidate = this.copy(previous);
        const text = parsed.data.input;
        this.applyLocale(candidate.context, parsed.data.locale);
        const output = await this.generate(candidate, text);
        const { semantics } = output;
        candidate.context.replyLanguage = resolveReplyLanguage(
          candidate.context.preferredLocale,
          semantics.replyLanguage,
          candidate.context.replyLanguage,
        );
        let result: AIUIResponse;
        switch (semantics.operation) {
          case 'answer':
            result = output.response;
            if (
              semantics.intent !== 'general' &&
              semantics.intent !== 'trip_planning'
            ) {
              candidate.context.query = {
                intent: semantics.intent,
                input: text,
              };
              this.addResume(candidate, result);
            }
            break;
          case 'update_requirements': {
            const merged = mergePlanningRequirements(
              candidate.context.requirements,
              semantics.requirements,
            );
            candidate.context.requirements = merged.requirements;
            candidate.context.query = null;
            if (merged.changed || !candidate.context.itinerary) {
              candidate.context.itinerary = null;
              result = await this.advancePlanning(candidate);
            } else result = planningResponse(candidate.context);
            break;
          }
          case 'request_confirmation':
            if (
              candidate.context.itinerary &&
              ['reviewing_itinerary', 'awaiting_confirmation'].includes(
                candidate.context.stage,
              )
            ) {
              candidate.context.query = null;
              candidate.context.stage = 'awaiting_confirmation';
              result = planningResponse(candidate.context);
            } else
              result = this.explain(
                candidate.context,
                getUICopy(candidate.context.replyLanguage).noDraft,
              );
            break;
          case 'cancel_confirmation':
            if (candidate.context.stage === 'awaiting_confirmation') {
              candidate.context.query = null;
              candidate.context.stage = 'reviewing_itinerary';
              result = planningResponse(candidate.context);
            } else
              result = this.explain(
                candidate.context,
                getUICopy(candidate.context.replyLanguage).noConfirmation,
              );
            break;
          case 'resume_planning':
            if (candidate.context.stage !== 'idle') {
              candidate.context.query = null;
              result = planningResponse(candidate.context);
            } else
              result = this.explain(
                candidate.context,
                getUICopy(candidate.context.replyLanguage).noPlanning,
              );
            break;
        }
        return this.commit(sessionId, candidate, text, result);
      } finally {
        this.pendingNew.delete(sessionId);
      }
    });
  }

  async handleAction(
    sessionId: string,
    action: UIAction,
    locale?: string,
  ): Promise<AIUIResponse> {
    if (!actionRequestSchema.safeParse({ sessionId, action, locale }).success)
      throw new BadRequestException('Invalid UI action');
    return this.serial(sessionId, async () => {
      this.expire();
      const previous = this.sessions.get(sessionId);
      if (!previous) throw new NotFoundException('UI session not found');
      const candidate = this.copy(previous);
      this.applyLocale(candidate.context, locale);
      validateUIAction(candidate, action);
      const copy = getUICopy(candidate.context.replyLanguage);
      const component = candidate.response.components.find(
        (c) => c.id === action.componentId,
      );
      if (!component)
        throw new ConflictException('UI component is no longer active');
      let result: AIUIResponse;
      switch (action.type) {
        case 'selection': {
          if (component.type !== 'selection')
            throw new BadRequestException('Action type mismatch');
          if (
            new Set(action.values).size !== action.values.length ||
            (component.mode === 'single' && action.values.length !== 1) ||
            action.values.some(
              (v) => !component.options.some((o) => o.value === v),
            )
          )
            throw new BadRequestException('Invalid selection');
          if (component.purpose !== 'trip_type') {
            result = await this.query(
              candidate,
              JSON.stringify({
                operation: 'selection',
                purpose: component.purpose,
                selected: action.values.map((value) =>
                  component.options.find((o) => o.value === value),
                ),
              }),
            );
            break;
          }
          if (
            candidate.response.intent !== 'trip_planning' ||
            candidate.context.stage !== 'choosing_trip_type'
          )
            throw new ConflictException(
              'Selection not allowed in current stage',
            );
          candidate.context.requirements = mergePlanningRequirements(
            candidate.context.requirements,
            { tripType: action.values[0] as PlanningRequirements['tripType'] },
          ).requirements;
          result = await this.advancePlanning(candidate);
          break;
        }
        case 'form_submit': {
          if (component.type !== 'form')
            throw new BadRequestException('Action type mismatch');
          if (candidate.response.intent === 'trip_planning') {
            if (candidate.context.stage !== 'collecting_requirements')
              throw new ConflictException('Form not allowed in current stage');
            const submitted = validateForm(
              component,
              action,
              candidate.context.requirements,
            );
            candidate.context.requirements = mergePlanningRequirements(
              candidate.context.requirements,
              submitted as Partial<PlanningRequirements>,
            ).requirements;
            // Form null means explicitly cleared; model-patch null means omitted.
            for (const field of component.fields) {
              if (!field.required && submitted[field.name] === null)
                candidate.context.requirements[field.name] = null;
            }
            result = await this.advancePlanning(candidate);
          } else {
            const submitted = validateForm(component, action, {});
            result = await this.query(
              candidate,
              JSON.stringify({ operation: 'form_submit', values: submitted }),
            );
          }
          break;
        }
        case 'confirmation': {
          if (component.type !== 'confirmation')
            throw new BadRequestException('Action type mismatch');
          if (
            candidate.context.stage !== 'awaiting_confirmation' ||
            component.summary !== candidate.context.itinerary
          )
            throw new ConflictException(
              'No matching route awaiting confirmation',
            );
          candidate.context.stage = action.confirmed
            ? 'confirmed'
            : 'reviewing_itinerary';
          result = planningResponse(candidate.context);
          break;
        }
        case 'button_click': {
          if (component.type !== 'action_buttons')
            throw new BadRequestException('Action type mismatch');
          const button = component.buttons.find(
            (b) => b.id === action.buttonId,
          );
          if (!button) throw new BadRequestException('Unknown button');
          switch (button.action) {
            case 'confirm_itinerary':
              if (
                candidate.response.intent !== 'trip_planning' ||
                candidate.context.stage !== 'reviewing_itinerary' ||
                !candidate.context.itinerary
              )
                throw new ConflictException('No route to confirm');
              candidate.context.stage = 'awaiting_confirmation';
              result = planningResponse(candidate.context);
              break;
            case 'edit_itinerary':
              if (
                candidate.response.intent !== 'trip_planning' ||
                !candidate.context.itinerary
              )
                throw new ConflictException('No route to edit');
              candidate.context.stage = 'collecting_requirements';
              candidate.context.itinerary = null;
              candidate.context.editingRequirements = true;
              result = planningResponse(candidate.context);
              break;
            case 'resume_planning':
              if (candidate.context.stage === 'idle')
                throw new ConflictException('No planning draft');
              candidate.context.query = null;
              result = planningResponse(candidate.context);
              break;
            case 'refine_search':
              if (!candidate.context.query)
                throw new ConflictException('No active query');
              result = {
                intent: candidate.context.query.intent,
                message: copy.refine,
                components: [
                  {
                    id: 'query-form',
                    type: 'form',
                    title: copy.queryTitle,
                    fields: [
                      {
                        type: 'textarea',
                        name: 'filters',
                        label: copy.filters,
                        required: true,
                        placeholder: copy.filtersPlaceholder,
                      },
                    ],
                    submitLabel: copy.updateQuery,
                  },
                  ...(candidate.context.query.intent === 'place_details'
                    ? candidate.response.components
                        .filter((c) => c.type === 'card')
                        .map((c) => ({ ...c, id: randomUUID() }))
                    : []),
                ],
              };
              this.addResume(candidate, result);
              break;
            case 'view_details':
              result = await this.query(
                candidate,
                JSON.stringify({
                  operation: 'view_details',
                  buttonId: button.id,
                  label: button.label,
                }),
              );
              break;
          }
          break;
        }
      }
      return this.commit(sessionId, candidate, JSON.stringify(action), result);
    });
  }

  private readonly pendingNew = new Set<string>();
  private async serial<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => gate);
    this.queues.set(key, tail);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(key) === tail) this.queues.delete(key);
    }
  }
  private expire() {
    for (const [key, session] of this.sessions)
      if (Date.now() - session.touched >= TTL && !this.pendingNew.has(key))
        this.sessions.delete(key);
  }
  private copy(session?: Session): Session {
    return session
      ? {
          context: structuredClone(session.context),
          response: structuredClone(session.response),
          history: [...session.history],
          streaming: session.streaming,
          planDays: session.planDays,
          touched: session.touched,
        }
      : {
          context: {
            stage: 'idle',
            requirements: {},
            itinerary: null,
            query: null,
          },
          history: [],
          touched: Date.now(),
          response: {
            message: '',
            intent: 'general',
            components: [
              { id: 'empty', type: 'text', content: '', format: 'plain' },
            ],
          },
        };
  }
  private commit(
    key: string,
    candidate: Session,
    input: string,
    result: AIUIResponse,
  ): AIUIResponse {
    let response: AIUIResponse;
    try {
      response = validateUIResponse(result, candidate.context);
    } catch {
      throw new AppException('INTERNAL_ERROR', 502);
    }
    response.components.forEach((c) => {
      c.id = randomUUID();
    });
    candidate.response = response;
    candidate.history.push(
      new HumanMessage(input),
      new AIMessage(JSON.stringify(response)),
    );
    candidate.history = candidate.history.slice(-20);
    candidate.touched = Date.now();
    this.sessions.set(key, candidate);
    return structuredClone(response);
  }
  private async generate(
    session: Session,
    input: string,
    operation?: UIFlowContext['operation'],
  ): Promise<UIModelOutput> {
    const context = {
      ...structuredClone(session.context),
      ...(operation ? { operation } : {}),
    };
    try {
      const output = await this.responses.generateUIResponse(
        input,
        session.history.slice(-20),
        context,
        session.streaming?.signal,
        Boolean(session.streaming),
      );
      const validated = validateUIModelOutput(output, context);
      if (
        session.streaming &&
        validated.semantics.intent === 'general' &&
        validated.semantics.operation === 'answer'
      ) {
        let text = '';
        for await (const chunk of this.responses.streamMarkdown(
          input,
          session.history,
          { ...context, replyLanguage: validated.semantics.replyLanguage },
          session.streaming.signal,
        )) {
          text += chunk;
          session.streaming.onChunk(chunk);
        }
        validated.response = {
          intent: 'general',
          message: text,
          components: [
            { id: 'answer', type: 'text', content: text, format: 'markdown' },
          ],
        };
      }
      return validated;
    } catch {
      throw new AppException('INTERNAL_ERROR', 502);
    }
  }
  private async advancePlanning(session: Session): Promise<AIUIResponse> {
    const context = session.context;
    if (!context.requirements.tripType) {
      context.stage = 'choosing_trip_type';
      return planningResponse(context);
    }
    context.stage = 'collecting_requirements';
    if (
      getPlanningFields(context.replyLanguage).some(
        (f) =>
          f.required &&
          (context.requirements[f.name] === undefined ||
            context.requirements[f.name] === null ||
            context.requirements[f.name] === ''),
      )
    )
      return planningResponse(context);
    if (session.streaming) {
      session.planDays = await this.responses.generateTripDays(
        context,
        session.streaming.signal,
      );
      let text = '';
      for await (const chunk of this.responses.streamMarkdown(
        JSON.stringify({
          operation: 'render_itinerary',
          requirements: context.requirements,
          days: session.planDays,
        }),
        session.history,
        context,
        session.streaming.signal,
      )) {
        text += chunk;
        session.streaming.onChunk(chunk);
      }
      if (!text.trim()) throw new AppException('INTERNAL_ERROR', 502);
      context.itinerary = text;
      context.editingRequirements = false;
      context.stage = 'reviewing_itinerary';
      return planningResponse(context);
    }
    const preview = await this.generate(
      session,
      JSON.stringify({ operation: 'preview_itinerary' }),
      'preview_itinerary',
    );
    const card = preview.response.components.find(
      (c) => c.type === 'card' && c.category === 'itinerary',
    );
    if (!card || card.type !== 'card')
      throw new AppException('INTERNAL_ERROR', 502);
    context.itinerary = card.description;
    context.editingRequirements = false;
    context.stage = 'reviewing_itinerary';
    return planningResponse(context);
  }
  private async query(session: Session, extra: string): Promise<AIUIResponse> {
    if (!session.context.query) throw new ConflictException('No active query');
    session.context.query.input += `\n${extra}`;
    const output = await this.generate(
      session,
      session.context.query.input,
      'query',
    );
    this.addResume(session, output.response);
    return output.response;
  }
  private addResume(session: Session, response: AIUIResponse) {
    if (session.context.stage !== 'idle')
      response.components.push({
        id: randomUUID(),
        type: 'action_buttons',
        buttons: [
          {
            id: 'resume',
            label: getUICopy(session.context.replyLanguage).resume,
            action: 'resume_planning',
          },
        ],
      });
  }
  private applyLocale(context: UIFlowContext, locale?: string) {
    if (locale) {
      context.preferredLocale = normalizeLocale(locale);
      context.replyLanguage = context.preferredLocale;
    }
  }
  private explain(context: UIFlowContext, message: string): AIUIResponse {
    if (context.stage !== 'idle') {
      const response = planningResponse(context);
      response.message = message;
      return response;
    }
    return {
      message,
      intent: 'general',
      components: [
        { id: 'explanation', type: 'text', content: message, format: 'plain' },
      ],
    };
  }
}
