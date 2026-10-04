import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HumanMessage } from '@langchain/core/messages';
import {
  UIResponseService,
  validateUIModelOutput,
} from './ui-response.service.js';
import type { AIUIResponse, UIFlowContext } from './ui-types.js';
import { modelOutput } from './ui-test.fixtures.js';

const text: AIUIResponse = {
  message: 'Hello',
  intent: 'general',
  components: [{ id: 'text', type: 'text', content: 'Hello', format: 'plain' }],
};
const trip: AIUIResponse = { ...text, intent: 'trip_planning' };
const hotels: AIUIResponse = {
  message: 'Unverified',
  intent: 'hotel_search',
  components: [
    {
      id: 'hotels',
      type: 'table',
      title: 'Hotels',
      columns: [{ key: 'name', label: 'Name' }],
      rows: [],
    },
  ],
};
const detail: AIUIResponse = {
  message: 'Unverified',
  intent: 'place_details',
  components: [
    {
      id: 'card',
      type: 'card',
      title: 'Details',
      category: 'place',
      description: 'Unverified',
      sourceStatus: 'unverified',
      details: [],
    },
  ],
};
const context: UIFlowContext = {
  stage: 'reviewing_itinerary',
  requirements: { tripType: 'solo' },
  itinerary: 'Tokyo draft',
  query: null,
};
const confirmation: AIUIResponse = {
  message: '',
  intent: 'trip_planning',
  components: [
    {
      id: 'confirmation',
      type: 'confirmation',
      title: 'Confirm',
      summary: 'Tokyo draft',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
    },
    {
      id: 'steps',
      type: 'steps',
      title: 'Progress',
      items: [{ id: 'review', label: 'Review', status: 'current' }],
    },
  ],
};

describe('UI semantic model output', () => {
  let server: Server;
  let reply: unknown;
  let wire: Record<string, any>;
  let calls: number;
  const service = new UIResponseService();
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      calls++;
      let raw = '';
      for await (const chunk of req) raw += chunk;
      wire = JSON.parse(raw);
      const name = wire.tools[0].function.name;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'ui-test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name, arguments: JSON.stringify(reply) },
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv(
      'OPENAI_BASE_URL',
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    );
    vi.stubEnv('HTTPS_PROXY', '');
    vi.stubEnv('HTTP_PROXY', '');
  });
  beforeEach(() => {
    calls = 0;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  it('uses one strict envelope call and carries history and context', async () => {
    reply = modelOutput(
      trip,
      { destination: 'Tokyo', tripType: 'solo', budget: 5000 },
      'update_requirements',
      'en',
    );
    const result = await service.generateUIResponse(
      'Plan a solo trip to Tokyo',
      [new HumanMessage('budget 5000')],
      { ...context, preferredLocale: 'en', replyLanguage: 'en' },
    );
    expect(result).toEqual(reply);
    expect(calls).toBe(1);
    const schema = wire.tools[0].function.parameters;
    expect(schema.properties.semantics).toBeDefined();
    // OpenAI strict tools reject references to arbitrary property paths.
    expect(schema.properties.response.properties.intent.enum).toEqual([
      'trip_planning',
      'hotel_search',
      'place_details',
      'flight_search',
      'general',
    ]);
    expect(JSON.stringify(schema)).not.toContain('"$ref"');
    expect(
      schema.properties.response.properties.components.items,
    ).toBeDefined();
    expect(wire.tools[0].function.strict).toBe(true);
    expect(JSON.stringify(wire.messages)).toContain('budget 5000');
    expect(JSON.stringify(wire.messages)).toContain('preferredLocale');
  });
  it.each([
    '我要去东京独自旅游',
    'Plan a solo trip to Tokyo',
    'Plan 东京 solo trip',
    'Je veux voyager seul à Tokyo',
  ])(
    'accepts equivalent semantics independently of input language: %s',
    async (input) => {
      reply = modelOutput(
        trip,
        { destination: 'Tokyo', tripType: 'solo' },
        'update_requirements',
        'en',
      );
      expect(
        (await service.generateUIResponse(input)).semantics.requirements
          .tripType,
      ).toBe('solo');
    },
  );
  it('preserves return-date role and optional currency', async () => {
    reply = modelOutput(
      trip,
      { returnDate: '2026-11-03', budget: 5000 },
      'update_requirements',
      'en',
    );
    const output = await service.generateUIResponse(
      'Return on 2026-11-03, budget 5000',
    );
    expect(output.semantics.requirements.departureDate).toBeNull();
    expect(output.semantics.requirements.budgetCurrency).toBeNull();
  });
  it('accepts grounded confirmation with progress', async () => {
    reply = modelOutput(confirmation, {}, 'request_confirmation');
    expect(
      (await service.generateUIResponse('Confirm this itinerary', [], context))
        .response.components[0].type,
    ).toBe('confirmation');
  });
  it.each([
    modelOutput({
      ...text,
      components: [{ id: 'bad', type: 'unknown' }],
    } as never),
    {
      ...modelOutput(text),
      semantics: { ...modelOutput(text).semantics, intent: 'trip_planning' },
    },
    modelOutput(hotels, { budget: 500 }),
    modelOutput(trip, { travelers: 101 }),
    modelOutput(trip, { departureDate: '2026-02-30' }),
    modelOutput(trip, { budgetCurrency: 'dollars' }),
    modelOutput({
      ...hotels,
      components: [
        {
          id: 'trip',
          type: 'selection',
          purpose: 'trip_type',
          title: 'Any wording',
          mode: 'single',
          options: [{ value: 'solo', label: 'Solo travel', description: null }],
        },
      ],
    }),
    modelOutput({
      ...detail,
      components: [{ ...detail.components[0], sourceStatus: 'verified' }],
    } as never),
    modelOutput({ ...detail, components: hotels.components }),
    modelOutput(confirmation, {}, 'request_confirmation'),
  ])(
    'rejects malformed, conflicting or ungrounded envelopes with sanitized 502',
    async (invalid) => {
      reply = invalid;
      await expect(
        service.generateUIResponse('Any language'),
      ).rejects.toMatchObject({ status: 502, message: 'INTERNAL_ERROR' });
    },
  );
  it('rejects confirmation missing progress even with a grounded route', () => {
    expect(() =>
      validateUIModelOutput(
        modelOutput(
          { ...confirmation, components: [confirmation.components[0]] },
          {},
          'request_confirmation',
        ),
        context,
      ),
    ).toThrow();
  });
  it('validates preview and query against trusted server operations', () => {
    expect(() =>
      validateUIModelOutput(modelOutput(trip, {}, 'answer'), {
        ...context,
        operation: 'preview_itinerary',
      }),
    ).toThrow();
    const draft = {
      ...detail,
      intent: 'trip_planning',
      components: [{ ...detail.components[0], category: 'itinerary' }],
    } as AIUIResponse;
    expect(
      validateUIModelOutput(modelOutput(draft, {}, 'answer'), {
        ...context,
        operation: 'preview_itinerary',
      }).response.intent,
    ).toBe('trip_planning');
    expect(() =>
      validateUIModelOutput(modelOutput(detail), {
        ...context,
        operation: 'query',
        query: { intent: 'hotel_search', input: 'hotel constraints' },
      }),
    ).toThrow();
    expect(() =>
      validateUIModelOutput(
        modelOutput(draft, { budget: 500 }, 'update_requirements'),
        { ...context, operation: 'preview_itinerary' },
      ),
    ).toThrow();
  });
  it('validates purpose without depending on titles and labels', () => {
    const filtered = {
      ...hotels,
      components: [
        {
          id: 'filter',
          type: 'selection',
          purpose: 'query_filter',
          title: '旅游类型',
          mode: 'single',
          options: [{ value: 'wifi', label: '个人游', description: null }],
        },
      ],
    } as AIUIResponse;
    expect(validateUIModelOutput(modelOutput(filtered)).response.intent).toBe(
      'hotel_search',
    );
  });
  it('rejects a reply language that contradicts an explicit preference', async () => {
    reply = modelOutput(text, {}, 'answer', 'zh');
    await expect(
      service.generateUIResponse('你好', [], {
        ...context,
        preferredLocale: 'en',
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
