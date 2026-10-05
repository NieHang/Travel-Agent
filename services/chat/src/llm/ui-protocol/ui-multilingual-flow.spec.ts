import { UIFlowService } from './ui-flow.service.js';
import type { UIResponseService } from './ui-response.service.js';
import type {
  AIUIResponse,
  PlanningRequirements,
  UIFlowContext,
  UIModelOutput,
  UIResponse,
  UISemantics,
} from './ui-types.js';
import { modelOutput } from './ui-test.fixtures.js';

const trip: AIUIResponse = {
  message: '',
  intent: 'trip_planning',
  components: [
    { id: 'text', type: 'text', content: 'Planning', format: 'plain' },
  ],
};
const general: AIUIResponse = { ...trip, intent: 'general' };
const hotels: AIUIResponse = {
  message: 'No provider',
  intent: 'hotel_search',
  components: [
    {
      id: 'hotel',
      type: 'table',
      title: 'Hotels',
      columns: [{ key: 'name', label: 'Name' }],
      rows: [],
    },
  ],
};
const draft: AIUIResponse = {
  message: 'Draft',
  intent: 'trip_planning',
  components: [
    {
      id: 'draft',
      type: 'card',
      category: 'itinerary',
      title: 'Draft',
      description: 'Tokyo draft',
      details: [],
      sourceStatus: 'unverified',
    },
  ],
};
const complete: Partial<PlanningRequirements> = {
  destination: 'Tokyo',
  tripType: 'solo',
  departureDate: '2026-11-01',
  returnDate: '2026-11-03',
  travelers: 2,
  budget: 5000,
};
function component<T extends UIResponse['type']>(
  response: AIUIResponse,
  type: T,
): Extract<UIResponse, { type: T }> {
  const value = response.components.find((c) => c.type === type);
  if (!value) throw new Error(`Missing ${type}`);
  return value as Extract<UIResponse, { type: T }>;
}
function harness() {
  const state = {
    next: modelOutput(trip, complete, 'update_requirements', 'en'),
    fail: false,
    previewCalls: 0,
    contexts: [] as UIFlowContext[],
  };
  const generateUIResponse = vi.fn(
    async (
      _input: string,
      _history: unknown,
      context?: UIFlowContext,
    ): Promise<UIModelOutput> => {
      state.contexts.push(structuredClone(context!));
      if (state.fail) throw Error('upstream failure');
      if (context?.operation === 'preview_itinerary') {
        state.previewCalls++;
        return modelOutput(draft, {}, 'answer', context.replyLanguage);
      }
      return structuredClone(state.next);
    },
  );
  const flow = new UIFlowService({
    generateUIResponse,
  } as unknown as UIResponseService);
  const operation = (op: UISemantics['operation']) => {
    state.next = modelOutput(trip, {}, op, 'en');
  };
  return { flow, state, generateUIResponse, operation };
}

describe('language-independent planning transitions', () => {
  it('allows server-generated place-detail refinement forms', async () => {
    const { flow, state } = harness();
    state.next = modelOutput(
      {
        ...hotels,
        intent: 'place_details',
        components: [
          {
            id: 'place',
            type: 'card',
            category: 'place',
            title: 'Place',
            description: 'Unverified',
            sourceStatus: 'unverified',
            details: [],
          },
          {
            id: 'actions',
            type: 'action_buttons',
            buttons: [
              { id: 'refine', label: 'Refine', action: 'refine_search' },
            ],
          },
        ],
      },
      {},
      'answer',
      'en',
    );
    const buttons = component(
      await flow.chat('s', 'Show place details'),
      'action_buttons',
    );
    const result = await flow.handleAction('s', {
      type: 'button_click',
      componentId: buttons.id,
      buttonId: 'refine',
    });
    expect(result.intent).toBe('place_details');
    expect(component(result, 'form').fields[0].name).toBe('filters');
  });
  it('clears optional preferences explicitly emptied in an editing form', async () => {
    const { flow, state } = harness();
    state.next = modelOutput(
      trip,
      { ...complete, preferences: 'Museums' },
      'update_requirements',
      'en',
    );
    const buttons = component(
      await flow.chat('s', 'Plan with museums'),
      'action_buttons',
    );
    const form = component(
      await flow.handleAction('s', {
        type: 'button_click',
        componentId: buttons.id,
        buttonId: 'edit',
      }),
      'form',
    );
    const values = Object.entries(complete)
      .filter(([name]) => form.fields.some((f) => f.name === name))
      .map(([name, value]) => ({ name, value: value! }));
    await flow.handleAction('s', {
      type: 'form_submit',
      componentId: form.id,
      values: [...values, { name: 'preferences', value: '' }],
    });
    expect(state.contexts.at(-1)?.requirements.preferences).toBeNull();
  });
  it.each([
    '我要去东京独自旅游，2人，预算5000',
    'Plan a solo trip to Tokyo for 2 people, budget 5000',
    'Plan 东京 solo trip',
    'Je veux voyager seul à Tokyo',
  ])('uses semantic requirements for %s', async (input) => {
    const { flow, state, generateUIResponse } = harness();
    const result = await flow.chat('s', input);
    expect(component(result, 'card').description).toBe('Tokyo draft');
    expect(state.contexts.at(-1)?.requirements).toEqual(complete);
    expect(state.contexts.at(-1)?.requirements.budgetCurrency).toBeUndefined();
    expect(
      result.components.some(
        (c) => c.type === 'form' || c.type === 'selection',
      ),
    ).toBe(false);
    expect(generateUIResponse).toHaveBeenCalledTimes(2); // initial envelope and existing draft generation
  });
  it('retains a lone return date and asks only for missing essential fields', async () => {
    const { flow, state } = harness();
    state.next = modelOutput(
      trip,
      { tripType: 'solo', returnDate: '2026-11-03', budget: 5000 },
      'update_requirements',
      'en',
    );
    const result = await flow.chat('s', 'Return on 2026-11-03, budget 5000');
    const fields = component(result, 'form').fields.map((f) => f.name);
    expect(fields).toContain('departureDate');
    expect(fields).toContain('returnDate');
    expect(component(result, 'form').initialValues).toContainEqual({ name: 'returnDate', value: '2026-11-03' });
    expect(fields).not.toContain('budgetCurrency');
    expect(fields).not.toContain('budget');
    expect(state.previewCalls).toBe(0);
  });
  it('preserves the draft on English confirmation and requires an actual UI confirmation', async () => {
    const { flow, operation, state } = harness();
    await flow.chat('s', 'Plan this trip');
    operation('request_confirmation');
    const pending = await flow.chat('s', 'Confirm this itinerary');
    const confirmation = component(pending, 'confirmation');
    expect(confirmation.summary).toBe('Tokyo draft');
    expect(state.previewCalls).toBe(1);
    expect(
      component(pending, 'steps').items.some((i) => i.status === 'current'),
    ).toBe(true);
    const done = await flow.handleAction('s', {
      type: 'confirmation',
      componentId: confirmation.id,
      confirmed: true,
    });
    expect(
      component(done, 'steps').items.every((i) => i.status === 'completed'),
    ).toBe(true);
  });
  it('keeps an existing draft when the requirement patch does not change values', async () => {
    const { flow, state } = harness();
    await flow.chat('s', 'Plan this trip');
    state.next = modelOutput(
      trip,
      { budget: 5000 },
      'update_requirements',
      'en',
    );
    const result = await flow.chat('s', 'Budget is still 5000');
    expect(component(result, 'card').description).toBe('Tokyo draft');
    expect(state.previewCalls).toBe(1);
  });
  it('invalidates pending confirmation after actual requirement changes', async () => {
    const { flow, state, operation } = harness();
    await flow.chat('s', 'Plan this trip');
    operation('request_confirmation');
    const c = component(await flow.chat('s', 'Confirm it'), 'confirmation');
    state.next = modelOutput(
      trip,
      { budget: 6000 },
      'update_requirements',
      'en',
    );
    expect(
      component(await flow.chat('s', 'Change budget to 6000'), 'card')
        .description,
    ).toBe('Tokyo draft');
    expect(state.previewCalls).toBe(2);
    await expect(
      flow.handleAction('s', {
        type: 'confirmation',
        componentId: c.id,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([
    'request_confirmation',
    'cancel_confirmation',
    'resume_planning',
  ] as const)('returns a normal explanation for unavailable %s', async (op) => {
    const { flow, operation } = harness();
    operation(op);
    expect(
      component(await flow.chat('s', 'An unavailable operation'), 'text')
        .content,
    ).toBeTruthy();
  });
  it('cancels a pending confirmation and leaves a negated request unchanged', async () => {
    const { flow, operation, state } = harness();
    await flow.chat('s', 'Plan this trip');
    operation('request_confirmation');
    await flow.chat('s', 'Confirm it');
    operation('cancel_confirmation');
    expect(
      component(await flow.chat('s', 'Cancel confirmation'), 'card')
        .description,
    ).toBe('Tokyo draft');
    state.next = modelOutput(general, {}, 'answer', 'en');
    await flow.chat('s', 'Do not confirm this itinerary');
    operation('resume_planning');
    expect(component(await flow.chat('s', 'Resume'), 'card').description).toBe(
      'Tokyo draft',
    );
    expect(state.previewCalls).toBe(1);
  });
  it('rolls back an invalid cross-turn date and preserves the current confirmation', async () => {
    const { flow, state, operation } = harness();
    await flow.chat('s', 'Plan');
    operation('request_confirmation');
    const c = component(await flow.chat('s', 'Confirm'), 'confirmation');
    state.next = modelOutput(
      trip,
      { returnDate: '2026-10-01' },
      'update_requirements',
      'en',
    );
    await expect(flow.chat('s', 'Return on October 1')).rejects.toMatchObject({
      status: 502,
    });
    const done = await flow.handleAction('s', {
      type: 'confirmation',
      componentId: c.id,
      confirmed: true,
    });
    expect(component(done, 'card').description).toBe('Tokyo draft');
  });
  it('queries without changing planning and resumes the same draft', async () => {
    const { flow, state } = harness();
    await flow.chat('s', 'Plan');
    state.next = modelOutput(hotels, {}, 'answer', 'en');
    const query = await flow.chat(
      's',
      'Find hotels within 500 meters of West Lake, budget 800',
    );
    const buttons = component(query, 'action_buttons');
    const result = await flow.handleAction('s', {
      type: 'button_click',
      componentId: buttons.id,
      buttonId: 'resume',
    });
    expect(component(result, 'card').description).toBe('Tokyo draft');
    expect(state.contexts.at(-1)?.requirements.budget).toBe(5000);
  });
  it('rejects an intent change while refining a query and permits retry', async () => {
    const { flow, state } = harness();
    state.next = modelOutput(
      {
        ...hotels,
        components: [
          ...hotels.components,
          {
            id: 'actions',
            type: 'action_buttons',
            buttons: [
              { id: 'refine', label: 'Refine', action: 'refine_search' },
            ],
          },
        ],
      },
      {},
      'answer',
      'en',
    );
    const buttons = component(await flow.chat('s', 'Hotels'), 'action_buttons');
    const form = component(
      await flow.handleAction('s', {
        type: 'button_click',
        componentId: buttons.id,
        buttonId: 'refine',
      }),
      'form',
    );
    const submit = {
      type: 'form_submit' as const,
      componentId: form.id,
      values: [{ name: 'filters', value: 'wifi' }],
    };
    state.next = modelOutput(general, {}, 'answer', 'en');
    await expect(flow.handleAction('s', submit)).rejects.toMatchObject({
      status: 502,
    });
    state.next = modelOutput(hotels, {}, 'answer', 'en');
    expect((await flow.handleAction('s', submit)).intent).toBe('hotel_search');
    expect(state.contexts.at(-1)?.query?.input).toContain('wifi');
  });
  it('preserves language after failed locale change and across UI actions', async () => {
    const { flow, state, operation } = harness();
    await flow.chat('s', 'Plan', 'en');
    state.fail = true;
    await expect(flow.chat('s', '你好', 'zh')).rejects.toMatchObject({
      status: 502,
    });
    state.fail = false;
    operation('request_confirmation');
    const c = component(await flow.chat('s', 'ok'), 'confirmation');
    expect(c.confirmLabel).toBe('Confirm itinerary');
    expect(state.contexts.at(-1)?.preferredLocale).toBe('en');
    const result = await flow.handleAction('s', {
      type: 'confirmation',
      componentId: c.id,
      confirmed: false,
    });
    expect(component(result, 'card').title).toBe('Itinerary draft');
  });
});
