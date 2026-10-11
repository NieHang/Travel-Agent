import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { McpService } from '../mcp/mcp.service.js';
import { UIResponseService } from './ui-response.service.js';
import { compactToolContent, runToolLoop } from './ui-tool-loop.js';
import { UIFlowService } from './ui-flow.service.js';
import { UIFlowSnapshotSchema } from './ui-session.js';
import { modelOutput } from './ui-test.fixtures.js';
import type { AIUIResponse, UIFlowContext } from './ui-types.js';

const HOTEL_TOOL = 'mcp_rollingGo_searchHotels';

function hotelTool(impl: (args: Record<string, unknown>) => unknown) {
  return tool(async (args) => impl(args), {
    name: HOTEL_TOOL,
    description: 'Find hotels',
    schema: z.object({
      originQuery: z.string(),
      place: z.string(),
      placeType: z.string(),
    }),
  });
}

const args = {
  originQuery: 'Hotels near the Bund under 800',
  place: 'The Bund',
  placeType: 'point_of_interest',
};
const call = (id: string) =>
  new AIMessage({
    content: '',
    tool_calls: [{ id, name: HOTEL_TOOL, args, type: 'tool_call' }],
  });

describe('runToolLoop', () => {
  it('executes tool calls and feeds results back until the model stops', async () => {
    const seen: unknown[][] = [];
    const replies = [call('c1'), new AIMessage('done')];
    const model = RunnableLambda.from(async (messages: unknown[]) => {
      seen.push(messages);
      return replies.shift()!;
    });
    const results = await runToolLoop(
      model as never,
      [hotelTool(() => ({ content: 'Hotel A ¥700', isError: false }))],
      [new HumanMessage('find hotels')],
    );
    expect(results).toEqual([
      { tool: HOTEL_TOOL, args, content: 'Hotel A ¥700', isError: false },
    ]);
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen[1])).toContain('Hotel A ¥700');
  });

  it('reports unknown tools as errors and stops at the round limit', async () => {
    const model = RunnableLambda.from(
      async () =>
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'x', name: 'nope', args: {}, type: 'tool_call' }],
        }),
    );
    const results = await runToolLoop(model as never, [], [], undefined, 2);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.isError)).toBe(true);
  });
});

const hotelsUI = (names: string[]): AIUIResponse => ({
  message: 'Hotels',
  intent: 'hotel_search',
  components: [
    {
      id: 'hotels',
      type: 'table',
      title: 'Hotels',
      columns: [{ key: 'name', label: 'Name' }],
      rows: names.map((name, i) => ({
        id: `row-${i}`,
        cells: [{ key: 'name', value: name }],
      })),
    },
  ],
});

describe('UIResponseService travel tool lookup', () => {
  let server: Server;
  let wires: Record<string, any>[];
  let structuredReplies: unknown[];
  let toolTurns: AIMessage[];

  const completion = (message: Record<string, unknown>) =>
    JSON.stringify({
      id: 'tool-test',
      object: 'chat.completion',
      choices: [{ index: 0, finish_reason: 'stop', message }],
    });

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const wire = JSON.parse(raw);
      wires.push(wire);
      res.setHeader('Content-Type', 'application/json');
      // Structured output forces tool_choice; the tool loop leaves it free.
      if (wire.tool_choice) {
        res.end(
          completion({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'out',
                type: 'function',
                function: {
                  name: wire.tools[0].function.name,
                  arguments: JSON.stringify(structuredReplies.shift()),
                },
              },
            ],
          }),
        );
        return;
      }
      const turn = toolTurns.shift() ?? new AIMessage('done');
      res.end(
        completion({
          role: 'assistant',
          content: turn.tool_calls?.length ? null : turn.content,
          ...(turn.tool_calls?.length
            ? {
                tool_calls: turn.tool_calls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
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
    wires = [];
    structuredReplies = [];
    toolTurns = [];
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  const serviceWith = (impl: (args: Record<string, unknown>) => unknown) =>
    new UIResponseService({
      mcpManager: { getTools: () => [hotelTool(impl)] },
    } as unknown as McpService);

  it('calls the hotel tool and rebuilds the UI from its results', async () => {
    const received: unknown[] = [];
    const service = serviceWith((a) => {
      received.push(a);
      return { content: 'Bund Hotel, ¥700/night', isError: false };
    });
    const grounded = modelOutput(hotelsUI(['Bund Hotel']));
    structuredReplies = [modelOutput(hotelsUI([])), grounded];
    toolTurns = [call('c1')];
    const output = await service.generateUIResponse(args.originQuery);
    expect(received).toEqual([args]);
    expect(output).toEqual({
      ...grounded,
      toolResults: [
        {
          tool: HOTEL_TOOL,
          args,
          content: 'Bund Hotel, ¥700/night',
          isError: false,
        },
      ],
    });
    const loopWire = wires.find((w) => !w.tool_choice)!;
    expect(loopWire.tools.map((t: any) => t.function.name)).toEqual([
      HOTEL_TOOL,
    ]);
    const finalWire = wires.at(-1)!;
    expect(finalWire.tool_choice).toBeDefined();
    expect(JSON.stringify(finalWire.messages)).toContain('serverToolResults');
    expect(JSON.stringify(finalWire.messages)).toContain(
      'Bund Hotel, ¥700/night',
    );
  });

  it('skips tools for general answers', async () => {
    const service = serviceWith(() => {
      throw new Error('should not run');
    });
    const general = modelOutput({
      message: 'Hi',
      intent: 'general',
      components: [{ id: 't', type: 'text', content: 'Hi', format: 'plain' }],
    });
    structuredReplies = [general];
    expect(await service.generateUIResponse('hello')).toEqual(general);
    expect(wires).toHaveLength(1);
  });

  it('returns the routed UI when the model calls no tool', async () => {
    const service = serviceWith(() => ({ content: 'x', isError: false }));
    const routed = modelOutput(hotelsUI([]));
    structuredReplies = [routed];
    toolTurns = [new AIMessage('No tool fits.')];
    expect(await service.generateUIResponse('hotels?')).toEqual(routed);
    expect(wires).toHaveLength(2);
  });
});

describe('compactToolContent', () => {
  it('keeps ids, names, prices and links of hotel results', () => {
    const raw = JSON.stringify({
      message: 'Hotel search succeeded',
      hotelInformationList: [
        {
          hotelId: 43615,
          bookingUrl: 'https://rollinggo.ai/h/43615',
          name: 'Sunworld Dynasty Hotel Beijing',
          brand: null,
          address: '50 Wangfujing Street',
          latitude: 39.9,
          longitude: 116.4,
          distanceInMeters: 205,
          starRating: 5,
          price: { hasPrice: true, currency: 'CNY', lowestPrice: 626 },
          description: 'long text',
          imageUrl: 'https://image-cdn/x.jpg',
          hotelAmenities: ['WiFi'],
          tags: ['Near Shopping Mall', 'Free WiFi'],
        },
      ],
    });
    expect(JSON.parse(compactToolContent(raw))).toEqual({
      message: 'Hotel search succeeded',
      hotels: [
        {
          hotelId: 43615,
          name: 'Sunworld Dynasty Hotel Beijing',
          brand: null,
          address: '50 Wangfujing Street',
          starRating: 5,
          distanceInMeters: 205,
          lowestPrice: '626 CNY',
          tags: ['Near Shopping Mall', 'Free WiFi'],
          bookingUrl: 'https://rollinggo.ai/h/43615',
        },
      ],
    });
  });

  it('leaves other content untouched', () => {
    expect(compactToolContent('plain text')).toBe('plain text');
    expect(compactToolContent('{"tags":[]}')).toBe('{"tags":[]}');
  });
});

describe('tool results across turns', () => {
  it('stores results in the query context and sends them on the next turn', async () => {
    const results = [
      { tool: HOTEL_TOOL, args, content: '{"hotels":[]}', isError: false },
    ];
    const contexts: (UIFlowContext | undefined)[] = [];
    let next: unknown[] | undefined = results;
    const flow = new UIFlowService({
      generateUIResponse: async (
        _input: string,
        _history: unknown,
        context?: UIFlowContext,
      ) => {
        contexts.push(structuredClone(context));
        const output = { ...modelOutput(hotelsUI([])), toolResults: next };
        next = undefined;
        return output;
      },
    } as unknown as UIResponseService);
    await flow.chat('s', 'hotels near the Bund');
    await flow.chat('s', 'which one is cheapest?');
    expect(contexts[1]?.query?.results).toEqual(results);
    expect(
      UIFlowSnapshotSchema.shape.context.parse(contexts[1]).query?.results,
    ).toEqual(results);
  });
});
