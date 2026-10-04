import { UIStreamService } from './ui-stream.service.js';
describe('UI stream coordinator', () => {
  it('yields text before completion and keeps components batched', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => {
      finish = r;
    });
    const turn = {
      response: {
        intent: 'general',
        message: 'Hello',
        components: [
          { id: 'a', type: 'text', content: 'Hello', format: 'plain' },
        ],
      },
      snapshot: { revision: 1 },
    };
    const flow = {
      prepareTurn: vi.fn(async (_s, _r, _h, _signal, onChunk) => {
        onChunk('Hel');
        await gate;
        onChunk('lo');
        return turn;
      }),
    };
    const stream = new UIStreamService(flow as never).streamTurn(
      null,
      { content: 'hi' },
      [],
      new AbortController().signal,
    );
    expect((await stream.next()).value.type).toBe('progress');
    let token = await stream.next();
    while (token.value.type === 'progress') token = await stream.next();
    expect(token.value).toEqual({ type: 'markdown', content: 'Hel' });
    finish();
    const rest = [];
    for await (const event of stream) rest.push(event);
    expect(rest.find((e) => e.type === 'final')?.turn).toEqual(turn);
  });
  it('ends promptly on abort even when the producer never resolves', async () => {
    const flow = { prepareTurn: () => new Promise(() => {}) };
    const controller = new AbortController();
    const stream = new UIStreamService(flow as never).streamTurn(
      null,
      { content: 'hi' },
      [],
      controller.signal,
    );
    await stream.next();
    controller.abort();
    await expect(stream.next()).rejects.toThrow();
  });
});
