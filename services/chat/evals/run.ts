import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Bun preloads .env; match the spike's eval-specific precedence and OTel import order.
config({ path: fileURLToPath(new URL('../.env.eval', import.meta.url)), override: true });
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
const { shutdown } = await import('./instrumentation.js');

try {
  const { requireLangfuse } = await import('./langfuse-health.js');
  await requireLangfuse();
  const { run } = await import('./runner.js');
  await run(process.argv.slice(2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await shutdown();
}
