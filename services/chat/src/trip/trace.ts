import { z } from 'zod';
import type { TraceLookup, TracePhase, TraceVerification, TurnTrace } from '@autix/contracts';

type TraceEvent =
  | { type: 'phase'; phase: TracePhase; at: string }
  | { type: 'lookup'; lookup: TraceLookup }
  | { type: 'grounding'; kept: number; dropped: number; at: string };

export class TurnTraceBuilder {
  private readonly steps: TurnTrace['steps'] = [];
  private readonly lookups: TraceLookup[] = [];
  private grounding: TraceVerification['grounding'] = null;

  get started(): boolean {
    return this.steps.length > 0;
  }

  record(event: TraceEvent): void {
    switch (event.type) {
      case 'phase':
        if (this.steps.at(-1)?.phase !== event.phase && this.steps.length < 40)
          this.steps.push({ phase: event.phase, at: event.at });
        return;
      case 'lookup':
        if (this.lookups.length < 20) this.lookups.push({ ...event.lookup });
        return;
      case 'grounding':
        this.grounding = {
          kept: (this.grounding?.kept ?? 0) + event.kept,
          dropped: (this.grounding?.dropped ?? 0) + event.dropped,
        };
        return;
    }
  }

  finish(endedAt: string): TurnTrace {
    return {
      steps: this.steps.map((step) => ({ ...step })),
      endedAt,
      verification: {
        lookups: this.lookups.map((lookup) => ({ ...lookup })),
        grounding: this.grounding ? { ...this.grounding } : null,
      },
    };
  }
}

const CountableResultSchema = z.object({ hotels: z.array(z.unknown()) });

export function lookupCount(content: string): number | null {
  try {
    const result = CountableResultSchema.safeParse(JSON.parse(content));
    return result.success ? result.data.hotels.length : null;
  } catch {
    return null;
  }
}
