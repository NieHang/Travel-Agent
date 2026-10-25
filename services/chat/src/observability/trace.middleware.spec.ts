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
import { httpDuration, registry } from './metrics.js';
import { getTraceId } from './trace-context.js';
import { TraceMiddleware } from './trace.middleware.js';

@Controller('t')
class TraceController {
  @Get('stream')
  stream(@Res() res: Response) {
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
  beforeEach(() => registry.resetMetrics());
  afterAll(async () => {
    await app?.close();
  });

  it('generates a UUID and preserves it through async handlers', async () => {
    const response = await request(server).get('/t/123').expect(200);
    expect(response.headers['x-trace-id']).toMatch(uuid);
    expect(response.body).toEqual({ traceId: response.headers['x-trace-id'] });
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
    } finally {
      observation.mockRestore();
    }
  });
});
