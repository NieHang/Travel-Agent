import { HumanMessage, ToolMessage, type AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { compactToolContent } from '../llm/mcp/compact.js';
import {
  SHOW_RESULTS,
  SHOW_RESULTS_RULES,
  ShowResultsInputSchema,
  type ShowResultsInput,
  type ToolResult,
} from './results.js';

// Japan drafts may load city skills, search hotels per city, then show_results before writing.
export const MAX_TOOL_ROUNDS = 5;
const MAX_RESULT_LENGTH = 12_000;
export const MAX_STORED_RESULTS = 8;

export type LoopEvent =
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_results'; results: ToolResult[] }
  | { type: 'show_results'; input: ShowResultsInput; results: ToolResult[] }
  /**
   * A call to one of the draft-editing tools. The consumer validates it and may set `reply` before asking
   * for the next event; the model gets that reply (default "ok") as the tool result, so it can fix a rejected edit.
   */
  | { type: 'edit'; call: EditCall; results: ToolResult[]; reply?: string }
  | { type: 'text'; delta: string }
  // The text streamed in a round that ended with tool calls was narration ("I'll search hotels..."), not the reply.
  | { type: 'discard_text' };

export interface StreamingModel {
  stream(
    messages: BaseMessage[],
    options: { signal: AbortSignal; tool_choice?: 'none'; runName?: string },
  ): Promise<AsyncIterable<AIMessageChunk>>;
}

export const WRITE_DAY = 'write_day';
const WRITE_PREAMBLE = 'write_preamble';
export const USE_STAY = 'use_stay';

const EDIT_SCHEMAS = {
  [WRITE_DAY]: z.object({
    day: z.number().int().describe('The day number, as in the [D#] tag of serverContext.plan.'),
    markdown: z.string().describe('The whole day in the draft format: its "Day N | …" header line, timeline, alternatives line and hotel line.'),
  }),
  [WRITE_PREAMBLE]: z.object({
    markdown: z.string().describe('The draft text before the first day: title, overview and before-you-go, in the draft format.'),
  }),
  [USE_STAY]: z.object({
    hotelId: z.string().describe('The provider hotelId, copied exactly from a tool result you showed with show_results.'),
    days: z.array(z.number().int()).describe('The day numbers whose night is spent at this hotel.'),
  }),
};
export type EditCall = { [K in keyof typeof EDIT_SCHEMAS]: { name: K; args: z.infer<(typeof EDIT_SCHEMAS)[K]> } }[keyof typeof EDIT_SCHEMAS];

/** The tools a revise turn edits the draft with; the loop never runs them, it reports them as `edit` events. */
export const editTools = [
  tool(async () => 'ok', { name: WRITE_DAY, description: 'Replace one day of the draft.', schema: EDIT_SCHEMAS[WRITE_DAY] }),
  tool(async () => 'ok', { name: WRITE_PREAMBLE, description: 'Replace the overview and before-you-go part of the draft.', schema: EDIT_SCHEMAS[WRITE_PREAMBLE] }),
  tool(async () => 'ok', { name: USE_STAY, description: 'Put a hotel on the nights after the given days.', schema: EDIT_SCHEMAS[USE_STAY] }),
];

function parseEdit(name: string, args: unknown): EditCall | string | null {
  if (name !== WRITE_DAY && name !== WRITE_PREAMBLE && name !== USE_STAY) return null;
  const parsed = EDIT_SCHEMAS[name].safeParse(args);
  if (!parsed.success) return `Invalid ${name} arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
  return { name, args: parsed.data } as EditCall;
}

const FINAL_ROUND_NOTE =
  '[Server note, not from the user] No more tool calls are available in this turn. Write the reply now from the tool results above.';

/** The model sees the same schema as the traced tool that emits the grounding event. */
export const showResultsTool = createShowResultsTool();

function createShowResultsTool(onShow?: (input: ShowResultsInput) => void) {
  return tool(async (input) => {
    onShow?.(input);
    return 'shown';
  }, { name: SHOW_RESULTS, description: SHOW_RESULTS_RULES, schema: ShowResultsInputSchema });
}

function toResult(callId: string, name: string, args: Record<string, unknown>, output: unknown): ToolResult {
  const raw =
    output && typeof output === 'object' && 'content' in output
      ? (output as { content: unknown; isError?: unknown })
      : { content: output, isError: false };
  const text = compactToolContent(typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content));
  return {
    callId,
    tool: name,
    args,
    content: text.length > MAX_RESULT_LENGTH ? `${text.slice(0, MAX_RESULT_LENGTH)}... [truncated]` : text,
    isError: raw.isError === true,
  };
}

/**
 * One tool-calling conversation: each round is streamed; a round with tool calls runs them and
 * continues, a round with only text is the answer. Text is yielded as it arrives.
 * When `maxRounds` tool rounds are used up, one more round runs with tools disabled, so the turn
 * still ends with a reply (a multi-city draft can spend every round on skills and searches).
 * Tools named in `unrecorded` (e.g. load_skill) reach the model as raw text and are not reported as results.
 */
export async function* streamToolLoop(
  model: StreamingModel,
  tools: StructuredToolInterface[],
  messages: BaseMessage[],
  signal: AbortSignal,
  maxRounds = MAX_TOOL_ROUNDS,
  unrecorded: ReadonlySet<string> = new Set(),
  callbacks: BaseCallbackHandler[] = [],
): AsyncGenerator<LoopEvent> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const conversation = [...messages];
  const results: ToolResult[] = [];
  const shown: LoopEvent[] = [];
  const showTool = createShowResultsTool((input) => shown.push({ type: 'show_results', input, results: [...results] }));
  for (let round = 0; round <= maxRounds; round++) {
    signal.throwIfAborted();
    const final = round === maxRounds;
    if (final) conversation.push(new HumanMessage(FINAL_ROUND_NOTE));
    let reply: AIMessageChunk | undefined;
    let wrote = false;
    for await (const chunk of await model.stream(conversation, { signal, runName: 'trip.respond', ...final ? { tool_choice: 'none' as const } : {} })) {
      signal.throwIfAborted();
      reply = reply ? reply.concat(chunk) : chunk;
      if (typeof chunk.content === 'string' && chunk.content) {
        wrote = true;
        yield { type: 'text', delta: chunk.content };
      }
    }
    const calls = reply?.tool_calls ?? [];
    // Calls whose arguments are not valid JSON (DeepSeek truncates long show_results payloads now and then).
    const invalid = reply?.invalid_tool_calls ?? [];
    if (final || !reply || (!calls.length && !invalid.length)) return;
    if (wrote) yield { type: 'discard_text' };
    // Only valid calls are sent back to the API, so invalid ones get no ToolMessage (it would be orphaned).
    if (calls.length) conversation.push(reply);
    for (const call of calls) {
      const callId = call.id ?? `${call.name}-${round}`;
      const edit = parseEdit(call.name, call.args);
      if (typeof edit === 'string') {
        conversation.push(new ToolMessage({ tool_call_id: callId, content: edit }));
        continue;
      }
      if (edit) {
        const event: Extract<LoopEvent, { type: 'edit' }> = { type: 'edit', call: edit, results: [...results] };
        yield event;
        conversation.push(new ToolMessage({ tool_call_id: callId, content: event.reply ?? 'ok' }));
        continue;
      }
      if (call.name === SHOW_RESULTS) {
        const response = await showTool.invoke({ type: 'tool_call', id: callId, name: SHOW_RESULTS, args: call.args }, { signal, callbacks, runName: SHOW_RESULTS }).catch((error: unknown) => {
          if (signal.aborted) throw error;
          return `Invalid show_results arguments: ${error instanceof Error ? error.message : String(error)}`;
        });
        yield* shown.splice(0);
        conversation.push(
          new ToolMessage({
            tool_call_id: callId,
            content: typeof response === 'string' ? response : response.content,
          }),
        );
        continue;
      }
      yield { type: 'tool_call', name: call.name, args: call.args };
      const found = byName.get(call.name);
      const registered = found && 'callbacks' in found ? found.callbacks : undefined;
      const callCallbacks = Array.isArray(registered) ? callbacks.filter((handler) => !registered.includes(handler)) : callbacks;
      let output: unknown;
      try {
        output = found
          ? await found.invoke(call.args, { signal, callbacks: callCallbacks, runName: call.name })
          : { content: `Unknown tool ${call.name}`, isError: true };
      } catch (error) {
        if (signal.aborted) throw error;
        output = { content: `Tool ${call.name} failed`, isError: true };
      }
      signal.throwIfAborted();
      if (unrecorded.has(call.name)) {
        const raw = output && typeof output === 'object' && 'content' in output ? output.content : output;
        conversation.push(
          new ToolMessage({ tool_call_id: callId, content: typeof raw === 'string' ? raw : JSON.stringify(raw) }),
        );
        continue;
      }
      // show_results items cite a short id, not the provider's: models mis-copy long random ids
      // (call_01_t8cufVY… came back with a lowercase v and grounding dropped every hotel).
      const result = toResult(`t${results.length + 1}`, call.name, call.args, output);
      results.push(result);
      yield { type: 'tool_results', results: [...results] };
      conversation.push(
        new ToolMessage({
          tool_call_id: callId,
          content: JSON.stringify({ source: result.callId, content: result.content, isError: result.isError }),
        }),
      );
    }
    if (invalid.length)
      conversation.push(
        new HumanMessage(
          `[Server note, not from the user] These tool calls were not run because their arguments were not valid JSON: ${invalid
            .map((c) => c.name ?? 'unknown')
            .join(', ')}. Call them again with complete, valid JSON; keep the arguments short.`,
        ),
      );
  }
}
