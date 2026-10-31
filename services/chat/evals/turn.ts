import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { reduce, uncheckedDestination } from '../src/trip/commands.js';
import type { TripLlm } from '../src/trip/llm.js';
import { groundResults, linkStays, mergeStays, type ToolResult } from '../src/trip/results.js';
import type { TripState } from '../src/trip/state.js';
import type { TurnOutputSchema } from './schemas.js';

export async function turn(
  llm: TripLlm, state: TripState, text: string,
  options: { history?: BaseMessage[]; signal?: AbortSignal } = {},
): Promise<TurnOutput> {
  const signal = options.signal ?? AbortSignal.timeout(180_000);
  const history = options.history ?? [];
  const classified = await llm.classify({ text, state, history }, signal);
  const command = { type: 'message', text } as const;
  const destination = uncheckedDestination(state, command, classified);
  const place = destination ? { destination, ...(await llm.locate(destination, signal)) } : undefined;
  const { state: next, effect } = reduce(state, command, classified, place);
  let draft = '';
  const loaded: string[] = [];
  const calls: string[] = [];
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const toolResults: ToolResult[] = [];
  if (effect)
    for await (const e of llm.respond(effect, { text, state: next, history }, signal)) {
      if (e.type === 'text') draft += e.delta;
      if (e.type === 'tool_call') {
        calls.push(e.name);
        toolCalls.push({ name: e.name, args: e.args });
        if (e.name === 'load_skill') loaded.push(...z.array(z.string()).parse(e.args.names));
      }
      if (e.type === 'tool_results') toolResults.splice(0, toolResults.length, ...e.results);
      if (e.type === 'show_results') {
        const group = groundResults(e.input, e.results);
        if (effect === 'itinerary' && group.panel === 'hotels') next.stays = mergeStays(next.stays, group);
        else if (group.items.length) next.results.push(group);
      }
    }
  if (effect === 'itinerary') {
    next.itinerary = draft;
    next.days = linkStays(await llm.extractDays(draft, next.stays, next.locale, signal), next.stays);
  }
  return { classified, place, next, effect, draft, loaded, calls, toolCalls, toolResults };
}

export type TurnOutput = z.infer<typeof TurnOutputSchema>;
