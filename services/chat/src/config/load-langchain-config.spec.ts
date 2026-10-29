import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLangChainConfig } from './load-langchain-config.js';

vi.unmock('./load-langchain-config.js');

const root = fileURLToPath(new URL('../../', import.meta.url));
const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function override(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'langchain-config-'));
  dirs.push(dir);
  const path = join(dir, 'variant.yaml');
  writeFileSync(path, contents);
  const name = relative(root, path);
  vi.stubEnv('LANGCHAIN_CONFIG', name);
  return name;
}

it('reads the default config without an override', () => {
  vi.stubEnv('LANGCHAIN_CONFIG', '');
  expect(loadLangChainConfig().llm.model).toBe('deepseek-flash');
});

it('reads an override relative to services/chat', () => {
  override('llm:\n  model: replay-model\n  temperature: 0\n  thinking: false\n');
  expect(loadLangChainConfig().llm).toEqual({ model: 'replay-model', temperature: 0, thinking: false });
});

it.each([
  'model: ""',
  'model: test\n  temperature: invalid',
  'model: test\n  maxTokens: 0',
  'model: test\n  compactModel: ""',
  'model: test\n  thinking: invalid',
])('names an invalid override in its validation error: %s', (parameters) => {
  const name = override(`llm:\n  ${parameters.includes('temperature:') ? '' : 'temperature: 0\n  '}${parameters}\n`);
  expect(() => loadLangChainConfig()).toThrow(`Invalid llm parameters in ${name}`);
});
