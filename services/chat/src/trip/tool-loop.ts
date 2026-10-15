import { ToolMessage, type AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { compactToolContent } from '../llm/mcp/compact.js';
import {
  SHOW_RESULTS,
  SHOW_RESULTS_RULES,
  ShowResultsInputSchema,
  type ShowResultsInput,
  type ToolResult,
} from './results.js';

export const MAX_TOOL_ROUNDS = 4;
export const MAX_RESULT_LENGTH = 12_000;
export const MAX_STORED_RESULTS = 8;

export type LoopEvent =
  | { type: 'tool_call'; name: string }
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
 */
export async function* streamToolLoop(
  model: StreamingModel,
  tools: StructuredToolInterface[],
  messages: BaseMessage[],
  signal: AbortSignal,
  maxRounds = MAX_TOOL_ROUNDS,
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
      // `text` reads both string content and text blocks (Claude streams blocks, thinking included).
      const delta = chunk.text;
      if (delta) yield { type: 'text', delta };
    }
    const calls = reply?.tool_calls ?? [];
    if (!reply || !calls.length) return;
    conversation.push(reply);
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
      yield { type: 'tool_call', name: call.name };
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
  }
}
