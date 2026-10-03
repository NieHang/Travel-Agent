import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, ObserveInstrument } from './app.module.js';
import { AUTH_CONFIG, type AuthConfig } from './config/auth.config.js';
import { corsOptions } from './config/cors.js';
import { applyTrustProxy } from './config/trust-proxy.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });
  applyTrustProxy(app, app.get<AuthConfig>(AUTH_CONFIG));
  app.enableCors(corsOptions());
  await app.listen(process.env.PORT ?? 4001);
}
await bootstrap();
