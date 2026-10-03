import { config } from 'dotenv';

config({ path: new URL('../.env.test', import.meta.url), override: true, quiet: true });

const databaseUrl = process.env['DATABASE_URL'] ?? '';
const dbName = (() => {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    return '';
  }
})();

if (!dbName.endsWith('_test')) {
  throw new Error('Refusing to run: database name must end with _test');
}
