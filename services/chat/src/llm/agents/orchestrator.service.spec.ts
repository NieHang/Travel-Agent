import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import request from 'supertest';

const state = vi.hoisted(() => ({
  replies: {} as Record<string, string | Error>,
  calls: [] as Array<{ agent: string; context: string }>,
  parallel: false,
  release: undefined as (() => void) | undefined,
}));
vi.mock('../model.factory.js', () => ({
  createChatModel: () =>
    RunnableLambda.from(async (prompt: { toString(): string }) => {
      const context = prompt.toString();
      const agent = /AGENT:(\w+)/.exec(context)?.[1] ?? '';
      state.calls.push({ agent, context });
      if (state.parallel && agent === 'analysis') {
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      }
      if (state.parallel && agent === 'risk') state.release?.();
      const reply = state.replies[agent];
      if (reply instanceof Error) throw reply;
      return new AIMessage(reply ?? '');
    }),
}));

import { LlmModule } from '../llm.module.js';

const input =
  '开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文';
describe('fixed requirement orchestration HTTP', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [LlmModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    state.calls = [];
    state.parallel = false;
    state.release = undefined;
    state.replies = {
      extract: JSON.stringify({
        goal: '会话记忆系统',
        users: ['需求分析师'],
        features: ['多轮澄清', '自动裁剪上下文'],
        constraints: [],
        unknowns: [],
      }),
      clarify: JSON.stringify({
        needsClarification: false,
        clarificationQuestions: [],
      }),
      analysis: '功能分解：记忆、澄清、裁剪；验收：保留关键需求',
      risk: '风险：裁剪丢失约束；建议：摘要与回归验证',
      summary: '# 需求分析报告\n支持会话记忆、多轮澄清和自动裁剪。',
    };
  });
  const run = () =>
    request(app.getHttpServer())
      .post('/api/agents/orchestrate')
      .send({ input });

  it('runs analysis and risk concurrently and passes their results to the final report', async () => {
    state.parallel = true;
    const { body } = await run().expect(201);
    expect(body).toMatchObject({
      mode: 'fixed',
      status: 'completed',
      clarificationQuestions: [],
      fallback: null,
      usedAgents: [
        'extractAgent',
        'clarifyAgent',
        'analysisAgent',
        'riskAgent',
        'summaryAgent',
      ],
      report: state.replies.summary,
    });
    expect(body.steps.map((step: { status: string }) => step.status)).toEqual(
      Array(5).fill('completed'),
    );
    expect(state.calls.map(({ agent }) => agent)).toEqual([
      'extract',
      'clarify',
      'analysis',
      'risk',
      'summary',
    ]);
    expect(state.calls[0].context).toContain(input);
    expect(state.calls[1].context).toContain('会话记忆系统');
    expect(state.calls[4].context).toContain(state.replies.analysis);
    expect(state.calls[4].context).toContain(state.replies.risk);
  });

  it('stops after clarification and returns questions without a report', async () => {
    state.replies.clarify = JSON.stringify({
      needsClarification: true,
      clarificationQuestions: ['上下文裁剪的 token 上限是多少？'],
    });
    const { body } = await run().expect(201);
    expect(body).toMatchObject({
      status: 'needs_clarification',
      clarificationQuestions: ['上下文裁剪的 token 上限是多少？'],
      usedAgents: ['extractAgent', 'clarifyAgent'],
      fallback: null,
      report: null,
    });
    expect(state.calls.map(({ agent }) => agent)).toEqual([
      'extract',
      'clarify',
    ]);
  });

  it.each([
    ['extract', 'not JSON'],
    ['extract', '{}'],
    ['clarify', '{"needsClarification":"false","clarificationQuestions":[]}'],
    ['clarify', '{"needsClarification":true,"clarificationQuestions":[]}'],
    [
      'clarify',
      '{"needsClarification":false,"clarificationQuestions":["问题"]}',
    ],
    ['analysis', new Error('model failed')],
    ['risk', ''],
    ['summary', new Error('model failed')],
  ])(
    'falls back to manual review for invalid or failed %s output',
    async (agent, reply) => {
      state.replies[agent] = reply;
      const { body } = await run().expect(201);
      expect(body).toMatchObject({
        status: 'failed',
        fallback: 'manual_review',
        report: null,
      });
      expect(body.steps).toContainEqual(
        expect.objectContaining({ agent: `${agent}Agent`, status: 'failed' }),
      );
      if (agent !== 'summary')
        expect(state.calls.some((call) => call.agent === 'summary')).toBe(
          false,
        );
    },
  );

  it.each([
    {},
    { input: '' },
    { input: '   ' },
    { input: 42 },
    { input: null },
  ])('rejects invalid input before invoking agents: %j', async (body) => {
    await request(app.getHttpServer())
      .post('/api/agents/orchestrate')
      .send(body)
      .expect(400);
    expect(state.calls).toHaveLength(0);
  });
});
