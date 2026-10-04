import 'reflect-metadata';
import { UIFlowService } from '../src/llm/ui-protocol/ui-flow.service.js';
import { UIResponseService } from '../src/llm/ui-protocol/ui-response.service.js';
import { UIStreamService } from '../src/llm/ui-protocol/ui-stream.service.js';
import type {
  UIFlowSnapshot,
  PreparedUITurn,
} from '../src/llm/ui-protocol/ui-session.js';
import type { SendMessageRequest } from '@autix/contracts';

const stream = new UIStreamService(new UIFlowService(new UIResponseService()));
async function run(
  snapshot: UIFlowSnapshot | null,
  request: SendMessageRequest,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let turn: PreparedUITurn | undefined;
  let chunks = 0;
  let chars = 0;
  const started = Date.now();
  let firstTokenMs: number | null = null;
  try {
    for await (const event of stream.streamTurn(
      snapshot,
      request,
      [],
      controller.signal,
    )) {
      if (event.type === 'markdown') {
        chunks++;
        chars += event.content.length;
        firstTokenMs ??= Date.now() - started;
      }
      if (event.type === 'final') turn = event.turn;
    }
    if (!turn) throw new Error('Missing final turn');
    console.log(
      JSON.stringify({
        components: turn.response.components.map((c) => c.type),
        stage: turn.snapshot.context.stage,
        chunks,
        chars,
        firstTokenMs,
        totalMs: Date.now() - started,
        days: turn.snapshot.trip?.days.length ?? 0,
      }),
    );
    return turn;
  } finally {
    clearTimeout(timer);
  }
}
try {
  const first = await run(null, { content: '我要去杭州旅游', locale: 'zh' });
  const selection = first.response.components.find(
    (c) => c.type === 'selection',
  );
  if (!selection) throw new Error('Missing trip selection');
  const second = await run(first.snapshot, {
    action: { type: 'selection', componentId: selection.id, values: ['solo'] },
    sourceMessageId: 'live-first',
    revision: first.snapshot.revision,
    locale: 'zh',
  });
  const form = second.response.components.find((c) => c.type === 'form');
  if (!form) throw new Error('Missing requirements form');
  const supplied: Record<string, string | number | null> = {
    destination: '杭州',
    departureDate: '2026-11-01',
    returnDate: '2026-11-03',
    travelers: 1,
    budget: 3000,
    preferences: '西湖和美食',
  };
  await run(second.snapshot, {
    action: {
      type: 'form_submit',
      componentId: form.id,
      values: form.fields.map((field) => ({
        name: field.name,
        value: supplied[field.name] ?? null,
      })),
    },
    sourceMessageId: 'live-second',
    revision: second.snapshot.revision,
    locale: 'zh',
  });
} catch (error) {
  console.error(
    JSON.stringify({
      failed: true,
      type: error instanceof Error ? error.name : 'Unknown',
      message:
        error instanceof Error && !error.message.includes('http')
          ? error.message.slice(0, 160)
          : 'Live upstream call failed',
    }),
  );
  process.exitCode = 1;
}
