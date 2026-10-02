import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('business filesystem tools', () => {
  let directory: string;
  let root: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'business-tools-'));
    root = join(directory, 'workspace');
    await mkdir(join(root, 'requirements'), { recursive: true });
    await writeFile(
      join(root, 'requirements/REQ-2026-001.json'),
      '{"id":"REQ-2026-001"}',
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('queries requirements, reads standards, and creates nested reports', async () => {
    const { createBusinessTools } = await import('./business.tools.js');
    const [query, read, write] = createBusinessTools(root);
    expect(
      JSON.parse(await query.invoke({ requirementId: 'REQ-2026-001' })),
    ).toEqual({ id: 'REQ-2026-001' });
    await mkdir(join(root, 'standards'));
    await writeFile(join(root, 'standards/requirement-spec.md'), '# 需求规范');
    expect(await read.invoke({ path: 'standards/requirement-spec.md' })).toBe(
      '# 需求规范',
    );
    await write.invoke({
      path: 'reports/REQ-2026-001-analysis.md',
      content: '# 分析结论',
    });
    expect(
      await readFile(join(root, 'reports/REQ-2026-001-analysis.md'), 'utf8'),
    ).toBe('# 分析结论');
  });

  it.each([
    '../outside.txt',
    '..\\outside.txt',
    '/etc/passwd',
    'C:\\secret.txt',
    'C:secret.txt',
    '\\\\server\\share',
    'workspace/secret.txt',
    'reports/../../secret.txt',
    'file.txt:stream',
    '',
    '.',
    'reports/../file.txt',
  ])('rejects unsafe path %s for both reads and writes', async (path) => {
    const { createBusinessTools } = await import('./business.tools.js');
    const [, read, write] = createBusinessTools(root);
    await expect(read.invoke({ path })).rejects.toThrow();
    await expect(write.invoke({ path, content: 'escape' })).rejects.toThrow();
  });

  it('rejects requirement traversal, malformed arguments, and missing files', async () => {
    const { createBusinessTools } = await import('./business.tools.js');
    const [query, read, write] = createBusinessTools(root);
    await expect(
      query.invoke({ requirementId: '../outside' }),
    ).rejects.toThrow();
    await expect(query.invoke({ requirementId: 'missing' })).rejects.toThrow();
    await expect(
      read.invoke({ path: 42 } as unknown as { path: string }),
    ).rejects.toThrow();
    await expect(
      write.invoke({ path: 'report.md', content: 42 } as unknown as {
        path: string;
        content: string;
      }),
    ).rejects.toThrow();
    await expect(read.invoke({ path: 'missing.md' })).rejects.toThrow();
  });

  it('rejects symlink/junction parents, including writes to nonexistent children', async () => {
    const { createBusinessTools } = await import('./business.tools.js');
    await mkdir(join(directory, 'outside'));
    await writeFile(join(directory, 'outside/secret.md'), 'secret');
    await symlink(
      join(directory, 'outside'),
      join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const [, read, write] = createBusinessTools(root);
    await expect(read.invoke({ path: 'linked/secret.md' })).rejects.toThrow();
    await expect(
      write.invoke({ path: 'linked/new/report.md', content: 'escape' }),
    ).rejects.toThrow();
    expect(await readFile(join(directory, 'outside/secret.md'), 'utf8')).toBe(
      'secret',
    );
  });
});
