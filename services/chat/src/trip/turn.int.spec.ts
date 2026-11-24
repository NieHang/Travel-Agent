import type { INestApplication } from '@nestjs/common';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { TurnTraceSchema, type SendTurnRequest, type TripStreamEvent } from '@autix/contracts';
import { createTestApp, createUser } from '../../test/helpers/app.js';
import { resetDb } from '../../test/helpers/db.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { COMPACT_THRESHOLD } from '../llm/compact.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { ROLLINGGO_COMPACT } from '../llm/mcp/rollinggo.fixture.js';
import type { Classified, Place } from './commands.js';
import { TRIP_LLM, type TripLlm } from './llm.js';
import type { TripState } from './state.js';
import type { LoopEvent } from './tool-loop.js';
import { TurnService } from './turn.js';

// Compaction's summarizer; the trip model itself is the ScriptedLlm below.
const summarizer = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../llm/model.factory.js', () => ({ createChatModel: () => ({ invoke: summarizer.invoke }) }));

const NULLS = { destination: null, tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null };
const planned = (patch: Partial<Classified['patch']>): Classified => ({ intent: 'plan', locale: 'zh', patch: { ...NULLS, ...patch }, clarify: null, revise: null });
const chatted: Classified = { intent: 'chat', locale: 'zh', patch: NULLS, clarify: null, revise: null };
const revising = (days: number[]): Classified => ({ ...chatted, intent: 'revise', revise: { days, hotel: false, hotelDays: [] } });
/** A two-day draft whose first night is at the hotel searchAndShow grounds. */
const DRAFT = '## 杭州行程草稿\n\n**第 1 天 | 西湖（轻松）**\n- 10:00 西湖\n- 今晚：Casa do Fado Alfama\n\n**第 2 天 | 灵隐寺（轻松）**\n- 09:00 灵隐寺';
const hotelResult = { callId: 'c1', tool: 'searchHotels', args: {}, content: ROLLINGGO_COMPACT, isError: false };
// A hotel with a hotelId: the server fills address, price, rating, url and image from hotelResult.
const hotelItem = {
  source: 'c1', id: '43615', title: { original: 'Casa do Fado Alfama', translation: '阿尔法玛法朵之家' },
  details: [], amenities: [{ original: 'Kitchen', translation: '厨房' }], summary: null,
};
const searchAndShow = (panel: 'hotels'): LoopEvent[] => [
  { type: 'tool_call', name: 'searchHotels', args: {} },
  { type: 'tool_results', results: [hotelResult] },
  { type: 'show_results', input: { panel, items: [hotelItem] }, results: [hotelResult] },
];

/** A scripted TripLlm: queues of classifications and respond() event lists, consumed in order. */
class ScriptedLlm implements TripLlm {
  place: Place | null = null;
  classifications: Classified[] = [];
  responses: LoopEvent[][] = [];
  /** When set, respond() yields its first event then waits for abort. */
  hang = false;
  /** What each respond() call received, for follow-up assertions; history as message texts. */
  inputs: { text: string | null; state: TripState; history: string[] }[] = [];
  /** The history each classify() call received, as message texts. */
  classified: string[][] = [];
  async locate(destination: string): Promise<Place> {
    return this.place ?? { japan: destination, outside: [] };
  }
  async classify(input: { history: BaseMessage[] }) {
    this.classified.push(input.history.map((m) => m.text));
    const next = this.classifications.shift();
    if (!next) throw new Error('unexpected classify');
    return next;
  }
  async *respond(_task: string, input: { text: string | null; state: TripState; history: BaseMessage[] }, signal: AbortSignal) {
    this.inputs.push({ text: input.text, state: structuredClone(input.state), history: input.history.map((m) => m.text) });
    const events = this.responses.shift() ?? [];
    for (const e of events) yield e;
    if (this.hang && !signal.aborted)
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    signal.throwIfAborted();
  }
  async extractBrief() {
    return { tip: null, todos: [] };
  }
  async extractStops() {
    return [];
  }
}

describe('TurnService', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let turns: TurnService;
  const llm = new ScriptedLlm();
  let conversationId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ configure: (b) => b.overrideProvider(TRIP_LLM).useValue(llm) }));
    turns = app.get(TurnService);
  });
  beforeEach(async () => {
    await resetDb(prisma);
    Object.assign(llm, { classifications: [], responses: [], inputs: [], classified: [], place: null, hang: false });
    summarizer.invoke.mockReset().mockResolvedValue(new AIMessage('SUMMARY'));
    const { user } = await createUser(app);
    conversationId = (await prisma.conversation.create({ data: { userId: user.id, title: '' } })).id;
  });
  afterAll(async () => app?.close());

  async function send(request: SendTurnRequest, signal = new AbortController().signal) {
    const events: TripStreamEvent[] = [];
    for await (const e of turns.run(conversationId, request, signal)) events.push(e);
    return events;
  }
  function onUserSave(action: () => void) {
    const transaction = prisma.$transaction.bind(prisma);
    return vi.spyOn(prisma, '$transaction').mockImplementationOnce((work) => transaction(async (tx) => {
      const create = tx.message.create.bind(tx.message);
      const save = vi.spyOn(tx.message, 'create').mockImplementationOnce((args) => {
        action();
        return create(args);
      });
      try {
        return await work(tx);
      } finally {
        save.mockRestore();
      }
    }));
  }
  const done = (events: TripStreamEvent[]) => {
    const last = events.at(-1)!;
    if (last.type !== 'done') throw new Error(`expected done, got ${JSON.stringify(last)}`);
    return last;
  };
  /** Saves alternating user/assistant messages with the given contents, a second apart, in the past. */
  async function seed(contents: string[]) {
    const start = Date.now() - 3_600_000;
    for (const [i, content] of contents.entries()) {
      await prisma.message.create({
        data: { conversationId, role: i % 2 ? 'ASSISTANT' : 'USER', content, createdAt: new Date(start + i * 1000) },
      });
    }
  }
  const numbered = (count: number, from = 0) => Array.from({ length: count }, (_, i) => `m${from + i}`);

  it('persists the request command on the user message in SSE and history', async () => {
    llm.classifications.push(planned({ destination: 'Kyoto', tripType: 'family' }));
    await send({ revision: 0, command: { type: 'message', text: 'Kyoto with family' } });
    const command: SendTurnRequest['command'] = { type: 'submit_requirements', values: { destination: 'Kyoto', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4, preferences: 'Food' } };
    llm.responses.push([{ type: 'text', delta: 'Draft' }]);
    const events = await send({ revision: 1, command });
    const start = events[0];
    expect(start).toMatchObject({ type: 'start', userMessage: { role: 'USER', metadata: { command } } });
    if (start.type !== 'start') throw new Error('Expected start event');
    const row = await prisma.message.findUniqueOrThrow({ where: { id: start.userMessage.id } });
    expect(row.metadata).toEqual({ command });
    const { userId } = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const history = await app.get(ConversationsService).listMessages(userId, conversationId, { limit: 50 });
    expect(history.items.find((message) => message.id === row.id)?.metadata).toEqual({ command });
  });

  it('answers a chat message as text without components', async () => {
    llm.classifications.push(chatted);
    llm.responses.push([{ type: 'text', delta: '你' }, { type: 'text', delta: '好' }]);
    const events = await send({ revision: 0, command: { type: 'message', text: '你好' } });
    expect(events.map((e) => e.type)).toEqual(['start', 'status', 'text', 'text', 'done']);
    const end = done(events);
    expect(end.message.content).toBe('你好');
    expect(end.components).toEqual([]);
    expect(end.trip).toBeNull();
    expect(end.message.metadata?.trace).toMatchObject({
      steps: [{ phase: 'understanding' }, { phase: 'writing' }],
      verification: { lookups: [], grounding: null },
    });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripRevision).toBe(1);
  });

  it('persists a localized tool trace in the done event and reloaded history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00.000Z'));
    try {
      const args = { place: '大阪', checkInParam: { checkInDate: '2026-12-01', stayNights: 2, adultCount: 2 } };
      const result = { ...hotelResult, args };
      llm.classifications.push(planned({ destination: '大阪', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 1 }));
      llm.responses.push([
        { type: 'tool_call', name: 'searchHotels', args },
        { type: 'tool_results', results: [result] },
        { type: 'tool_results', results: [result] },
        { type: 'show_results', input: { panel: 'hotels', items: [hotelItem, { ...hotelItem, source: 'missing' }] }, results: [result] },
        { type: 'text', delta: DRAFT },
      ]);
      const end = done(await send({ revision: 0, command: { type: 'message', text: '大阪三天' } }));
      const trace = TurnTraceSchema.parse(end.message.metadata?.trace);
      expect(trace).toEqual({
        steps: [
          { phase: 'understanding', at: '2026-11-15T12:00:00.000Z' },
          { phase: 'searching', at: '2026-11-15T12:00:00.000Z' },
          { phase: 'writing', at: '2026-11-15T12:00:00.000Z' },
          { phase: 'organizing', at: '2026-11-15T12:00:00.000Z' },
        ],
        endedAt: '2026-11-15T12:00:00.000Z',
        verification: {
          reading: [],
          lookups: [{ tool: 'searchHotels', subject: '大阪酒店 · 12/01–12/03', at: '2026-11-15T12:00:00.000Z', ok: true, count: 1 }],
          grounding: { kept: 1, dropped: 1 },
        },
      });
      const row = await prisma.message.findUniqueOrThrow({ where: { id: end.message.id } });
      expect(row.metadata).toEqual(end.message.metadata);
      const { userId } = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      const history = await app.get(ConversationsService).listMessages(userId, conversationId, { limit: 50 });
      expect(history.items.find((message) => message.id === row.id)?.metadata).toEqual(end.message.metadata);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a destination without responding, saves the refusal and offers Japan destinations', async () => {
    llm.classifications.push(planned({ destination: 'Lisbon', tripType: 'family', departureDate: '2027-01-04', returnDate: '2027-01-09', travelers: 3 }));
    llm.place = { japan: null, outside: ['Lisbon'] };
    const end = done(await send({ revision: 0, locale: 'en', command: { type: 'message', text: 'Plan a family trip to Lisbon' } }));
    expect(llm.inputs).toEqual([]);
    expect(end.message.content).toBe("Hilda only plans trips within Japan, so I can't plan Lisbon. Please choose a destination in Japan.");
    expect(end.components[0]).toEqual({ type: 'choice', command: 'set_destination', title: 'Choose a destination in Japan', options: [
      { value: 'Tokyo', label: 'Tokyo', description: null },
      { value: 'Kyoto', label: 'Kyoto', description: null },
      { value: 'Osaka', label: 'Osaka', description: null },
      { value: 'Nara', label: 'Nara', description: null },
    ] });
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(row.tripState).toMatchObject({ stage: 'requirements', checkedDestination: null, outsideJapan: { places: ['Lisbon'], japan: null }, requirements: { tripType: 'family', departureDate: '2027-01-04', returnDate: '2027-01-09', travelers: 3 } });
    expect(row.tripState).not.toHaveProperty('requirements.destination');
    expect(row.tripRevision).toBe(1);
  });

  it('runs the full planning path with hotels joined to the itinerary', async () => {
    llm.classifications.push(planned({ destination: '杭州' }));
    let end = done(await send({ revision: 0, command: { type: 'message', text: '去杭州' } }));
    expect(end.components[0]).toMatchObject({ type: 'choice', command: 'set_trip_type' });
    expect(end.message.content).toBe('请选择旅游类型。');

    end = done(await send({ revision: 1, command: { type: 'set_trip_type', value: 'family' } }));
    expect(end.components[0]).toMatchObject({ type: 'form' });
    expect(end.message.metadata).not.toHaveProperty('trace');

    llm.responses.push([...searchAndShow('hotels'), { type: 'text', delta: DRAFT }]);
    const events = await send({
      revision: 2,
      command: { type: 'submit_requirements', values: { departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4 } },
    });
    expect(events.filter((e) => e.type === 'status').map((e) => e.type === 'status' && e.phase)).toEqual(['searching', 'writing', 'organizing']);
    // The draft streams to the panel; the chat gets a short reply.
    expect(events.filter((e) => e.type === 'text')).toEqual([]);
    expect(events.filter((e) => e.type === 'draft').map((e) => e.type === 'draft' && e.delta).join('')).toBe(DRAFT);
    end = done(events);
    expect(end.message.content).toBe('完整行程在行程面板中。');
    expect(end.trip).toMatchObject({ status: 'draft', destination: '杭州', overview: '## 杭州行程草稿' });
    expect(end.trip!.itineraryMarkdown).toContain('**第 1 天 | 西湖（轻松）**\n- 10:00 西湖\n- 今晚：Casa do Fado Alfama');
    expect(end.trip!.hotels.map((h) => h.ref)).toEqual(['h1']);
    expect(end.trip!.days.map((d) => d.stay?.title.original ?? null)).toEqual(['Casa do Fado Alfama', null]);
    expect(end.trip!.stayPlan).toMatchObject([{ nights: { from: 0, to: 0 }, stay: { ref: 'h1' } }]);
    // The panel is the only hotel list under a draft.
    expect(end.components.map((c) => c.type)).toEqual(['buttons']);

    end = done(await send({ revision: 3, command: { type: 'confirm' } }));
    expect(end.trip!.status).toBe('confirmed');
    expect(end.message.metadata).not.toHaveProperty('trace');
  });

  it('leaves the narration before a search out of the saved itinerary', async () => {
    llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-01', travelers: 1 }));
    llm.responses.push([{ type: 'text', delta: '我先查一下。' }, { type: 'discard_text' }, { type: 'text', delta: '## 一日游草稿' }]);
    const events = await send({ revision: 0, command: { type: 'message', text: '杭州一日游' } });
    expect(events.filter((e) => e.type === 'status').map((e) => e.type === 'status' && e.phase)).toEqual(['writing', 'searching', 'writing', 'organizing']);
    const end = done(events);
    expect(end.message.content).toBe('完整行程在行程面板中。');
    expect(end.trip!.itineraryMarkdown).toBe('## 一日游草稿');
  });

  it('saves the itinerary without stays when the model does not search', async () => {
    llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-01', travelers: 1 }));
    llm.responses.push([{ type: 'text', delta: '**第 1 天 | 西湖（轻松）**\n- 10:00 西湖' }]);
    const end = done(await send({ revision: 0, command: { type: 'message', text: '杭州一日游' } }));
    expect(end.trip).toMatchObject({ status: 'draft', hotels: [] });
    expect(end.trip!.days[0].stay).toBeNull();
  });

  it('keeps stays when a later chat question shows other hotels', async () => {
    llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 1 }));
    llm.responses.push([...searchAndShow('hotels'), { type: 'text', delta: '草稿' }]);
    await send({ revision: 0, command: { type: 'message', text: '…' } });
    llm.classifications.push(chatted);
    llm.responses.push([...searchAndShow('hotels'), { type: 'text', delta: '更便宜的' }]);
    const end = done(await send({ revision: 1, command: { type: 'message', text: '有更便宜的吗' } }));
    expect(end.components.map((c) => c.type)).toEqual(['cards', 'buttons']);
    expect(end.trip!.hotels.map((h) => h.ref)).toEqual(['h1']);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect((row.tripState as { results: unknown[] }).results).toHaveLength(1);
  });

  it('gives the next turn the earlier tool results for refinements and follow-ups', async () => {
    llm.classifications.push(chatted, chatted);
    llm.responses.push([...searchAndShow('hotels'), { type: 'text', delta: '找到了' }], [{ type: 'text', delta: '第二家…' }]);
    await send({ revision: 0, command: { type: 'message', text: '里斯本阿尔法玛附近的酒店' } });
    await send({ revision: 1, command: { type: 'message', text: '第二家详细说说' } });
    expect(llm.inputs[1].state.toolResults).toEqual([hotelResult]);
  });

  it('traces only the lookups a turn made, not the stored results it was given', async () => {
    const kyoto = { callId: 't2', tool: 'searchHotels', args: { query: 'Kyoto' }, content: '{"hotels":[]}', isError: false };
    llm.classifications.push(chatted, chatted);
    llm.responses.push(
      [...searchAndShow('hotels'), { type: 'text', delta: '找到了' }],
      [{ type: 'tool_call', name: 'searchHotels', args: kyoto.args }, { type: 'tool_results', results: [hotelResult, kyoto] }, { type: 'text', delta: '京都的' }],
    );
    await send({ revision: 0, command: { type: 'message', text: '里斯本阿尔法玛附近的酒店' } });
    const end = done(await send({ revision: 1, command: { type: 'message', text: '京都呢' } }));
    expect(end.message.metadata?.trace?.verification?.lookups).toEqual([
      { tool: 'searchHotels', subject: 'Kyoto', at: expect.any(String), ok: true, count: 0 },
    ]);
  });

  it('uses a tool from any server with no code changes', async () => {
    llm.classifications.push(chatted);
    const other = { callId: 'p1', tool: 'otherServer__places', args: {}, content: '{"places":[{"name":"Lingyin Temple"}]}', isError: false };
    const failed = { callId: 'p2', tool: 'otherServer__places', args: { query: 'Kyoto temples' }, content: 'Tool failed', isError: true };
    llm.responses.push([
      { type: 'tool_call', name: 'otherServer__places', args: {} },
      { type: 'tool_results', results: [other] },
      { type: 'tool_call', name: 'otherServer__places', args: failed.args },
      { type: 'tool_results', results: [other, failed] },
      { type: 'show_results', input: { panel: 'hotspots', items: [{ ...hotelItem, source: 'p1', id: null, price: null, rating: null, amenities: [], title: { original: 'Lingyin Temple', translation: '灵隐寺' } }] }, results: [other] },
      { type: 'text', delta: '灵隐寺' },
    ]);
    const end = done(await send({ revision: 0, command: { type: 'message', text: '杭州有什么寺庙' } }));
    expect(end.trip!.hotspots.map((h) => h.title.original)).toEqual(['Lingyin Temple']);
    expect(end.message.metadata?.trace?.verification?.lookups).toEqual([
      { tool: 'otherServer__places', subject: null, at: expect.any(String), ok: true, count: null },
      { tool: 'otherServer__places', subject: 'Kyoto temples', at: expect.any(String), ok: false, count: null },
    ]);
  });

  describe('scoped edits', () => {
    const tripState = async () => (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripState as TripState;
    async function draft() {
      llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-02', travelers: 1 }));
      llm.responses.push([...searchAndShow('hotels'), { type: 'text', delta: DRAFT }]);
      done(await send({ revision: 0, command: { type: 'message', text: '杭州两天' } }));
      done(await send({ revision: 1, command: { type: 'confirm' } }));
      return tripState();
    }

    it('rewrites one day, keeps the rest and the hotel, and replies with a summary', async () => {
      const before = await draft();
      llm.classifications.push(revising([2]));
      llm.responses.push([
        { type: 'edit', call: { name: 'write_day', args: { day: 2, markdown: '**第 2 天 | 茶园（轻松）**\n- 10:00 龙井茶园' } }, results: [] },
        { type: 'text', delta: '第 2 天改成了茶园。' },
      ]);
      const events = await send({ revision: 2, command: { type: 'message', text: '第二天轻松点' } });
      const end = done(events);
      expect(end.message.content).toBe('第 2 天改成了茶园。');
      expect(llm.inputs.at(-1)!.state.preamble).toBe(before.preamble);
      const after = await tripState();
      expect(after.days[0]).toEqual(before.days[0]);
      expect(after.days[1]).toMatchObject({ title: '第 2 天 | 茶园（轻松）', body: '- 10:00 龙井茶园' });
      expect(after).toMatchObject({ stage: 'review', stays: before.stays, preamble: before.preamble });
      expect(end.trip!.status).toBe('draft');
    });

    it('keeps the draft and releases the claim when a revise fails', async () => {
      const before = await draft();
      llm.classifications.push(revising([2]));
      llm.responses.push([{ type: 'edit', call: { name: 'write_day', args: { day: 2, markdown: '**第 2 天 | 茶园（轻松）**' } }, results: [] }, { type: 'text', delta: '改' }]);
      vi.spyOn(llm, 'extractStops').mockRejectedValueOnce(new Error('model down'));
      const events = await send({ revision: 2, command: { type: 'message', text: '第二天轻松点' } });
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'MODEL_FAILED' });
      expect(await tripState()).toEqual(before);
      // The next turn can claim the following revision.
      llm.classifications.push(chatted);
      llm.responses.push([{ type: 'text', delta: '好' }]);
      done(await send({ revision: 3, command: { type: 'message', text: '你好' } }));
    });

    it('chooses a hotel for a run of nights without calling the model', async () => {
      await draft();
      const before = await tripState();
      const other = { ...before.stays!.items[0], ref: 'h2', id: '99', title: { original: 'Other Inn', translation: null } };
      await prisma.conversation.update({ where: { id: conversationId }, data: { tripState: { ...before, stays: { panel: 'hotels', items: [...before.stays!.items, other] } } as unknown as Prisma.InputJsonValue } });
      const calls = llm.inputs.length;
      const events = await send({ revision: 2, command: { type: 'choose_stay', ref: 'h2', nights: { from: 0, to: 0 } } });
      const end = done(events);
      expect(llm.inputs.length).toBe(calls);
      expect(events[0]).toMatchObject({ type: 'start', userMessage: { content: '第 1 晚住Other Inn' } });
      expect(end.message.content).toBe('已将第 1 晚改为Other Inn。');
      expect(end.trip!.days[0].stay?.ref).toBe('h2');
      expect(end.trip!.itineraryMarkdown).toContain('- 今晚：Other Inn');
      await expect(send({ revision: 3, command: { type: 'choose_stay', ref: 'h1', nights: { from: 0, to: 1 } } })).rejects.toMatchObject({ status: 409 });
    });
  });

  it('rejects a stale revision and a command not allowed in the stage before streaming', async () => {
    await expect(send({ revision: 5, command: { type: 'edit' } })).rejects.toMatchObject({ status: 409 });
    await expect(send({ revision: 0, command: { type: 'confirm' } })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.message.count()).toBe(0);
  });

  it('lets only one of two concurrent turns run', async () => {
    llm.classifications.push(chatted, chatted);
    llm.responses.push([{ type: 'text', delta: 'a' }], [{ type: 'text', delta: 'b' }]);
    const outcomes = await Promise.allSettled([
      send({ revision: 0, command: { type: 'message', text: '1' } }),
      send({ revision: 0, command: { type: 'message', text: '2' } }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((o) => o.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  });

  it('rolls back the claim without an orphan assistant when saving the user fails', async () => {
    const failure = new Error('save user failed');
    const save = onUserSave(() => { throw failure; });
    try {
      await expect(send({ revision: 0, command: { type: 'message', text: 'hello' } })).rejects.toBe(failure);
      expect(await turns.getState(conversationId)).toEqual({ revision: 0, trip: null, components: [] });
      const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(row.tripRevision).toBe(0);
      expect(await prisma.message.count({ where: { conversationId } })).toBe(0);
    } finally {
      save.mockRestore();
    }
  });

  it('settles the claim when the controller stops consuming at the first event', async () => {
    llm.classifications.push(planned({ destination: 'Tokyo' }));
    const previous = done(await send({ revision: 0, command: { type: 'message', text: 'Tokyo' } }));
    const controller = new AbortController();
    const save = onUserSave(() => controller.abort());
    try {
      const events: TripStreamEvent[] = [];
      for await (const event of turns.run(conversationId, { revision: 1, command: { type: 'message', text: 'hello' } }, controller.signal)) {
        if (controller.signal.aborted) break;
        events.push(event);
      }
      expect(events).toEqual([]);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripRevision).toBe(2);
      expect((await turns.getState(conversationId)).components).toEqual(previous.components);
      expect(previous.message.metadata).toMatchObject({ revision: 1 });
      expect(await prisma.message.findFirstOrThrow({ where: { conversationId, role: 'ASSISTANT', status: 'partial' } })).toMatchObject({ content: '', metadata: { components: previous.components, revision: 2 } });
      llm.classifications.push(chatted);
      await send({ revision: 2, command: { type: 'message', text: 'next' } });
      expect(llm.classified[1]).toEqual(['Tokyo', previous.message.content, 'hello']);
    } finally {
      save.mockRestore();
    }
  });

  it('does not retry a failed cleanup write', async () => {
    const stream = turns.run(conversationId, { revision: 0, command: { type: 'message', text: 'hello' } }, new AbortController().signal);
    expect((await stream.next()).value).toMatchObject({ type: 'start' });
    const failure = new Error('cleanup failed');
    const save = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(failure);
    try {
      await expect(stream.return(undefined)).rejects.toBe(failure);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripRevision).toBe(1);
      expect(await prisma.message.count({ where: { conversationId, role: 'ASSISTANT' } })).toBe(0);
    } finally {
      save.mockRestore();
    }
  });

  it('keeps the newer components active when an older turn stops after another tab commits', async () => {
    llm.classifications.push(chatted);
    llm.responses.push([...searchAndShow('hotels'), { type: 'text', delta: 'old reply' }]);
    const stream = turns.run(conversationId, { revision: 0, command: { type: 'message', text: 'hello' } }, new AbortController().signal);
    try {
      expect((await stream.next()).value).toMatchObject({ type: 'start' });
      expect((await stream.next()).value).toMatchObject({ type: 'status', phase: 'searching' });
      expect((await turns.getState(conversationId)).revision).toBe(1);
      llm.classifications.push(planned({ destination: 'Tokyo' }));
      const next = done(await send({ revision: 1, command: { type: 'message', text: 'second tab' } }));
      expect(next.message.metadata).toMatchObject({ revision: 2 });
    } finally {
      await stream.return(undefined);
    }
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripRevision).toBe(2);
    const assistant = await prisma.message.findFirstOrThrow({ where: { conversationId, status: 'partial' } });
    const trace = TurnTraceSchema.parse((assistant.metadata as { trace: unknown }).trace);
    expect(trace.steps.map((step) => step.phase)).toEqual(['understanding', 'searching']);
    expect(assistant.metadata).toEqual({ trace });
  });

  it('refuses a turn that loaded the state another turn then saved at the same revision', async () => {
    llm.classifications.push(planned({ destination: 'Tokyo' }));
    const first = turns.run(conversationId, { revision: 0, command: { type: 'message', text: 'Tokyo' } }, new AbortController().signal);
    expect((await first.next()).value).toMatchObject({ type: 'start' });
    // The second tab read revision 1 while the first turn held it; the first turn saves after the
    // second loads and before the second claims.
    const transaction = prisma.$transaction.bind(prisma);
    const saved: TripStreamEvent[] = [];
    const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (work) => {
      for await (const e of first) saved.push(e);
      return transaction(work);
    });
    try {
      await expect(send({ revision: 1, command: { type: 'message', text: 'second tab' } })).rejects.toMatchObject({ status: 409 });
    } finally {
      spy.mockRestore();
    }
    const committed = done(saved);
    expect(await turns.getState(conversationId)).toMatchObject({ revision: 1, components: committed.components });
    expect(await prisma.message.count({ where: { conversationId, role: 'USER' } })).toBe(1);
  });

  it('accepts the reported column revision after a turn dies holding its claim', async () => {
    llm.classifications.push(planned({ destination: 'Tokyo' }), chatted);
    const previous = done(await send({ revision: 0, command: { type: 'message', text: 'Tokyo' } }));
    await prisma.conversation.update({ where: { id: conversationId }, data: { tripRevision: { increment: 1 } } });
    const restored = await turns.getState(conversationId);
    expect(restored).toMatchObject({ revision: 2, components: previous.components });
    const next = done(await send({ revision: restored.revision, command: { type: 'message', text: 'budget?' } }));
    expect(next.message.metadata).toMatchObject({ revision: 3, components: previous.components });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripRevision).toBe(3);
  });

  it('restores the last good components at the newest revision after a commit conflict and model failure', async () => {
    llm.classifications.push(planned({ destination: 'Tokyo' }));
    const previous = done(await send({ revision: 0, command: { type: 'message', text: 'Tokyo' } }));
    const first = turns.run(conversationId, { revision: 1, command: { type: 'message', text: 'first' } }, new AbortController().signal);
    const second = turns.run(conversationId, { revision: 2, command: { type: 'message', text: 'second' } }, new AbortController().signal);
    try {
      expect((await first.next()).value).toMatchObject({ type: 'start' });
      expect((await second.next()).value).toMatchObject({ type: 'start' });
      llm.classifications.push(chatted);
      expect((await first.next()).value).toMatchObject({ type: 'error', message: { status: 'error', metadata: { trace: { steps: [{ phase: 'understanding' }] } } } });
      expect((await second.next()).value).toMatchObject({ type: 'error', message: { status: 'error', metadata: { revision: 3, components: previous.components } } });
    } finally {
      await first.return(undefined);
      await second.return(undefined);
    }
    expect((await turns.getState(conversationId)).revision).toBe(3);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripRevision).toBe(3);
  });

  it('saves a partial message and keeps the state when aborted mid-stream', async () => {
    llm.classifications.push(chatted);
    llm.responses.push([...searchAndShow('hotels'), { type: 'text', delta: '第一段' }]);
    llm.hang = true;
    const controller = new AbortController();
    const seen: TripStreamEvent['type'][] = [];
    for await (const e of turns.run(conversationId, { revision: 0, command: { type: 'message', text: '…' } }, controller.signal)) {
      seen.push(e.type);
      if (e.type === 'text') controller.abort();
    }
    expect(seen.at(-1)).toBe('text');
    const assistant = await prisma.message.findFirstOrThrow({ where: { conversationId, role: 'ASSISTANT' } });
    expect(assistant).toMatchObject({ status: 'partial', content: '第一段' });
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(row.tripState).toBeNull();
    const trace = TurnTraceSchema.parse((assistant.metadata as { trace: unknown }).trace);
    expect(trace.steps.map((step) => step.phase)).toEqual(['understanding', 'searching', 'writing']);
    expect(trace.verification).toEqual({
      reading: [],
      lookups: [{ tool: 'searchHotels', subject: null, at: expect.any(String), ok: true, count: 1 }],
      grounding: { kept: 1, dropped: 0 },
    });
    expect(assistant.metadata).toEqual({ revision: 1, components: [], trace });
    expect(row.tripRevision).toBe(1);
    const state = await turns.getState(conversationId);
    expect(state).toEqual({ revision: 1, trip: null, components: [] });
  });

  it('reports a model failure as an error event with a saved error message', async () => {
    llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 1 }));
    llm.responses.push(searchAndShow('hotels'));
    const events = await send({ revision: 0, command: { type: 'message', text: '…' } });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'MODEL_FAILED', message: { status: 'error' } });
    const error = events.at(-1)!;
    if (error.type !== 'error' || !error.message) throw new Error('Expected saved error message');
    const trace = TurnTraceSchema.parse(error.message.metadata?.trace);
    expect(trace.steps.map((step) => step.phase)).toEqual(['understanding', 'searching']);
    expect(trace.verification).toEqual({
      reading: [],
      lookups: [{ tool: 'searchHotels', subject: null, at: expect.any(String), ok: true, count: 1 }],
      grounding: { kept: 1, dropped: 0 },
    });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: error.message.id } })).metadata).toEqual(error.message.metadata);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripRevision).toBe(1);
  });

  it('gives the model every earlier message, not only the last 20', async () => {
    await seed(numbered(25));
    llm.classifications.push(chatted);
    llm.responses.push([{ type: 'text', delta: 'ok' }]);
    await send({ revision: 0, command: { type: 'message', text: 'next' } });
    expect(llm.classified[0]).toEqual(numbered(25));
    expect(llm.inputs[0].history).toEqual(numbered(25));
  });

  it('compacts before classifying and keeps the summary for later turns', async () => {
    // Saved: one huge message, then m1..m11; with the new message that is 13 messages over the threshold.
    await seed(['字'.repeat(COMPACT_THRESHOLD), ...numbered(11, 1)]);
    llm.classifications.push(chatted, chatted);
    llm.responses.push([{ type: 'text', delta: 'ok' }], [{ type: 'text', delta: 'ok' }]);

    await send({ revision: 0, command: { type: 'message', text: 'first' } });
    const [summary, ...recent] = llm.classified[0];
    expect(summary).toContain('SUMMARY');
    expect(recent).toEqual(numbered(9, 3));
    expect(llm.inputs[0].history).toEqual(llm.classified[0]);

    await send({ revision: 1, command: { type: 'message', text: 'second' } });
    expect(llm.classified[1]).toEqual([summary, ...numbered(9, 3), 'first', 'ok']);
    expect(summarizer.invoke).toHaveBeenCalledTimes(1);
    // The chat keeps every message.
    expect(await prisma.message.count({ where: { conversationId } })).toBe(16);
  });

  it('keeps a stopped draft out of the chat', async () => {
    llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 1 }));
    llm.responses.push([{ type: 'text', delta: '## 草稿' }]);
    llm.hang = true;
    const controller = new AbortController();
    for await (const e of turns.run(conversationId, { revision: 0, command: { type: 'message', text: '…' } }, controller.signal))
      if (e.type === 'draft') controller.abort();
    const assistant = await prisma.message.findFirstOrThrow({ where: { conversationId, role: 'ASSISTANT' } });
    expect(assistant).toMatchObject({ status: 'partial', content: '' });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripState).toBeNull();
  });

  it('keeps the context in step with what a stopped turn saved', async () => {
    llm.classifications.push(chatted);
    llm.responses.push([{ type: 'text', delta: '第一段' }]);
    llm.hang = true;
    const controller = new AbortController();
    for await (const e of turns.run(conversationId, { revision: 0, command: { type: 'message', text: '去杭州' } }, controller.signal))
      if (e.type === 'text') controller.abort();

    llm.hang = false;
    llm.classifications.push(chatted);
    llm.responses.push([{ type: 'text', delta: 'ok' }]);
    await send({ revision: 1, command: { type: 'message', text: 'next' } });
    expect(llm.classified[1]).toEqual(['去杭州', '第一段']);
  });
});
