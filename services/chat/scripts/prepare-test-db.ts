import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: new URL('../.env.test', import.meta.url), override: true, quiet: true });

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required in .env.test');
}

const target = new URL(databaseUrl);
const dbName = decodeURIComponent(target.pathname.slice(1));
if (!dbName.endsWith('_test')) {
  throw new Error('Refusing to run: database name must end with _test');
}

const admin = new URL(databaseUrl);
admin.pathname = '/postgres';
admin.search = '';

const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) {
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`Created database ${dbName}`);
  }
} finally {
  await client.end();
}

const result = spawnSync('bunx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: databaseUrl },
});
process.exit(result.status ?? 1);
