import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppException } from './app.exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('t')
class TestController {
  @Post('body')
  body(@Body(new ZodValidationPipe(z.object({ n: z.number() }))) b: unknown) {
    return b;
  }
  @Get('app')
  app() {
    throw new AppException('EMAIL_TAKEN', 409);
  }
  @Get('boom')
  boom() {
    throw new Error('secret detail');
  }
  @Get('nest')
  nest() {
    throw new BadRequestException('x');
  }
  @Get('limited')
  limited() {
    throw new HttpException('slow down', 429);
  }
}

describe('common http', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TestController],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('校验失败', async () => {
    const res = await request(server)
      .post('/t/body')
      .send({ n: 'x' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.fieldErrors.n).toEqual(expect.any(Array));
  });

  it('校验通过原样返回', async () => {
    const res = await request(server).post('/t/body').send({ n: 1 });
    expect(res.body).toEqual({ n: 1 });
  });

  it('业务异常', () =>
    request(server)
      .get('/t/app')
      .expect(409)
      .expect((r) => {
        expect(r.body.code).toBe('EMAIL_TAKEN');
        expect(r.body.message).toBe('EMAIL_TAKEN');
      }));

  it('未知异常不泄露细节', async () => {
    const spy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      const res = await request(server).get('/t/boom').expect(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('secret detail');
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = spy.mock.calls[0];
      expect(logged[0]).toEqual(
        expect.objectContaining({ message: 'secret detail' }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('Nest 400 与非 JSON 请求体都是 VALIDATION_FAILED', async () => {
    await request(server)
      .get('/t/nest')
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('VALIDATION_FAILED'));
    await request(server)
      .post('/t/body')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('VALIDATION_FAILED'));
  });

  it('429 是 RATE_LIMITED', () =>
    request(server)
      .get('/t/limited')
      .expect(429)
      .expect((r) => expect(r.body.code).toBe('RATE_LIMITED')));

  it('未知路由是 NOT_FOUND', () =>
    request(server)
      .get('/nope')
      .expect(404)
      .expect((r) => expect(r.body.code).toBe('NOT_FOUND')));

  it('超出解析上限的请求体是 413 VALIDATION_FAILED，不记错误日志', async () => {
    const spy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      const res = await request(server)
        .post('/t/body')
        .send({ n: 1, pad: 'x'.repeat(200 * 1024) })
        .expect(413);
      expect(res.body).toEqual({
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
