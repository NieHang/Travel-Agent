import 'reflect-metadata';
import { get } from 'node:http';
import {
  Controller,
  Get,
  Module,
  Post,
  Res,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { HumanMessage } from '@langchain/core/messages';
import { LlmMeteringHandler } from '../llm/cost/llm-metering.js';
import { httpDuration, registry } from './metrics.js';
import { getLlmTotals, getTraceId } from './trace-context.js';
import { TraceMiddleware } from './trace.middleware.js';

const accessInfo = vi.hoisted(() => vi.fn());
vi.mock('./logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./logger.js')>();
  return {
    ...actual,
    createLogger: () => ({ info: accessInfo, warn: vi.fn() }),
  };
});

@Controller('t')
class TraceController {
  @Get('metered')
  metered() {
    getLlmTotals()?.add({
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      costUsd: 0.01,
      usageSource: 'provider',
    });
    return { ok: true };
  }

  @Get('stream')
  stream(@Res() res: Response) {
    const handler = new LlmMeteringHandler();
    handler.handleChatModelStart(
      { lc: 1, type: 'not_implemented', id: ['test'] },
      [[new HumanMessage('a'.repeat(400))]],
      'stream-run',
    );
    // The controller aborts after the middleware's close listener has run.
    res.on('close', () => {
      setTimeout(
        () => handler.handleLLMError(new Error('AbortError'), 'stream-run'),
        10,
      );
    });
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: ready\n\n');
  }

  @Post(':id')
  post() {
    return { traceId: getTraceId() };
  }

  @Get(':id')
  async trace() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { traceId: getTraceId() };
  }
}

@Module({
  controllers: [TraceController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
class TraceTestModule {}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('TraceMiddleware', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TraceTestModule],
    }).compile();
    app = module.createNestApplication();
    const traceMiddleware = new TraceMiddleware();
    app.use(traceMiddleware.use.bind(traceMiddleware));
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
  });
  beforeEach(() => {
    registry.resetMetrics();
    accessInfo.mockClear();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('generates a UUID and preserves it through async handlers', async () => {
    const response = await request(server).get('/t/123').expect(200);
    expect(response.headers['x-trace-id']).toMatch(uuid);
    expect(response.body).toEqual({ traceId: response.headers['x-trace-id'] });
  });

  it('includes request totals in the access log after finish', async () => {
    await request(server).get('/t/metered').expect(200);
    expect(accessInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        llm: {
          calls: 1,
          inputTokens: 100,
          cachedInputTokens: 40,
          outputTokens: 20,
          costUsd: 0.01,
          estimated: false,
        },
      }),
      'request completed',
    );
  });

  it('omits the llm field when no model was called', async () => {
    await request(server).get('/t/123').expect(200);
    expect(accessInfo).toHaveBeenCalledTimes(1);
    expect(accessInfo.mock.calls[0][0]).not.toHaveProperty('llm');
  });

  it('reuses a valid incoming trace id', async () => {
    const response = await request(server)
      .get('/t/123')
      .set('x-trace-id', 'abc-123')
      .expect(200);
    expect(response.headers['x-trace-id']).toBe('abc-123');
    expect(response.body).toEqual({ traceId: 'abc-123' });
  });

  it.each(['x'.repeat(65), 'invalid value', ''])(
    'replaces invalid trace ids (%s)',
    async (value) => {
      const response = await request(server)
        .get('/t/123')
        .set('x-trace-id', value)
        .expect(200);
      expect(response.headers['x-trace-id']).toMatch(uuid);
    },
  );

  it('records exactly one duration with the route template', async () => {
    await request(server).get('/t/123?secret=hidden').expect(200);
    const metrics = await registry.getSingleMetricAsString(
      'http_request_duration_seconds',
    );
    expect(metrics).toContain(
      'http_request_duration_seconds_count{method="GET",route="/t/:id",status_code="200"} 1',
    );
    expect(metrics).not.toContain('route="/t/123"');
    expect(metrics).not.toContain('hidden');
  });

  it('sets the trace header for unmatched routes', async () => {
    const response = await request(server).get('/missing').expect(404);
    expect(response.headers['x-trace-id']).toMatch(uuid);
    expect(
      await registry.getSingleMetricAsString('http_request_duration_seconds'),
    ).toContain('route="unmatched",status_code="404"} 1');
  });

  it.each([
    { body: '{bad', status: 400 },
    { body: JSON.stringify({ pad: 'x'.repeat(200 * 1024) }), status: 413 },
  ])('traces body-parser failures ($status)', async ({ body, status }) => {
    const response = await request(server)
      .post('/t/123')
      .set('Content-Type', 'application/json')
      .set('x-trace-id', 'parser-error')
      .send(body)
      .expect(status);
    expect(response.headers['x-trace-id']).toBe('parser-error');
    expect(response.body).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
    });
    expect(
      await registry.getSingleMetricAsString('http_request_duration_seconds'),
    ).toContain(
      `http_request_duration_seconds_count{method="POST",route="unmatched",status_code="${status}"} 1`,
    );
  });

  it('records one duration when the client aborts an SSE response', async () => {
    const observation = vi.spyOn(httpDuration, 'observe');
    try {
      const url = await app.getUrl();
      await new Promise<void>((resolve, reject) => {
        const client = get(
          `${url}/t/stream`,
          { headers: { 'x-trace-id': 'aborted-trace' } },
          (response) => {
            expect(response.headers['x-trace-id']).toBe('aborted-trace');
            response.once('data', () => {
              response.destroy();
              resolve();
            });
          },
        );
        client.on('error', reject);
      });
      await vi.waitFor(() => expect(observation).toHaveBeenCalledTimes(1));
      expect(observation.mock.calls[0][0]).toEqual({
        method: 'GET',
        route: '/t/stream',
        status_code: '200',
      });
      expect(accessInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          aborted: true,
          llm: {
            calls: 1,
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 0,
            costUsd: 0.00025,
            estimated: true,
          },
        }),
        'request completed',
      );
    } finally {
      observation.mockRestore();
    }
  });
});
