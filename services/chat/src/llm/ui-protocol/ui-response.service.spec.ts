import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HumanMessage } from '@langchain/core/messages';
import { UIResponseService } from './ui-response.service.js';
import type { UIFlowContext } from './ui-types.js';

describe('UI structured model output', () => {
  let server: Server;
  let reply: unknown;
  let wire: Record<string, any>;
  const service = new UIResponseService();
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      wire = JSON.parse(raw);
      const name = wire.tools?.[0]?.function.name;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'ui-test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: name ? 'tool_calls' : 'stop',
              message: {
                role: 'assistant',
                content: name ? null : JSON.stringify(reply),
                ...(name
                  ? {
                      tool_calls: [
                        {
                          id: 'call-1',
                          type: 'function',
                          function: { name, arguments: JSON.stringify(reply) },
                        },
                      ],
                    }
                  : {}),
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
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  it('constrains the real model request and carries history/context', async () => {
    reply = {
      message: '选择类型',
      intent: 'trip_planning',
      components: [
        {
          id: 'type',
          type: 'selection',
          title: '旅游类型',
          mode: 'single',
          options: ['商务出差', '亲子游', '个人游'].map((label) => ({
            value: label,
            label,
            description: null,
          })),
        },
      ],
    };
    const result = await service.generateUIResponse(
      '我要去日本旅游',
      [new HumanMessage('预算5000')],
      {
        stage: 'idle',
        requirements: { budget: 5000 },
        itinerary: null,
        query: null,
      },
    );
    expect(result.components[0].type).toBe('selection');
    const schema =
      wire.tools?.[0]?.function.parameters ??
      wire.response_format?.json_schema?.schema;
    expect(schema.properties.components.items).toBeDefined();
    expect(JSON.stringify(wire.messages)).toContain('预算5000');
    expect(JSON.stringify(wire.messages)).toContain('5000');
  });
  it.each(['查看某某地点', '查看某某酒店'])(
    'returns details for %s',
    async (input) => {
      reply = {
        message: '待核实',
        intent: 'place_details',
        components: [
          {
            id: 'detail',
            type: 'card',
            title: input,
            category: input.includes('酒店') ? 'hotel' : 'place',
            description: '尚无可信数据',
            details: [],
            sourceStatus: 'unverified',
          },
        ],
      };
      expect((await service.generateUIResponse(input)).components[0].type).toBe(
        'card',
      );
    },
  );
  it('queries hotels directly and sends the full user constraints', async () => {
    reply = {
      message: '尚无查询数据',
      intent: 'hotel_search',
      components: [
        {
          id: 'hotels',
          type: 'table',
          title: '待查询酒店',
          columns: [{ key: 'name', label: '名称' }],
          rows: [],
        },
      ],
    };
    expect(
      (await service.generateUIResponse('帮我找杭州西湖附近500米的酒店'))
        .intent,
    ).toBe('hotel_search');
    expect(JSON.stringify(wire.messages)).toContain('杭州西湖附近500米');
  });
  it('confirms an existing route with progress', async () => {
    reply = {
      message: '请确认',
      intent: 'trip_planning',
      components: [
        {
          id: 'confirm',
          type: 'confirmation',
          title: '确认',
          summary: '东京三日',
          confirmLabel: '确认',
          cancelLabel: '取消',
        },
        {
          id: 'steps',
          type: 'steps',
          title: '进度',
          items: [{ id: 'confirm', label: '确认', status: 'current' }],
        },
      ],
    };
    const context: UIFlowContext = {
      stage: 'reviewing_itinerary',
      itinerary: '东京三日',
      requirements: {},
      query: null,
    };
    expect(
      (
        await service.generateUIResponse('确认旅游路线', [], context)
      ).components.map((c) => c.type),
    ).toEqual(['confirmation', 'steps']);
  });
  it.each([
    {
      message: '',
      intent: 'general',
      components: [{ type: 'unknown', id: 'bad' }],
    },
    {
      message: '',
      intent: 'place_details',
      components: [
        {
          id: 'bad',
          type: 'selection',
          title: '旅游类型',
          mode: 'single',
          options: [{ value: 'solo', label: '个人游', description: null }],
        },
      ],
    },
    {
      message: '',
      intent: 'trip_planning',
      components: [
        {
          id: 'bad',
          type: 'confirmation',
          title: '确认',
          summary: '伪造路线',
          confirmLabel: '确认',
          cancelLabel: '取消',
        },
      ],
    },
    {
      message: '',
      intent: 'place_details',
      components: [
        {
          id: 'bad',
          type: 'card',
          title: '酒店',
          category: 'hotel',
          description: '实时价格',
          details: [],
          sourceStatus: 'verified',
        },
      ],
    },
  ])(
    'rejects invalid or ungrounded output with sanitized 502',
    async (invalid) => {
      reply = invalid;
      await expect(
        service.generateUIResponse('查看某某酒店'),
      ).rejects.toMatchObject({ status: 502, message: 'INTERNAL_ERROR' });
    },
  );
  it('rejects confirmation without progress even with a known route', async () => {
    reply = {
      message: '',
      intent: 'trip_planning',
      components: [
        {
          id: 'c',
          type: 'confirmation',
          title: '确认',
          summary: '东京三日',
          confirmLabel: '确认',
          cancelLabel: '取消',
        },
      ],
    };
    await expect(
      service.generateUIResponse('确认路线', [], {
        stage: 'reviewing_itinerary',
        itinerary: '东京三日',
        requirements: {},
        query: null,
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('answers general travel questions without forcing a wizard', async () => {
    reply = {
      message: '出行建议',
      intent: 'general',
      components: [
        {
          id: 'text',
          type: 'text',
          content: '建议了解交通和当地习俗。',
          format: 'markdown',
        },
      ],
    };
    expect(
      (await service.generateUIResponse('日本旅游有哪些注意事项？')).intent,
    ).toBe('general');
  });
  it('does not require a type choice already supplied in the direct service input', async () => {
    reply = {
      message: '补充需求',
      intent: 'trip_planning',
      components: [
        {
          id: 'form',
          type: 'form',
          title: '补充需求',
          fields: [
            {
              type: 'date',
              name: 'departureDate',
              label: '出发日期',
              required: true,
              placeholder: null,
            },
          ],
          submitLabel: '提交',
        },
      ],
    };
    expect(
      (await service.generateUIResponse('我要去日本个人游旅游')).components[0]
        .type,
    ).toBe('form');
  });
  it('rejects a planning selection mislabeled as general before committing', async () => {
    reply = {
      message: '请选择',
      intent: 'general',
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
    await expect(
      service.generateUIResponse('我要去日本旅游'),
    ).rejects.toMatchObject({ status: 502 });
  });
});
