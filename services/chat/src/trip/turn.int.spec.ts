import type { INestApplication } from '@nestjs/common';
import type { SendTurnRequest, TripStreamEvent } from '@autix/contracts';
import { createTestApp, createUser } from '../../test/helpers/app.js';
import { resetDb } from '../../test/helpers/db.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ROLLINGGO_COMPACT } from '../llm/mcp/rollinggo.fixture.js';
import type { Classified } from './commands.js';
import { TRIP_LLM, type TripLlm } from './llm.js';
import type { TripDay, TripState } from './state.js';
import type { LoopEvent } from './tool-loop.js';
import { TurnService } from './turn.js';

const NULLS = { destination: null, tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null };
const planned = (patch: Partial<Classified['patch']>): Classified => ({ intent: 'plan', locale: 'zh', patch: { ...NULLS, ...patch }, clarify: null });
const chatted: Classified = { intent: 'chat', locale: 'zh', patch: NULLS, clarify: null };
const hotelResult = { callId: 'c1', tool: 'searchHotels', args: {}, content: ROLLINGGO_COMPACT, isError: false };
const hotelItem = {
  source: 'c1', id: '43615', title: { original: 'Casa do Fado Alfama', translation: '阿尔法玛法朵之家' },
  address: null, price: { amount: 118, currency: 'EUR' }, rating: 4, url: null, image: null,
  details: [], amenities: [{ original: 'Kitchen', translation: '厨房' }], summary: null,
};
const searchAndShow = (panel: 'hotels'): LoopEvent[] => [
  { type: 'tool_call', name: 'searchHotels' },
  { type: 'tool_results', results: [hotelResult] },
  { type: 'show_results', input: { panel, items: [hotelItem] }, results: [hotelResult] },
];

/** A scripted TripLlm: queues of classifications and respond() event lists, consumed in order. */
class ScriptedLlm implements TripLlm {
  classifications: Classified[] = [];
  responses: LoopEvent[][] = [];
  days: TripDay[] = [{ title: '第 1 天', stops: [], stayRef: 'h1' }];
  /** When set, respond() yields its first event then waits for abort. */
  hang = false;
  /** What each respond() call received, for follow-up assertions. */
  inputs: { text: string | null; state: TripState }[] = [];
  async classify() {
    const next = this.classifications.shift();
    if (!next) throw new Error('unexpected classify');
    return next;
  }
  async *respond(_task: string, input: { text: string | null; state: TripState }, signal: AbortSignal) {
    this.inputs.push(structuredClone(input));
    const events = this.responses.shift() ?? [];
    for (const e of events) yield e;
    if (this.hang && !signal.aborted)
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    signal.throwIfAborted();
  }
  async extractDays() {
    return this.days;
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
    Object.assign(llm, { classifications: [], responses: [], inputs: [], hang: false, days: [{ title: '第 1 天', stops: [], stayRef: 'h1' }] });
    const { user } = await createUser(app);
    conversationId = (await prisma.conversation.create({ data: { userId: user.id, title: '' } })).id;
  });
  afterAll(async () => app?.close());

  async function send(request: SendTurnRequest, signal = new AbortController().signal) {
    const events: TripStreamEvent[] = [];
    for await (const e of turns.run(conversationId, request, signal)) events.push(e);
    return events;
  }
  const done = (events: TripStreamEvent[]) => {
    const last = events.at(-1)!;
    if (last.type !== 'done') throw new Error(`expected done, got ${JSON.stringify(last)}`);
    return last;
  };

  it('answers a chat message as text without components', async () => {
    llm.classifications.push(chatted);
    llm.responses.push([{ type: 'text', delta: '你' }, { type: 'text', delta: '好' }]);
    const events = await send({ revision: 0, command: { type: 'message', text: '你好' } });
    expect(events.map((e) => e.type)).toEqual(['start', 'status', 'text', 'text', 'done']);
    const end = done(events);
    expect(end.message.content).toBe('你好');
    expect(end.components).toEqual([]);
    expect(end.trip).toBeNull();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).tripRevision).toBe(1);
  });

  it('runs the full planning path with hotels joined to the itinerary', async () => {
    llm.classifications.push(planned({ destination: '杭州' }));
    let end = done(await send({ revision: 0, command: { type: 'message', text: '去杭州' } }));
    expect(end.components[0]).toMatchObject({ type: 'choice', command: 'set_trip_type' });
    expect(end.message.content).toBe('请选择旅游类型。');

    end = done(await send({ revision: 1, command: { type: 'set_trip_type', value: 'family' } }));
    expect(end.components[0]).toMatchObject({ type: 'form' });

    llm.responses.push([...searchAndShow('hotels'), { type: 'text', delta: '## 杭州行程草稿' }]);
    const events = await send({
      revision: 2,
      command: { type: 'submit_requirements', values: { departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4 } },
    });
    expect(events.filter((e) => e.type === 'status').map((e) => e.type === 'status' && e.phase)).toEqual(['searching', 'writing', 'organizing']);
    end = done(events);
    expect(end.trip).toMatchObject({ status: 'draft', destination: '杭州', itineraryMarkdown: '## 杭州行程草稿' });
    expect(end.trip!.hotels.map((h) => h.ref)).toEqual(['h1']);
    expect(end.trip!.days[0].stay?.title.original).toBe('Casa do Fado Alfama');
    expect(end.components.map((c) => c.type)).toEqual(['cards', 'buttons']);

    end = done(await send({ revision: 3, command: { type: 'confirm' } }));
    expect(end.trip!.status).toBe('confirmed');
  });

  it('saves the itinerary without stays when the model does not search', async () => {
    llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-01', travelers: 1 }));
    llm.responses.push([{ type: 'text', delta: '一日游草稿' }]);
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

  it('uses a tool from any server with no code changes', async () => {
    llm.classifications.push(chatted);
    const other = { callId: 'p1', tool: 'otherServer__places', args: {}, content: '{"places":[{"name":"Lingyin Temple"}]}', isError: false };
    llm.responses.push([
      { type: 'tool_call', name: 'otherServer__places' },
      { type: 'tool_results', results: [other] },
      { type: 'show_results', input: { panel: 'hotspots', items: [{ ...hotelItem, source: 'p1', id: null, price: null, rating: null, amenities: [], title: { original: 'Lingyin Temple', translation: '灵隐寺' } }] }, results: [other] },
      { type: 'text', delta: '灵隐寺' },
    ]);
    const end = done(await send({ revision: 0, command: { type: 'message', text: '杭州有什么寺庙' } }));
    expect(end.trip!.hotspots.map((h) => h.title.original)).toEqual(['Lingyin Temple']);
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

  it('saves a partial message and keeps the state when aborted mid-stream', async () => {
    llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 1 }));
    llm.responses.push([{ type: 'text', delta: '第一段' }]);
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
    expect(row.tripRevision).toBe(1);
    const state = await turns.getState(conversationId);
    expect(state).toEqual({ revision: 1, trip: null, components: [] });
  });

  it('reports a model failure as an error event with a saved error message', async () => {
    llm.classifications.push(planned({ destination: '杭州', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 1 }));
    llm.responses.push([]);
    const events = await send({ revision: 0, command: { type: 'message', text: '…' } });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'MODEL_FAILED', message: { status: 'error' } });
  });
});
