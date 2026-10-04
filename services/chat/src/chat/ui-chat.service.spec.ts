import { UIChatService } from './ui-chat.service.js';
import { UIStreamService } from '../llm/ui-protocol/ui-stream.service.js';
import { UIFlowService } from '../llm/ui-protocol/ui-flow.service.js';
import { FakeUIResponseService } from '../llm/ui-protocol/ui-response.fake.js';
import type { SendMessageRequest, StreamMessage } from '@autix/contracts';

function database() {
  const rows: any[] = [];
  const prisma = {
    message: {
      create: vi.fn(async ({ data }) => {
        const row = {
          id: `m-${rows.length}`,
          createdAt: new Date(),
          metadata: null,
          status: 'complete',
          ...data,
        };
        rows.push(row);
        return row;
      }),
      findFirst: vi.fn(
        async () =>
          [...rows]
            .reverse()
            .find(
              (r) => r.status === 'complete' && r.metadata?.uiFlowSnapshot,
            ) ?? null,
      ),
      findMany: vi.fn(async () => []),
    },
    conversation: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (p) => Promise.all(p)),
  };
  return { prisma, rows };
}
async function collect(service: UIChatService, request: SendMessageRequest) {
  const events: StreamMessage[] = [];
  for await (const event of service.send(
    'c',
    request,
    new AbortController().signal,
  ))
    events.push(event);
  return events;
}
describe('durable UI conversation integration', () => {
  it('rejects invalid action values before creating a user turn or starting SSE', async () => {
    const { prisma, rows } = database();
    const service = new UIChatService(
      prisma as never,
      new UIStreamService(new UIFlowService(new FakeUIResponseService())),
    );
    const first = await collect(service, { content: '杭州', locale: 'zh' });
    const done = first.at(-1)!;
    if (done.messageType !== 'done') throw Error();
    const state = done.payload.message.metadata!.interactionState!;
    const selection = done.payload.message.metadata!.components!.find(
      (c) => c.type === 'selection',
    )!;
    await expect(
      collect(service, {
        action: {
          type: 'selection',
          componentId: selection.id,
          values: ['invalid'],
        },
        sourceMessageId: state.sourceMessageId,
        revision: state.revision,
      }),
    ).rejects.toThrow();
    expect(rows).toHaveLength(2);
  });
  it('returns the public latest snapshot independently of paged message history', async () => {
    const { prisma } = database();
    const service = new UIChatService(
      prisma as never,
      new UIStreamService(new UIFlowService(new FakeUIResponseService())),
    );
    await collect(service, { content: '杭州', locale: 'zh' });
    const state = await service.getState('c');
    expect(state.trip?.destination).toBe('杭州');
    expect(state.activeMessage?.metadata).not.toHaveProperty('uiFlowSnapshot');
    expect(prisma.message.findMany).toHaveBeenCalledTimes(1);
  });
  it('persists components and restores actions using a fresh service instance', async () => {
    const { prisma, rows } = database();
    const create = () =>
      new UIChatService(
        prisma as never,
        new UIStreamService(new UIFlowService(new FakeUIResponseService())),
      );
    const first = await collect(create(), { content: '杭州', locale: 'zh' });
    expect(first.at(-1)?.messageType).toBe('done');
    const done = first.find((e) => e.messageType === 'done')!;
    if (done.messageType !== 'done') throw Error();
    const state = done.payload.message.metadata!.interactionState!;
    const component = done.payload.message.metadata!.components!.find(
      (c) => c.type === 'selection',
    )!;
    expect(done.payload.message.metadata).not.toHaveProperty('uiFlowSnapshot');
    expect(
      rows[1].metadata.uiFlowSnapshot.context.requirements.destination,
    ).toBe('杭州');
    const next = await collect(create(), {
      action: {
        type: 'selection',
        componentId: component.id,
        values: ['solo'],
      },
      sourceMessageId: state.sourceMessageId,
      revision: state.revision,
      locale: 'zh',
    });
    expect(next.at(-1)?.messageType).toBe('done');
    expect(rows).toHaveLength(4);
    expect(rows[3].metadata.uiFlowSnapshot.context.requirements.tripType).toBe(
      'solo',
    );
    await expect(
      collect(create(), {
        action: {
          type: 'selection',
          componentId: component.id,
          values: ['solo'],
        },
        sourceMessageId: state.sourceMessageId,
        revision: state.revision,
      }),
    ).rejects.toThrow();
    expect(rows).toHaveLength(4);
  });
  it('saves partial exactly once when the SSE consumer stops early', async () => {
    const { prisma, rows } = database();
    const stream = {
      async *streamTurn() {
        yield { type: 'markdown', content: 'part' };
        await new Promise(() => {});
      },
    };
    const service = new UIChatService(prisma as never, stream as never);
    const generator = service.send(
      'c',
      { content: 'hi' },
      new AbortController().signal,
    );
    await generator.next();
    await generator.next();
    await generator.return(undefined);
    expect(rows).toHaveLength(2);
    expect(rows[1].status).toBe('partial');
    expect(rows[1].content).toBe('part');
    expect(rows[1].metadata).toBeUndefined();
  });
});
