import {
  ToolMessage,
  type AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

export const MAX_TOOL_ROUNDS = 4;
/** Results kept in the persisted flow context for follow-up turns. */
export const MAX_STORED_RESULTS = 8;
const MAX_RESULT_LENGTH = 12_000;

export interface ToolResult {
  tool: string;
  args: Record<string, unknown>;
  content: string;
  isError: boolean;
}

const MAX_HOTELS = 10;

interface RawHotel {
  hotelId?: number;
  name?: string;
  brand?: string | null;
  address?: string;
  starRating?: number;
  distanceInMeters?: number;
  bookingUrl?: string;
  tags?: string[];
  price?: { hasPrice?: boolean; lowestPrice?: number; currency?: string };
}

/**
 * Keeps only the fields the UI and follow-up turns need (ids, names, prices,
 * links); descriptions, images and coordinates would only cost tokens.
 */
export function compactToolContent(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  const list = (parsed as { hotelInformationList?: unknown })
    ?.hotelInformationList;
  if (!Array.isArray(list)) return text;
  return JSON.stringify({
    message: (parsed as { message?: unknown }).message,
    hotels: (list as RawHotel[]).slice(0, MAX_HOTELS).map((h) => ({
      hotelId: h.hotelId,
      name: h.name,
      brand: h.brand ?? null,
      address: h.address,
      starRating: h.starRating,
      distanceInMeters: h.distanceInMeters,
      lowestPrice: h.price?.hasPrice
        ? `${h.price.lowestPrice} ${h.price.currency}`
        : null,
      tags: h.tags?.slice(0, 5),
      bookingUrl: h.bookingUrl,
    })),
  });
}

function toResult(
  tool: string,
  args: Record<string, unknown>,
  output: unknown,
): ToolResult {
  const raw =
    output && typeof output === 'object' && 'content' in output
      ? (output as { content: unknown; isError?: unknown })
      : { content: output, isError: false };
  const text = compactToolContent(
    typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content),
  );
  return {
    tool,
    args,
    content:
      text.length > MAX_RESULT_LENGTH
        ? `${text.slice(0, MAX_RESULT_LENGTH)}... [truncated]`
        : text,
    isError: raw.isError === true,
  };
}

/**
 * Lets a tool-bound model call tools until it stops asking or the round limit
 * is reached. Returns every executed call; tool failures become error results
 * the model can see instead of aborting the turn.
 */
export async function runToolLoop(
  model: Runnable<BaseMessage[], AIMessage>,
  tools: StructuredToolInterface[],
  messages: BaseMessage[],
  signal?: AbortSignal,
  maxRounds = MAX_TOOL_ROUNDS,
): Promise<ToolResult[]> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const conversation = [...messages];
  const results: ToolResult[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const reply = await model.invoke(conversation, { signal });
    signal?.throwIfAborted();
    const calls = reply.tool_calls ?? [];
    if (!calls.length) break;
    conversation.push(reply);
    for (const call of calls) {
      const tool = byName.get(call.name);
      const result = tool
        ? toResult(
            call.name,
            call.args,
            await tool.invoke(call.args, { signal }),
          )
        : toResult(call.name, call.args, {
            content: `Unknown tool ${call.name}`,
            isError: true,
          });
      signal?.throwIfAborted();
      results.push(result);
      conversation.push(
        new ToolMessage({
          tool_call_id: call.id ?? call.name,
          content: JSON.stringify({
            content: result.content,
            isError: result.isError,
          }),
        }),
      );
    }
  }
  return results;
}
