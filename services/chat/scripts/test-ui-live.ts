import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { UIProtocolModule } from '../src/llm/ui-protocol/ui-protocol.module.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';
import { AccessTokenService } from '../src/auth/access-token.service.js';
import { AUTH_CONFIG, loadAuthConfig } from '../src/config/auth.config.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { createChatModel } from '../src/llm/model.factory.js';
import { uiModelJsonSchema } from '../src/llm/ui-protocol/ui-model.schema.js';
import {
  UI_SYSTEM_PROMPT,
  validateUIModelOutput,
} from '../src/llm/ui-protocol/ui-response.service.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// Run from services/chat: bun --env-file=.env run scripts/test-ui-live.ts
// The ephemeral subject is scoped to in-memory UI sessions; no account is created.
if (process.argv.includes('--diagnose')) {
  try {
    const context = {
      stage: 'idle' as const,
      requirements: {},
      itinerary: null,
      query: null,
      preferredLocale: 'en',
      replyLanguage: 'en',
    };
    const output = await createChatModel()
      .withStructuredOutput(uiModelJsonSchema, {
        method: 'functionCalling',
        strict: true,
      })
      .invoke([
        new SystemMessage(UI_SYSTEM_PROMPT),
        new HumanMessage(JSON.stringify({ serverContext: context })),
        new HumanMessage('Plan a five-day travel itinerary in Tokyo.'),
      ]);
    console.log(JSON.stringify({ modelCallSucceeded: true, output }));
    validateUIModelOutput(output, context);
    console.log(JSON.stringify({ validationSucceeded: true }));
  } catch (error: any) {
    let message = String(error.message ?? error);
    for (const key of ['OPENAI_API_KEY', 'JWT_ACCESS_SECRET', 'DATABASE_URL']) {
      const secret = process.env[key];
      if (secret) message = message.split(secret).join('[redacted]');
    }
    console.log(
      JSON.stringify({
        diagnosticError: error.name,
        status: error.status,
        type: error.type,
        code: error.code,
        message: message.slice(0, 2500),
      }),
    );
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
let base = process.env.UI_TEST_BASE_URL ?? 'http://127.0.0.1:4001';
let app: INestApplication | undefined;
if (process.argv.includes('--isolated')) {
  const module = await Test.createTestingModule({
    imports: [UIProtocolModule],
    providers: [
      { provide: AUTH_CONFIG, useValue: loadAuthConfig() },
      AccessTokenService,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
    ],
  }).compile();
  app = module.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  console.log(
    JSON.stringify({
      source:
        'current UIProtocolModule with real JwtAuthGuard and configured model',
      base,
    }),
  );
}
if (!process.env.JWT_ACCESS_SECRET)
  throw new Error('JWT_ACCESS_SECRET is required');
const token = await new JwtService({
  secret: process.env.JWT_ACCESS_SECRET,
}).signAsync(
  { sub: `ui-live-test-${randomUUID()}` },
  { algorithm: 'HS256', expiresIn: '15m' },
);
const reportPath = resolve(
  '../../docs/superpowers/reports/2026-10-04-ui-protocol-live-test.json',
);
const report = {
  startedAt: new Date().toISOString(),
  base,
  mode: 'live HTTP and configured model',
  tests: [] as Record<string, unknown>[],
};
function persist() {
  mkdirSync(resolve('../../docs/superpowers/reports'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
async function request(
  name: string,
  route: string,
  payload: Record<string, unknown>,
  verify: (response: any) => void,
) {
  const start = performance.now();
  let status: number | undefined;
  let response: unknown;
  try {
    const result = await fetch(`${base}/api/ui-chat/${route}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    status = result.status;
    response = await result.json();
    if (!result.ok) throw new Error(`HTTP ${status}`);
    verify(response);
    const durationMs = Math.round(performance.now() - start);
    report.tests.push({
      name,
      status,
      durationMs,
      passed: true,
      request: payload,
      response,
    });
    persist();
    console.log(
      JSON.stringify({
        name,
        status,
        durationMs,
        passed: true,
        intent: (response as any).intent,
        components: (response as any).components.map((c: any) => c.type),
      }),
    );
    return response as any;
  } catch (error) {
    const entry = {
      name,
      status,
      durationMs: Math.round(performance.now() - start),
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      request: payload,
      response,
    };
    report.tests.push(entry);
    persist();
    console.log(JSON.stringify(entry));
    return null;
  }
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function component(response: any, type: string) {
  const value = response.components.find((c: any) => c.type === type);
  check(value, `Missing ${type}`);
  return value;
}

for (const locale of ['zh', 'en']) {
  const sessionId = `live-trip-${locale}-${randomUUID()}`;
  const start = await request(
    `${locale}: start planning`,
    'chat',
    {
      sessionId,
      locale,
      input:
        locale === 'zh'
          ? '帮我规划东京五天旅游路线。'
          : 'Plan a five-day travel itinerary in Tokyo.',
    },
    (r) => {
      check(r.intent === 'trip_planning', 'Expected trip_planning');
      check(
        component(r, 'selection').purpose === 'trip_type',
        'Expected trip_type selection',
      );
    },
  );
  if (start) {
    const selection = component(start, 'selection');
    const requirements = await request(
      `${locale}: select solo`,
      'action',
      {
        sessionId,
        action: {
          type: 'selection',
          componentId: selection.id,
          values: ['solo'],
        },
      },
      (r) => {
        const form = component(r, 'form');
        check(
          !form.fields.some((f: any) => f.name === 'budgetCurrency'),
          'Currency must not be required',
        );
      },
    );
    if (requirements) {
      const form = component(requirements, 'form');
      const fieldValues: Record<string, string | number> = {
        destination: locale === 'zh' ? '东京' : 'Tokyo',
        departureDate: '2026-11-01',
        returnDate: '2026-11-05',
        travelers: 1,
        budget: 5000,
        preferences:
          locale === 'zh'
            ? '美食和博物馆，行程不要太赶'
            : 'Food and museums, with a relaxed pace',
      };
      const values = form.fields
        .filter((f: any) => Object.hasOwn(fieldValues, f.name))
        .map((f: any) => ({ name: f.name, value: fieldValues[f.name] }));
      const draft = await request(
        `${locale}: submit requirements without currency`,
        'action',
        {
          sessionId,
          action: { type: 'form_submit', componentId: form.id, values },
        },
        (r) => {
          check(
            component(r, 'card').category === 'itinerary',
            'Expected itinerary draft',
          );
          component(r, 'steps');
        },
      );
      if (draft) {
        const summary = component(draft, 'card').description;
        const pending = await request(
          `${locale}: request confirmation`,
          'chat',
          {
            sessionId,
            input:
              locale === 'zh' ? '确认这份旅游路线' : 'Confirm this itinerary',
          },
          (r) => {
            check(
              component(r, 'confirmation').summary === summary,
              'Confirmation must preserve the exact draft',
            );
            component(r, 'steps');
          },
        );
        if (pending)
          await request(
            `${locale}: confirm itinerary`,
            'action',
            {
              sessionId,
              action: {
                type: 'confirmation',
                componentId: component(pending, 'confirmation').id,
                confirmed: true,
              },
            },
            (r) => {
              check(
                component(r, 'steps').items.every(
                  (i: any) => i.status === 'completed',
                ),
                'All planning steps must be completed',
              );
              check(
                component(r, 'card').description === summary,
                'Confirmed draft must remain unchanged',
              );
            },
          );
      }
    }
  }
  await request(
    `${locale}: independent hotel query`,
    'chat',
    {
      sessionId: `live-hotels-${locale}-${randomUUID()}`,
      locale,
      input:
        locale === 'zh'
          ? '帮我找杭州西湖附近500米以内的酒店，预算800，不查实时价格。'
          : 'Find hotels within 500 meters of West Lake in Hangzhou, budget 800. I am not requesting live prices.',
    },
    (r) => {
      check(r.intent === 'hotel_search', 'Expected hotel_search');
      check(
        !r.components.some(
          (c: any) => c.type === 'selection' && c.purpose === 'trip_type',
        ),
        'Hotel query must not start planning wizard',
      );
      check(
        !r.components.some(
          (c: any) => c.type === 'card' && c.sourceStatus === 'verified',
        ),
        'No verified provider results exist',
      );
      check(
        r.components
          .filter((c: any) => c.type === 'table')
          .every((c: any) => c.rows.length === 0),
        'No provider: table must not fabricate hotel rows',
      );
    },
  );
}
persist();
console.log(
  JSON.stringify({
    reportPath,
    passed: report.tests.filter((t) => t.passed).length,
    failed: report.tests.filter((t) => !t.passed).length,
    executed: report.tests.length,
  }),
);
if (app) await app.close();
if (report.tests.some((t) => !t.passed)) process.exitCode = 1;
