import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env.eval', import.meta.url)), override: true });
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

try {
  const { LangfuseClient } = await import('@langfuse/client');
  const { readDataset, SuiteSchema } = await import('./schemas.js');
  const { syncDataset } = await import('./sync-dataset.js');
  if (process.argv.length !== 3) throw new Error('Usage: eval:sync <suite>');
  const suite = SuiteSchema.parse(process.argv[2]);
  const { requireLangfuse } = await import('./langfuse-health.js');
  await requireLangfuse();
  const entries = await readDataset(suite);
  const client = new LangfuseClient();
  try {
    console.log(await syncDataset(client, suite, entries));
  } finally {
    await client.flush();
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
