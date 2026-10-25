import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkills, parseSkill } from './registry.js';

const core = '---\nname: japan-travel\ndescription: Plan Japan trips\nalways: true\n---\n# Rules\n';

describe('parseSkill', () => {
  it('parses frontmatter and body', () => {
    expect(parseSkill(core)).toEqual({ name: 'japan-travel', description: 'Plan Japan trips', always: true, body: '# Rules\n' });
  });

  it('defaults always to false', () => {
    expect(parseSkill(core.replace('always: true\n', '')).always).toBe(false);
  });

  it('accepts CRLF line endings', () => {
    expect(parseSkill(core.replaceAll('\n', '\r\n')).name).toBe('japan-travel');
  });

  it('rejects a file without frontmatter or with an empty name', () => {
    expect(() => parseSkill('# no frontmatter')).toThrow();
    expect(() => parseSkill(core.replace('name: japan-travel', "name: ''"))).toThrow();
  });
});

describe('loadSkills', () => {
  const root = () => mkdtempSync(join(tmpdir(), 'skills-'));

  it('loads every valid skill and skips a malformed one', () => {
    const dir = root();
    for (const name of ['a', 'b', 'c']) mkdirSync(join(dir, name));
    writeFileSync(join(dir, 'a', 'SKILL.md'), '---\nname: a\ndescription: A\n---\nbody\n');
    writeFileSync(join(dir, 'b', 'SKILL.md'), 'garbage');
    expect(loadSkills(dir).map((s) => s.name)).toEqual(['a']);
  });

  it('returns no skills when the root does not exist', () => {
    expect(loadSkills(join(root(), 'missing'))).toEqual([]);
  });
});
