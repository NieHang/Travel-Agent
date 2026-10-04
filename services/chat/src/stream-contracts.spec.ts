import {
  StreamMessageSchema,
  SendMessageRequestSchema,
} from '@autix/contracts';

describe('UI streaming wire contracts', () => {
  const timestamp = '2026-10-04T10:00:00.000Z';
  it('accepts incremental and replacement text but rejects malformed envelopes', () => {
    for (const isChunk of [true, false]) {
      expect(
        StreamMessageSchema.safeParse({
          messageType: 'markdown',
          timestamp,
          payload: { messageId: 'm', content: '你好', isChunk },
        }).success,
      ).toBe(true);
    }
    expect(
      StreamMessageSchema.safeParse({
        messageType: 'ui',
        timestamp,
        payload: { messageId: 'm', components: [{ type: 'invented' }] },
      }).success,
    ).toBe(false);
    expect(
      StreamMessageSchema.safeParse({
        messageType: 'markdown',
        timestamp,
        payload: { content: 7, isChunk: true },
      }).success,
    ).toBe(false);
  });
  it('rejects progress exceeding the declared stages', () => {
    expect(
      StreamMessageSchema.safeParse({
        messageType: 'progress',
        timestamp,
        payload: {
          agent: 'understand',
          step: 5,
          totalSteps: 4,
          status: 'started',
          label: 'understanding',
        },
      }).success,
    ).toBe(false);
  });
  it('preserves text requests and makes action requests mutually exclusive', () => {
    expect(SendMessageRequestSchema.parse({ content: ' hi ' })).toEqual({
      content: 'hi',
    });
    const action = {
      action: { type: 'confirmation', componentId: 'c', confirmed: true },
      sourceMessageId: 'm',
      revision: 1,
    };
    expect(SendMessageRequestSchema.safeParse(action).success).toBe(true);
    expect(
      SendMessageRequestSchema.safeParse({ ...action, content: 'hi' }).success,
    ).toBe(false);
  });
});
