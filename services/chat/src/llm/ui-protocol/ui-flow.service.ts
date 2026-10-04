import { randomUUID } from 'node:crypto';
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
import {
  actionRequestSchema,
  chatRequestSchema,
  validatedAIUIResponseSchema,
} from './ui-schemas.js';
import {
  UIResponseService,
  validateUIResponse,
} from './ui-response.service.js';
import {
  planningFields,
  planningResponse,
  tripOptions,
} from './ui-flow.components.js';
import { validateForm } from './ui-form.validation.js';
import type {
  AIUIResponse,
  UIAction,
  UIFlowContext,
  UIIntent,
} from './ui-types.js';

interface Session {
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

  async chat(sessionId: string, input: string): Promise<AIUIResponse> {
    const parsed = chatRequestSchema.safeParse({ sessionId, input });
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
        const queryIntent = this.queryIntent(text);
        let result: AIUIResponse;
        if (queryIntent) {
          candidate.context.query = { intent: queryIntent, input: text };
          result = await this.generate(candidate, text, 'query');
          this.addResume(candidate, result);
        } else if (
          /确认.*路线|确认.*行程/.test(text) &&
          candidate.context.itinerary &&
          ['reviewing_itinerary', 'awaiting_confirmation'].includes(
            candidate.context.stage,
          )
        ) {
          candidate.context.stage = 'awaiting_confirmation';
          result = planningResponse(candidate.context);
        } else {
          // Only planning inputs can update the planning draft; queries cannot overwrite budget etc.
          const planningInput =
            /旅游|旅行|个人游|亲子游|商务出差|情侣游|路线|行程/.test(text);
          if (planningInput)
            this.collectExplicitRequirements(candidate.context, text);
          result = await this.generate(candidate, text);
          if (result.intent === 'trip_planning') {
            this.collectExplicitRequirements(candidate.context, text);
            candidate.context.query = null;
            // Natural-language edits always invalidate the old draft and pending confirmation.
            candidate.context.itinerary = null;
            result = await this.advancePlanning(candidate);
          } else if (result.intent !== 'general') {
            candidate.context.query = { intent: result.intent, input: text };
            this.addResume(candidate, result);
          }
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
  ): Promise<AIUIResponse> {
    if (!actionRequestSchema.safeParse({ sessionId, action }).success)
      throw new BadRequestException('Invalid UI action');
    return this.serial(sessionId, async () => {
      this.expire();
      const previous = this.sessions.get(sessionId);
      if (!previous) throw new NotFoundException('UI session not found');
      const candidate = this.copy(previous);
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
          if (candidate.response.intent !== 'trip_planning') {
            result = await this.query(
              candidate,
              `选择 ${component.title}：${JSON.stringify(action.values.map((value) => component.options.find((o) => o.value === value)))}`,
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
          candidate.context.requirements.tripType = action.values[0];
          result = await this.advancePlanning(candidate);
          break;
        }
        case 'form_submit': {
          if (component.type !== 'form')
            throw new BadRequestException('Action type mismatch');
          if (candidate.response.intent === 'trip_planning') {
            if (candidate.context.stage !== 'collecting_requirements')
              throw new ConflictException('Form not allowed in current stage');
            Object.assign(
              candidate.context.requirements,
              validateForm(component, action, candidate.context.requirements),
            );
            result = await this.advancePlanning(candidate);
          } else {
            const submitted = validateForm(component, action, {});
            result = await this.query(
              candidate,
              `补充查询条件：${JSON.stringify(submitted)}`,
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
                message: '补充筛选条件，原有查询条件将保留。',
                components: [
                  {
                    id: 'query-form',
                    type: 'form',
                    title: '查询筛选',
                    fields: [
                      {
                        type: 'textarea',
                        name: 'filters',
                        label: '补充条件',
                        required: true,
                        placeholder: '例如预算、设施或入住日期',
                      },
                    ],
                    submitLabel: '更新查询',
                  },
                ],
              };
              this.addResume(candidate, result);
              break;
            case 'view_details':
              result = await this.query(candidate, `查看详情：${button.label}`);
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
      response = validatedAIUIResponseSchema.parse(result);
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
  ): Promise<AIUIResponse> {
    const context = {
      ...structuredClone(session.context),
      ...(operation ? { operation } : {}),
    };
    try {
      const output = await this.responses.generateUIResponse(
        input,
        session.history.slice(-20),
        context,
      );
      return validateUIResponse(output, input, context);
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
      planningFields.some(
        (f) =>
          f.required &&
          (context.requirements[f.name] === undefined ||
            context.requirements[f.name] === null ||
            context.requirements[f.name] === ''),
      )
    )
      return planningResponse(context);
    const preview = await this.generate(
      session,
      '根据已收集的需求生成旅游路线草案',
      'preview_itinerary',
    );
    const card = preview.components.find(
      (c) => c.type === 'card' && c.category === 'itinerary',
    );
    if (!card || card.type !== 'card')
      throw new AppException('INTERNAL_ERROR', 502);
    context.itinerary = card.description;
    context.editingRequirements = false;
    context.stage = 'reviewing_itinerary';
    return planningResponse(context);
  }
  private queryIntent(input: string): UIIntent | null {
    if (/酒店|住宿/.test(input) && /找|搜索|附近|查询|推荐/.test(input))
      return 'hotel_search';
    if (/航班|机票/.test(input) && /找|搜索|查询|推荐/.test(input))
      return 'flight_search';
    if (/查看|详情/.test(input) && /酒店|地点|景点|西湖|航班/.test(input))
      return 'place_details';
    return null;
  }
  private async query(session: Session, extra: string): Promise<AIUIResponse> {
    if (!session.context.query) throw new ConflictException('No active query');
    session.context.query.input += `\n${extra}`;
    const result = await this.generate(
      session,
      session.context.query.input,
      'query',
    );
    this.addResume(session, result);
    return result;
  }
  private addResume(session: Session, response: AIUIResponse) {
    if (session.context.stage !== 'idle')
      response.components.push({
        id: randomUUID(),
        type: 'action_buttons',
        buttons: [
          { id: 'resume', label: '返回路线规划', action: 'resume_planning' },
        ],
      });
  }
  private collectExplicitRequirements(context: UIFlowContext, input: string) {
    const type = tripOptions.find((o) => input.includes(o.label));
    if (type) context.requirements.tripType = type.value;
    else if (/独自|一个人/.test(input)) context.requirements.tripType = 'solo';
    else if (/带孩子|带小孩/.test(input))
      context.requirements.tripType = 'family';
    else if (/出差/.test(input)) context.requirements.tripType = 'business';
    else if (/蜜月/.test(input)) context.requirements.tripType = 'couple';
    const destination =
      /(?:去|目的地[：:为是\s]*)([^，。\s]+?)(?=旅游|旅行|个人游|亲子游|商务出差|情侣游|[，。\s]|$)/.exec(
        input,
      )?.[1];
    if (destination) context.requirements.destination = destination;
    const travelers = /(\d+)\s*人/.exec(input)?.[1];
    if (travelers && Number(travelers) > 0 && Number(travelers) <= 100)
      context.requirements.travelers = Number(travelers);
    const budget = /预算[：:\s]*(\d+(?:\.\d+)?)/.exec(input)?.[1];
    if (budget) context.requirements.budget = Number(budget);
    const dates = input.match(/\d{4}-\d{2}-\d{2}/g);
    const validDate = (d: string) =>
      Number.isFinite(Date.parse(d)) &&
      new Date(d).toISOString().slice(0, 10) === d;
    const departure = /(?:出发|入住)(?:日期)?[：:\s]*(\d{4}-\d{2}-\d{2})/.exec(
      input,
    )?.[1];
    const returning =
      /(?:返程|返回|退房)(?:日期)?[：:\s]*(\d{4}-\d{2}-\d{2})/.exec(input)?.[1];
    if (departure && validDate(departure))
      context.requirements.departureDate = departure;
    if (returning && validDate(returning))
      context.requirements.returnDate = returning;
    if (dates?.length === 1 && !returning && validDate(dates[0]))
      context.requirements.departureDate = dates[0];
    if (dates?.length === 2 && dates.every(validDate) && dates[0] <= dates[1]) {
      context.requirements.departureDate = dates[0];
      context.requirements.returnDate = dates[1];
    }
    if (
      typeof context.requirements.departureDate === 'string' &&
      typeof context.requirements.returnDate === 'string' &&
      context.requirements.departureDate > context.requirements.returnDate
    )
      throw new BadRequestException('Return date precedes departure');
  }
}
