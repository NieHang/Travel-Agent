import { UIFlowService } from './ui-flow.service.js';
import type { AIUIResponse, UIResponse, UIFlowContext } from './ui-types.js';
import type { UIResponseService } from './ui-response.service.js';

const draft: AIUIResponse = {
  message: '路线草案',
  intent: 'trip_planning',
  components: [
    {
      id: 'draft',
      type: 'card',
      title: '东京路线草案',
      category: 'itinerary',
      description: '第一天浅草，第二天上野。仅为建议。',
      details: [],
      sourceStatus: 'unverified',
    },
  ],
};
const hotels: AIUIResponse = {
  message: '尚无经过核实的酒店结果',
  intent: 'hotel_search',
  components: [
    {
      id: 'hotels',
      type: 'table',
      title: '酒店',
      columns: [{ key: 'name', label: '名称' }],
      rows: [],
    },
  ],
};
const typeReply: AIUIResponse = {
  message: '请选择旅游类型',
  intent: 'trip_planning',
  components: [
    {
      id: 'type',
      type: 'selection',
      title: '旅游类型',
      mode: 'single',
      options: [{ value: 'solo', label: '个人游', description: null }],
    },
  ],
};
function component<T extends UIResponse['type']>(r: AIUIResponse, type: T) {
  const value = r.components.find((c) => c.type === type);
  if (!value) throw Error(`Missing ${type}`);
  return value as Extract<UIResponse, { type: T }>;
}
describe('intent-aware UI actions', () => {
  let flow: UIFlowService;
  let fail: boolean;
  let contexts: UIFlowContext[];
  let histories: number[];
  let querySelection: boolean;
  beforeEach(() => {
    fail = false;
    querySelection = false;
    contexts = [];
    histories = [];
    const generate = async (
      input: string,
      history: unknown[] = [],
      context?: UIFlowContext,
    ) => {
      if (fail) throw Error('upstream secret');
      contexts.push(structuredClone(context!));
      histories.push(history.length);
      if (context?.operation === 'preview_itinerary')
        return structuredClone(draft);
      if (/酒店/.test(input)) {
        if (querySelection)
          return {
            message: '选择设施',
            intent: 'hotel_search',
            components: [
              {
                id: 'filter',
                type: 'selection',
                title: '酒店设施',
                mode: 'multiple',
                options: [
                  { value: 'wifi', label: '无线网络', description: null },
                  { value: 'parking', label: '停车场', description: null },
                ],
              },
            ],
          } as AIUIResponse;
        if (/查看/.test(input))
          return {
            message: '详情待核实',
            intent: 'hotel_search',
            components: [
              {
                id: 'hotel',
                type: 'card',
                category: 'hotel',
                title: '酒店查询条件',
                description: '尚无可信结果',
                details: [],
                sourceStatus: 'unverified',
              },
            ],
          } as AIUIResponse;
        return structuredClone(hotels);
      }
      if (/旅游|个人游/.test(input)) return structuredClone(typeReply);
      return {
        message: '你好',
        intent: 'general',
        components: [
          { id: 'text', type: 'text', content: '你好', format: 'plain' },
        ],
      } as AIUIResponse;
    };
    flow = new UIFlowService({
      generateUIResponse: generate,
    } as UIResponseService);
  });
  afterEach(() => vi.useRealTimers());
  async function form(session = 's') {
    const start = await flow.chat(session, '我要去日本旅游');
    const selection = component(start, 'selection');
    return component(
      await flow.handleAction(session, {
        type: 'selection',
        componentId: selection.id,
        values: ['solo'],
      }),
      'form',
    );
  }
  function fields() {
    return [
      { name: 'destination', value: '东京' },
      { name: 'departureDate', value: '2026-11-01' },
      { name: 'returnDate', value: '2026-11-03' },
      { name: 'travelers', value: 1 },
      { name: 'budget', value: 5000 },
    ];
  }
  async function preview() {
    const f = await form();
    return flow.handleAction('s', {
      type: 'form_submit',
      componentId: f.id,
      values: fields().filter((v) => f.fields.some((f) => f.name === v.name)),
    });
  }
  it('selects, submits, confirms and rejects replay', async () => {
    const p = await preview();
    expect(component(p, 'card').description).toContain('浅草');
    const buttons = component(p, 'action_buttons');
    const next = await flow.handleAction('s', {
      type: 'button_click',
      componentId: buttons.id,
      buttonId: buttons.buttons.find((b) => b.action === 'confirm_itinerary')!
        .id,
    });
    const c = component(next, 'confirmation');
    expect(c.summary).toBe(
      draft.components[0].type === 'card'
        ? draft.components[0].description
        : '',
    );
    expect(
      component(next, 'steps').items.some((s) => s.status === 'current'),
    ).toBe(true);
    const action = {
      type: 'confirmation' as const,
      componentId: c.id,
      confirmed: true,
    };
    const done = await flow.handleAction('s', action);
    expect(
      component(done, 'steps').items.every((s) => s.status === 'completed'),
    ).toBe(true);
    await expect(flow.handleAction('s', action)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('free-text confirmation returns confirmation + steps and cancel restores the draft', async () => {
    await preview();
    const c = component(await flow.chat('s', '确认旅游路线'), 'confirmation');
    const back = await flow.handleAction('s', {
      type: 'confirmation',
      componentId: c.id,
      confirmed: false,
    });
    expect(component(back, 'card').description).toContain('浅草');
  });
  it('does not confirm a route that does not exist', async () => {
    const result = await flow.chat('s', '确认旅游路线');
    expect(result.components.some((c) => c.type === 'confirmation')).toBe(
      false,
    );
  });
  it('skips known type and requirements', async () => {
    const result = await flow.chat(
      's',
      '我要去东京个人游，2人，预算5000，2026-11-01到2026-11-03',
    );
    expect(result.components.some((c) => c.type === 'selection')).toBe(false);
    expect(result.components.some((c) => c.type === 'form')).toBe(false);
    expect(component(result, 'card').category).toBe('itinerary');
  });
  it('preserves arbitrary user search constraints and resumes planning', async () => {
    await preview();
    const result = await flow.chat(
      's',
      '帮我找杭州西湖附近500米的酒店，预算800',
    );
    expect(result.intent).toBe('hotel_search');
    expect(result.components.some((c) => c.type === 'selection')).toBe(false);
    expect(contexts.at(-1)?.query?.input).toBe(
      '帮我找杭州西湖附近500米的酒店，预算800',
    );
    expect(contexts.at(-1)?.requirements.budget).toBe(5000);
    const b = component(result, 'action_buttons');
    const restored = await flow.handleAction('s', {
      type: 'button_click',
      componentId: b.id,
      buttonId: b.buttons.find((b) => b.action === 'resume_planning')!.id,
    });
    expect(component(restored, 'card').description).toContain('浅草');
  });
  it('rejects single-select multiple values, unknown options and other sessions', async () => {
    const s = component(await flow.chat('s', '我要去日本旅游'), 'selection');
    for (const values of [['solo', 'business'], ['unknown'], ['solo', 'solo']])
      await expect(
        flow.handleAction('s', {
          type: 'selection',
          componentId: s.id,
          values,
        }),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      flow.handleAction('other', {
        type: 'selection',
        componentId: s.id,
        values: ['solo'],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it.each(
    [
      [],
      [{ name: 'unknown', value: 1 }],
      [{ name: 'travelers', value: -1 }],
      [{ name: 'budget', value: -1 }],
      [{ name: 'departureDate', value: '2026-02-30' }],
      [{ name: 'travelers', value: '2' }],
      [
        { name: 'departureDate', value: '2026-12-01' },
        { name: 'returnDate', value: '2026-11-01' },
      ],
      [
        { name: 'budget', value: 100 },
        { name: 'budget', value: 200 },
      ],
    ].map((bad) => ({ bad })),
  )(
    'rejects invalid form without consuming the component ($bad)',
    async ({ bad }) => {
      const f = await form();
      const base = fields().filter(
        (v) =>
          f.fields.some((field) => field.name === v.name) &&
          !bad.some((b) => b.name === v.name),
      );
      const values = bad.length === 0 ? [] : [...base, ...bad];
      await expect(
        flow.handleAction('s', {
          type: 'form_submit',
          componentId: f.id,
          values,
        }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it('rolls back failed generation and allows the same action to be retried', async () => {
    const f = await form();
    const action = {
      type: 'form_submit' as const,
      componentId: f.id,
      values: fields().filter((v) => f.fields.some((f) => f.name === v.name)),
    };
    fail = true;
    await expect(flow.handleAction('s', action)).rejects.toMatchObject({
      status: 502,
    });
    fail = false;
    expect(
      component(await flow.handleAction('s', action), 'card').category,
    ).toBe('itinerary');
  });
  it('serializes concurrent duplicate actions', async () => {
    const f = await form();
    const action = {
      type: 'form_submit' as const,
      componentId: f.id,
      values: fields().filter((v) => f.fields.some((f) => f.name === v.name)),
    };
    const results = await Promise.allSettled([
      flow.handleAction('s', action),
      flow.handleAction('s', action),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  });
  it('expires idle sessions and trims model history', async () => {
    vi.useFakeTimers();
    const f = await form();
    vi.advanceTimersByTime(30 * 60 * 1000);
    await expect(
      flow.handleAction('s', {
        type: 'form_submit',
        componentId: f.id,
        values: [],
      }),
    ).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 15; i++) await flow.chat('new', '你好');
    expect(histories.at(-1)).toBe(20);
  });
  it('caps active sessions and reclaims expired capacity', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 1000; i++) await flow.chat(`s${i}`, '你好');
    await expect(flow.chat('extra', '你好')).rejects.toMatchObject({
      status: 429,
    });
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect((await flow.chat('extra', '你好')).intent).toBe('general');
  });
  it('handles hotel details combined with proximity constraints', async () => {
    const result = await flow.chat('s', '查看西湖附近500米的酒店');
    expect(result.intent).toBe('hotel_search');
    expect(component(result, 'card').category).toBe('hotel');
  });
  it('handles query multiple selection without entering the planning state machine', async () => {
    querySelection = true;
    const s = component(
      await flow.chat('s', '帮我找西湖附近的酒店'),
      'selection',
    );
    querySelection = false;
    const result = await flow.handleAction('s', {
      type: 'selection',
      componentId: s.id,
      values: ['wifi', 'parking'],
    });
    expect(result.intent).toBe('hotel_search');
    expect(contexts.at(-1)?.query?.input).toContain('wifi');
    expect(contexts.at(-1)?.query?.input).toContain('parking');
    expect(contexts.at(-1)?.stage).toBe('idle');
  });
  it('does not ask for an individually supplied departure date again', async () => {
    const result = await flow.chat(
      's',
      '我要去东京个人游，出发日期2026-11-01，2人，预算5000',
    );
    const f = component(result, 'form');
    expect(f.fields.some((field) => field.name === 'departureDate')).toBe(
      false,
    );
    expect(f.fields.some((field) => field.name === 'returnDate')).toBe(true);
  });
  it('recognizes solo travel supplied without the literal UI label', async () => {
    const result = await flow.chat('s', '我要去日本独自旅游');
    expect(result.components.some((c) => c.type === 'selection')).toBe(false);
  });
  it('restores every editable field after querying during an itinerary edit', async () => {
    const f = await form();
    const p = await flow.handleAction('s', {
      type: 'form_submit',
      componentId: f.id,
      values: [
        ...fields().filter((v) =>
          f.fields.some((field) => field.name === v.name),
        ),
        { name: 'preferences', value: '美食' },
      ],
    });
    const b = component(p, 'action_buttons');
    await flow.handleAction('s', {
      type: 'button_click',
      componentId: b.id,
      buttonId: 'edit',
    });
    const query = await flow.chat('s', '找西湖附近的酒店');
    const resume = component(query, 'action_buttons');
    const result = await flow.handleAction('s', {
      type: 'button_click',
      componentId: resume.id,
      buttonId: 'resume',
    });
    expect(component(result, 'form').fields.map((field) => field.name)).toEqual(
      [
        'destination',
        'departureDate',
        'returnDate',
        'travelers',
        'budget',
        'preferences',
      ],
    );
  });
});
