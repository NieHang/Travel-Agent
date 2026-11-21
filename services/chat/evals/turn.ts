import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { reduce, uncheckedDestination } from '../src/trip/commands.js';
import type { TripLlm } from '../src/trip/llm.js';
import { runEffect } from '../src/trip/effect.js';
import type { ToolResult } from '../src/trip/results.js';
import type { TripState } from '../src/trip/state.js';
import type { TurnOutputSchema } from './schemas.js';

export async function turn(
  llm: TripLlm, state: TripState, text: string,
  options: { history?: BaseMessage[]; signal?: AbortSignal; onRead?: (ids: string[]) => void } = {},
): Promise<TurnOutput> {
  const signal = options.signal ?? AbortSignal.timeout(180_000);
  const history = options.history ?? [];
  const classified = await llm.classify({ text, state, history }, signal);
  const command = { type: 'message', text } as const;
  const destination = uncheckedDestination(state, command, classified);
  const place = destination ? { destination, ...(await llm.locate(destination, signal)) } : undefined;
  const { state: next, effect } = reduce(state, command, classified, place);
  let draft = '';
  let reply: string | null = null;
  const loaded: string[] = [];
  const calls: string[] = [];
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const toolResults: ToolResult[] = [];
  if (effect) {
    const events = runEffect(llm, effect, { text, state: next, history }, signal, (e) => {
      if (e.type === 'wiki_read') options.onRead?.(e.pages.map(page => page.id));
      if (e.type === 'tool_call') {
        calls.push(e.name);
        toolCalls.push({ name: e.name, args: e.args });
        if (e.name === 'load_skill') loaded.push(...z.array(z.string()).parse(e.args.names));
      }
      if (e.type === 'tool_results') toolResults.splice(0, toolResults.length, ...e.results);
    });
    for (let step = await events.next(); ; step = await events.next()) {
      if (step.done) {
        reply = step.value;
        break;
      }
      // `draft` is the model's raw text (the itinerary markdown, or the reply for other effects).
      if (step.value.type === 'status' && step.value.phase === 'searching') draft = '';
      if (step.value.type !== 'status') draft += step.value.delta;
    }
  }
  return { classified, place, next, effect: effect?.type ?? null, draft, reply, loaded, calls, toolCalls, toolResults };
}

export type TurnOutput = z.infer<typeof TurnOutputSchema>;
