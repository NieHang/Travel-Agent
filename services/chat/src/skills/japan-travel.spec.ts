import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSkills, SKILLS_ROOT, type Skill } from './registry.js';

const skills = loadSkills();
const byName = new Map(skills.map((s) => [s.name, s]));
const core = () => byName.get('japan-travel') as Skill;

describe('shipped Japan skills', () => {
  it('ships the core skill', () => {
    expect([...byName.keys()]).toContain('japan-travel');
  });

  it('names match their folders', () => {
    const folders = readdirSync(fileURLToPath(SKILLS_ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(skills.map((s) => s.name).sort()).toEqual(folders.sort());
  });

  it('stays within the prompt budget', () => {
    expect(core().body.length).toBeLessThanOrEqual(9000);
  });

  it('does not mention the placeholder scripts', () => {
    for (const skill of skills) expect(skill.body).not.toContain('.py');
  });

  it('uses the fixed section headings', () => {
    for (const heading of ['总览', '出发前要办', 'Overview', 'Before you go']) expect(core().body).toContain(heading);
  });
});
