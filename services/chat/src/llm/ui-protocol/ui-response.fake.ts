import type { BaseMessage } from '@langchain/core/messages';
import type { UIFlowContext, UIModelOutput } from './ui-types.js';
import { UIResponseService } from './ui-response.service.js';
import { FAKE_REPLY_CHUNKS } from '../chat-reply/fakes.js';
import { modelOutput } from './ui-test.fixtures.js';

/** Deterministic non-production fixture for the existing LLM_FAKE test mode. */
export class FakeUIResponseService extends UIResponseService {
  override async generateUIResponse(
    input: string,
    _history: BaseMessage[] = [],
    context?: UIFlowContext,
  ): Promise<UIModelOutput> {
    const language = context?.preferredLocale ?? context?.replyLanguage ?? 'zh';
    const destination = input.includes('杭州')
      ? '杭州'
      : input.includes('里斯本')
        ? '里斯本'
        : null;
    if (destination)
      return modelOutput(
        {
          message: '',
          intent: 'trip_planning',
          components: [
            { id: 'routing', type: 'text', content: '', format: 'plain' },
          ],
        },
        { destination },
        'update_requirements',
        language,
      );
    return modelOutput(
      {
        message: FAKE_REPLY_CHUNKS.join(''),
        intent: 'general',
        components: [
          {
            id: 'answer',
            type: 'text',
            content: FAKE_REPLY_CHUNKS.join(''),
            format: 'plain',
          },
        ],
      },
      {},
      'answer',
      language,
    );
  }
  override async generateTripDays(context: UIFlowContext, signal: AbortSignal) {
    signal.throwIfAborted();
    return [
      {
        title: context.preferredLocale === 'en' ? 'Day 1' : '第 1 天',
        stops: [
          {
            name: String(context.requirements.destination),
            note: null,
            time: null,
          },
        ],
      },
    ];
  }
  override async *streamMarkdown(
    input: string,
    _history: BaseMessage[],
    context: UIFlowContext,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const chunks = input.includes('render_itinerary')
      ? [
          '# ',
          String(context.requirements.destination),
          context.preferredLocale === 'en'
            ? ' itinerary draft\n\n'
            : '行程草稿\n\n',
          '## ',
          context.preferredLocale === 'en' ? 'Day 1\n' : '第 1 天\n',
          String(context.requirements.destination),
        ]
      : FAKE_REPLY_CHUNKS;
    for (const chunk of chunks) {
      signal.throwIfAborted();
      await new Promise((r) => setTimeout(r, 20));
      yield chunk;
    }
  }
}
