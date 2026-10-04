import { Inject, Injectable } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import type { ProgressPayload, SendMessageRequest } from '@autix/contracts';
import { UIFlowService } from './ui-flow.service.js';
import type { PreparedUITurn, UIFlowSnapshot } from './ui-session.js';

export type UIStreamEvent =
  | { type: 'progress'; payload: ProgressPayload }
  | { type: 'markdown'; content: string }
  | { type: 'final'; turn: PreparedUITurn };
@Injectable()
export class UIStreamService {
  constructor(@Inject(UIFlowService) private readonly flow: UIFlowService) {}
  async *streamTurn(
    snapshot: UIFlowSnapshot | null,
    request: SendMessageRequest,
    history: BaseMessage[],
    signal: AbortSignal,
  ): AsyncGenerator<UIStreamEvent> {
    const queue: UIStreamEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let failure: unknown;
    const push = (event: UIStreamEvent) => {
      queue.push(event);
      wake?.();
    };
    const abort = () => {
      failure = signal.reason ?? new Error('Aborted');
      finished = true;
      wake?.();
    };
    signal.addEventListener('abort', abort, { once: true });
    signal.throwIfAborted();
    const progress = (
      step: number,
      status: ProgressPayload['status'],
      agent: string,
    ) =>
      push({
        type: 'progress',
        payload: { agent, step, totalSteps: 4, status, label: agent },
      });
    progress(1, 'started', 'understand');
    let textStarted = false;
    const work = this.flow
      .prepareTurn(snapshot, request, history, signal, (content) => {
        if (signal.aborted) return;
        if (!textStarted) {
          textStarted = true;
          progress(1, 'completed', 'understand');
          progress(2, 'started', 'generate');
        }
        push({ type: 'markdown', content });
      })
      .then(
        (turn) => {
          if (signal.aborted) return;
          progress(
            textStarted ? 2 : 1,
            'completed',
            textStarted ? 'generate' : 'understand',
          );
          progress(3, 'completed', 'panels');
          push({ type: 'final', turn });
        },
        (error) => {
          failure = error;
        },
      )
      .finally(() => {
        finished = true;
        wake?.();
      });
    try {
      while (!finished || queue.length) {
        signal.throwIfAborted();
        if (queue.length) yield queue.shift()!;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
      if (failure) throw failure;
    } finally {
      signal.removeEventListener('abort', abort);
      // The producer has rejection handling even if this iterator is closed early.
      void work;
    }
  }
}
