import type { BaseMessage } from '@langchain/core/messages';
import type { StatusPhase } from '@autix/contracts';
import type { Effect, EditTarget } from './commands.js';
import { copy } from './copy.js';
import { mergeStays, overviewLine, parseDraft, splice, type PlanDay } from './itinerary.js';
import type { TripLlm } from './llm.js';
import { groundResults } from './results.js';
import type { TripState } from './state.js';
import { MAX_STORED_RESULTS, USE_STAY, WRITE_DAY, type EditCall, type LoopEvent } from './tool-loop.js';

/** What a turn streams while an effect runs; the same shapes as TripStreamEvent. */
export type EffectEvent =
  | { type: 'status'; phase: StatusPhase }
  /** Chat bubble text: an answer or a revise summary. */
  | { type: 'text'; delta: string }
  /** The itinerary markdown while it is written, for the panel. */
  | { type: 'draft'; delta: string };

/**
 * The one fold from LLM events to state, shared by TurnService and the eval harness.
 * Mutates `input.state` (the reducer's output, owned by this turn) and returns the chat reply, or null when
 * the model wrote none. A failure throws before anything half-applied matters: the caller keeps the old state.
 * `observe` sees every raw loop event (the eval harness records tool calls with it).
 */
export async function* runEffect(
  llm: TripLlm,
  effect: Exclude<Effect, null>,
  input: { text: string | null; state: TripState; history: BaseMessage[] },
  signal: AbortSignal,
  observe?: (event: LoopEvent) => void,
): AsyncGenerator<EffectEvent, string | null> {
  const next = input.state;
  const target = effect.type === 'revise' ? effect.target : undefined;
  const edits = new Edits(next, target ?? { days: [], nights: [] });
  const stream = effect.type === 'itinerary' ? 'draft' : 'text';
  let text = '';
  for await (const event of llm.respond(effect.type, { ...input, target }, signal)) {
    signal.throwIfAborted();
    observe?.(event);
    switch (event.type) {
      case 'tool_call':
        yield { type: 'status', phase: 'searching' };
        break;
      case 'text':
        if (!event.delta) break;
        if (!text) yield { type: 'status', phase: 'writing' };
        text += event.delta;
        yield { type: stream, delta: event.delta };
        break;
      case 'discard_text':
        // Narration before a tool call; the client drops what it streamed when a search starts.
        text = '';
        yield { type: 'status', phase: 'searching' };
        break;
      case 'tool_results':
        next.toolResults = event.results.slice(-MAX_STORED_RESULTS);
        break;
      case 'show_results': {
        const group = groundResults(event.input, event.results);
        if (effect.type !== 'answer' && group.panel === 'hotels')
          next.stays = mergeStays(next.stays, group, new Set(next.days.flatMap((d) => d.stayRef ?? [])));
        else if (group.items.length) next.results.push(group);
        break;
      }
      case 'edit':
        event.reply = edits.apply(event.call);
        break;
    }
  }
  const c = copy(next.locale);
  switch (effect.type) {
    case 'answer':
      return text || null;
    case 'itinerary': {
      if (!text.trim()) throw new Error('Empty itinerary');
      yield { type: 'status', phase: 'organizing' };
      const draft = parseDraft(text, next.stays);
      const stops = await Promise.all(draft.days.map((day) => llm.extractStops(day, next.locale, signal)));
      next.preamble = draft.preamble;
      next.days = draft.days.map((day, i) => ({ ...day, stops: stops[i] }));
      next.footer = draft.footer;
      return c.draftReady(overviewLine(next.preamble));
    }
    case 'revise': {
      if (edits.days.size) yield { type: 'status', phase: 'organizing' };
      const rewritten = await Promise.all(
        [...edits.days].map(async ([i, day]) => [i, { ...day, stops: await llm.extractStops(day, next.locale, signal) }] as const),
      );
      const spliced = splice(next, { days: new Map(rewritten), preamble: edits.preamble, nights: edits.nights });
      next.preamble = spliced.preamble;
      next.days = spliced.days;
      return text || null;
    }
  }
}

/** Validates the model's draft edits against the target; a rejection tells the model what to fix. */
class Edits {
  readonly days = new Map<number, Pick<PlanDay, 'title' | 'body'>>();
  readonly nights = new Map<number, string>();
  preamble: string | undefined;

  constructor(
    private readonly state: TripState,
    private readonly target: EditTarget,
  ) {}

  apply(call: EditCall): string {
    if (call.name === WRITE_DAY) return this.writeDay(call.args.day, call.args.markdown);
    if (call.name === USE_STAY) return this.useStay(call.args.hotelId, call.args.days);
    this.preamble = call.args.markdown.trim();
    return 'ok';
  }

  private writeDay(day: number, markdown: string): string {
    const i = day - 1;
    if (!this.target.days.includes(i)) return `Day ${day} is not part of this edit. Only rewrite day ${listed(this.target.days)}.`;
    const draft = parseDraft(markdown, this.state.stays);
    const [parsed] = draft.days;
    if (draft.days.length !== 1 || !parsed) return 'Write exactly one day, starting with its "Day N | …" header line.';
    this.days.set(i, { title: parsed.title, body: parsed.body });
    if (parsed.stayRef && this.target.nights.includes(i)) this.nights.set(i, parsed.stayRef);
    return 'ok';
  }

  private useStay(hotelId: string, days: number[]): string {
    const stay = this.state.stays?.items.find((h) => h.id === hotelId);
    if (!stay) return `Hotel ${hotelId} is not among the hotels you showed. Show it with show_results first.`;
    const outside = days.filter((d) => !this.target.nights.includes(d - 1));
    if (outside.length) return `The nights after day ${outside.join(', ')} are not part of this edit. Only change the nights after day ${listed(this.target.nights)}.`;
    for (const d of days) this.nights.set(d - 1, stay.ref);
    return 'ok';
  }
}

const listed = (indices: number[]) => (indices.length ? indices.map((i) => i + 1).join(', ') : '(none)');
