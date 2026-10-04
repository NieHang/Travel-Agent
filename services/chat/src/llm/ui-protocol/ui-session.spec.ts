import { UIFlowService } from './ui-flow.service.js';
import { modelOutput } from './ui-test.fixtures.js';
import { toPublicMessageMetadata, readUIFlowSnapshot } from './ui-session.js';

describe('durable candidate UI turns', () => {
  it('prepares without committing and restores a selection after restart', async () => {
    const responses = {
      generateUIResponse: vi.fn(async () =>
        modelOutput(
          {
            message: 'Choose',
            intent: 'trip_planning',
            components: [
              { id: 'x', type: 'text', content: 'Choose', format: 'plain' },
            ],
          },
          { destination: 'Tokyo' },
          'update_requirements',
          'en',
        ),
      ),
    };
    const flow = new UIFlowService(responses as never);
    const first = await flow.prepareTurn(
      null,
      { content: 'Tokyo', locale: 'en' },
      [],
      new AbortController().signal,
    );
    const original = structuredClone(first.snapshot);
    const selection = first.response.components.find(
      (c) => c.type === 'selection',
    )!;
    const restored = new UIFlowService(responses as never);
    const second = await restored.prepareTurn(
      first.snapshot,
      {
        action: {
          type: 'selection',
          componentId: selection.id,
          values: ['solo'],
        },
        sourceMessageId: 'm',
        revision: 1,
      },
      [],
      new AbortController().signal,
    );
    expect(second.snapshot.context.requirements.tripType).toBe('solo');
    expect(first.snapshot).toEqual(original);
    expect(second.snapshot.revision).toBe(2);
    await expect(
      restored.prepareTurn(
        first.snapshot,
        {
          action: {
            type: 'selection',
            componentId: selection.id,
            values: ['solo'],
          },
          sourceMessageId: 'm',
          revision: 0,
        },
        [],
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it('filters private snapshots from public metadata and tolerates old messages', () => {
    expect(
      toPublicMessageMetadata({
        uiFlowSnapshot: { credentials: 'secret' },
        requirementError: true,
      }),
    ).toEqual({ requirementError: true });
    expect(readUIFlowSnapshot({ requirements: [] })).toBeNull();
  });
});
