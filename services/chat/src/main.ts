import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, ObserveInstrument } from './app.module.js';
import { AUTH_CONFIG, type AuthConfig } from './config/auth.config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });
  if (app.get<AuthConfig>(AUTH_CONFIG).trustProxy) {
    app.set('trust proxy', true);
  }
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3002',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 4001);
}
await bootstrap();
