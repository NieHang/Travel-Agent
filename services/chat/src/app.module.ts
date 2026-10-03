import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ConfigModule } from './config/config.module.js';
import { LlmModule } from './llm/llm.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    // 只提供限流的存储与默认额度，不注册全局 guard：只有挂了 AppThrottlerGuard 的路由才限流，
    // 具体额度由各方法上的 @Throttle 覆盖。计数在内存里，仅适用于单实例。
    ThrottlerModule.forRoot([{ limit: 60, ttl: 60_000 }]),
    AuthModule,
    UsersModule,
    LlmModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    // ObserveModule.forRoot({
    //   appKey: 'YOUR_APP_KEY',
    //   appSecret: 'YOUR_APP_SECRET',
    //   serviceId: 'chat',
    // }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 所有路由默认需要登录，只有标了 @Public() 的例外。
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(cookieParser()).forRoutes('{*splat}');
  }
}
