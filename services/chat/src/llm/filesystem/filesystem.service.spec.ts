import 'reflect-metadata';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { Test } from '@nestjs/testing';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  bindTools: vi.fn(),
  query: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock('../model.factory.js', () => ({
  createChatModel: () => ({ bindTools: mocks.bindTools }),
}));
vi.mock('../tools/business.tools.js', () => ({
  businessTools: [
    { name: 'query_requirement', invoke: mocks.query },
    { name: 'read_file', invoke: mocks.read },
    { name: 'write_file', invoke: mocks.write },
  ],
}));

const call = (
  name = 'query_requirement',
  args: Record<string, unknown> = { requirementId: 'REQ-2026-001' },
  id = 'call-1',
) =>
  new AIMessage({
    content: '',
    tool_calls: [{ name, args, id, type: 'tool_call' }],
  });

describe('filesystem tool loop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.bindTools.mockReturnValue({ invoke: mocks.invoke });
    mocks.query.mockResolvedValue('{"id":"REQ-2026-001"}');
    mocks.read.mockResolvedValue('# 规范');
    mocks.write.mockResolvedValue('{"written":true}');
  });

  it('feeds each tool result back with matching IDs over query/read/write rounds', async () => {
    const { FilesystemService } = await import('./filesystem.service.js');
    const seen: unknown[][] = [];
    const replies = [
      call(),
      call('read_file', { path: 'standards/requirement-spec.md' }, 'call-2'),
      call(
        'write_file',
        { path: 'reports/REQ-2026-001-analysis.md', content: '# 结论' },
        'call-3',
      ),
      new AIMessage('报告已写入'),
    ];
    mocks.invoke.mockImplementation(async (messages: unknown[]) => {
      seen.push([...messages]);
      return replies.shift();
    });
    expect(
      await new FilesystemService().chat(
        '查询需求单 REQ-2026-001 并写入分析结论',
      ),
    ).toEqual({ content: '报告已写入' });
    expect(
      mocks.bindTools.mock.calls[0][0].map(
        (entry: { name: string }) => entry.name,
      ),
    ).toEqual(['query_requirement', 'read_file', 'write_file']);
    const results = seen[3].filter(
      (message) => message instanceof ToolMessage,
    ) as ToolMessage[];
    expect(results.map((message) => message.tool_call_id)).toEqual([
      'call-1',
      'call-2',
      'call-3',
    ]);
    expect(results[0].content).toBe('{"id":"REQ-2026-001"}');
    expect(mocks.write).toHaveBeenCalledWith({
      path: 'reports/REQ-2026-001-analysis.md',
      content: '# 结论',
    });
  });

  it.each(['unknown_tool', 'read_file'])(
    'returns %s execution errors to the model',
    async (name) => {
      const { FilesystemService } = await import('./filesystem.service.js');
      mocks.read.mockRejectedValue(new Error('Path outside workspace'));
      mocks.invoke
        .mockResolvedValueOnce(call(name))
        .mockResolvedValueOnce(new AIMessage('无法读取'));
      expect(await new FilesystemService().chat('读取文件')).toEqual({
        content: '无法读取',
      });
      const result = mocks.invoke.mock.calls[1][0].at(-1);
      expect(result).toBeInstanceOf(ToolMessage);
      expect(result.status).toBe('error');
      expect(JSON.parse(result.content).error).toEqual(expect.any(String));
    },
  );

  it('executes all calls in one response in order', async () => {
    const { FilesystemService } = await import('./filesystem.service.js');
    const first = call();
    first.tool_calls!.push({
      name: 'read_file',
      args: { path: 'standard.md' },
      id: 'call-2',
      type: 'tool_call',
    });
    mocks.invoke
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(new AIMessage('完成'));
    await new FilesystemService().chat('分析');
    expect(
      mocks.invoke.mock.calls[1][0].filter(
        (message: unknown) => message instanceof ToolMessage,
      ),
    ).toHaveLength(2);
  });

  it('stops after five tool rounds and permits a final response', async () => {
    const { FilesystemService } = await import('./filesystem.service.js');
    mocks.invoke.mockResolvedValue(call());
    await expect(new FilesystemService().chat('分析')).rejects.toThrow(
      'maximum rounds',
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(6);
    expect(mocks.query).toHaveBeenCalledTimes(5);
  });

  it.each([
    new AIMessage({
      content: '',
      response_metadata: { finish_reason: 'length' },
      invalid_tool_calls: [
        { name: 'write_file', args: '{"content":"报告', error: 'invalid JSON' },
      ],
    }),
    new AIMessage({
      content: '未完成的分析',
      response_metadata: { finish_reason: 'length' },
    }),
    new AIMessage({
      content: '',
      response_metadata: { finish_reason: 'length' },
      tool_calls: [
        {
          name: 'write_file',
          args: { path: 'reports/test.md', content: '未完成的分析' },
          id: 'call-truncated',
          type: 'tool_call',
        },
      ],
    }),
  ])(
    'rejects truncated output with an actionable error before writing',
    async (reply) => {
      const { FilesystemService } = await import('./filesystem.service.js');
      mocks.invoke.mockResolvedValue(reply);
      await expect(new FilesystemService().chat('分析')).rejects.toThrow(
        'Model output was truncated; increase llm.maxTokens in config/langchain.yaml or request a shorter report',
      );
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each([
    new AIMessage({
      content: '',
      invalid_tool_calls: [
        { name: 'read_file', args: '{', error: 'invalid JSON' },
      ],
    }),
    call('read_file', {}, ''),
  ])('rejects invalid calls before executing tools', async (reply) => {
    const { FilesystemService } = await import('./filesystem.service.js');
    mocks.invoke.mockResolvedValue(reply);
    await expect(new FilesystemService().chat('分析')).rejects.toThrow();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('registers POST /api/files/chat and rejects invalid input before model invocation', async () => {
    const { LlmModule } = await import('../llm.module.js');
    const module = await Test.createTestingModule({
      imports: [LlmModule],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      for (const body of [{}, { input: 42 }, { input: '  ' }]) {
        await request(app.getHttpServer())
          .post('/api/files/chat')
          .send(body)
          .expect(400);
      }
      expect(mocks.invoke).not.toHaveBeenCalled();
      mocks.invoke.mockResolvedValue(new AIMessage('需求详情'));
      await request(app.getHttpServer())
        .post('/api/files/chat')
        .send({ input: '查询需求单 REQ-2026-001 的详情' })
        .expect(201)
        .expect({ content: '需求详情' });
    } finally {
      await app.close();
    }
  });
});
