import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RequirementService } from './requirement.service.js';

describe('RequirementService.extract abort against a local model API', () => {
  let server: Server;
  /** 每个到达的模型请求一条记录；`closedEarly` 在连接未等到响应就被关闭时置为 true。 */
  let requests: Array<{ closedEarly: boolean }>;
  let onRequest: () => void;
  let onClose: () => void;

  beforeAll(async () => {
    // 收下请求后永不响应：只有调用方主动取消，这次调用才会结束。
    server = createServer((req, res) => {
      const record = { closedEarly: false };
      requests.push(record);
      res.on('close', () => {
        record.closedEarly = !res.writableEnded;
        onClose();
      });
      req.resume();
      req.on('end', () => onRequest());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  beforeEach(() => {
    requests = [];
    onRequest = () => {};
    onClose = () => {};
    vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
    vi.stubEnv(
      'OPENAI_BASE_URL',
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    );
    vi.stubEnv('HTTPS_PROXY', '');
    vi.stubEnv('HTTP_PROXY', '');
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('中止信号会取消进行中的模型请求：调用被拒绝，服务端看到连接被关闭', async () => {
    const ac = new AbortController();
    const received = new Promise<void>((resolve) => (onRequest = resolve));
    const closed = new Promise<void>((resolve) => (onClose = resolve));

    const outcome = new RequirementService().extract('去里斯本 5 天', ac.signal).then(
      () => 'resolved',
      () => 'rejected',
    );
    await received;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.closedEarly).toBe(false);

    ac.abort();
    expect(await outcome).toBe('rejected');
    await closed;
    expect(requests[0]!.closedEarly).toBe(true);
    // 被取消的请求不会被重试。
    expect(requests).toHaveLength(1);
  }, 5_000);

  it('信号在调用前已中止：直接被拒绝，不发出模型请求', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(new RequirementService().extract('x', ac.signal)).rejects.toBeDefined();
    expect(requests).toHaveLength(0);
  }, 5_000);
});
