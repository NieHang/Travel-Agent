import { HumanMessage, ToolMessage, type AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
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
export const MAX_RESULT_LENGTH = 12_000;
export const MAX_STORED_RESULTS = 8;

export type LoopEvent =
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_results'; results: ToolResult[] }
  | { type: 'show_results'; input: ShowResultsInput; results: ToolResult[] }
  | { type: 'text'; delta: string };

export interface StreamingModel {
  stream(messages: BaseMessage[], options: { signal: AbortSignal }): Promise<AsyncIterable<AIMessageChunk>>;
}

/** Bound next to the MCP tools; the loop handles it itself and never invokes this function. */
export const showResultsTool = tool(async () => 'shown', {
  name: SHOW_RESULTS,
  description: SHOW_RESULTS_RULES,
  schema: ShowResultsInputSchema,
});

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
 * Tools named in `unrecorded` (e.g. load_skill) reach the model as raw text and are not reported as results.
 */
export async function* streamToolLoop(
  model: StreamingModel,
  tools: StructuredToolInterface[],
  messages: BaseMessage[],
  signal: AbortSignal,
  maxRounds = MAX_TOOL_ROUNDS,
  unrecorded: ReadonlySet<string> = new Set(),
): AsyncGenerator<LoopEvent> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const conversation = [...messages];
  const results: ToolResult[] = [];
  for (let round = 0; round < maxRounds; round++) {
    signal.throwIfAborted();
    let reply: AIMessageChunk | undefined;
    for await (const chunk of await model.stream(conversation, { signal })) {
      signal.throwIfAborted();
      reply = reply ? reply.concat(chunk) : chunk;
      if (typeof chunk.content === 'string' && chunk.content) yield { type: 'text', delta: chunk.content };
    }
    const calls = reply?.tool_calls ?? [];
    // Calls whose arguments are not valid JSON (DeepSeek truncates long show_results payloads now and then).
    const invalid = reply?.invalid_tool_calls ?? [];
    if (!reply || (!calls.length && !invalid.length)) return;
    // Only valid calls are sent back to the API, so invalid ones get no ToolMessage (it would be orphaned).
    if (calls.length) conversation.push(reply);
    for (const call of calls) {
      const callId = call.id ?? `${call.name}-${round}`;
      if (call.name === SHOW_RESULTS) {
        const parsed = ShowResultsInputSchema.safeParse(call.args);
        if (parsed.success) yield { type: 'show_results', input: parsed.data, results: [...results] };
        conversation.push(
          new ToolMessage({
            tool_call_id: callId,
            content: parsed.success
              ? 'shown'
              : `Invalid show_results arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
          }),
        );
        continue;
      }
      yield { type: 'tool_call', name: call.name, args: call.args };
      const found = byName.get(call.name);
      let output: unknown;
      try {
        output = found
          ? await found.invoke(call.args, { signal })
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
      const result = toResult(callId, call.name, call.args, output);
      results.push(result);
      yield { type: 'tool_results', results: [...results] };
      conversation.push(
        new ToolMessage({
          tool_call_id: callId,
          // show_results items cite callId as `source`; the model cannot see tool_call_id otherwise.
          content: JSON.stringify({ callId, content: result.content, isError: result.isError }),
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
