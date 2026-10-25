import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSkills, SKILLS_ROOT, type Skill } from './registry.js';

const skills = loadSkills();
const byName = new Map(skills.map((s) => [s.name, s]));
const core = () => byName.get('japan-travel') as Skill;
const cities: [string, string, string][] = [
  ['japan-tokyo', 'Tokyo', '东京'],
  ['japan-kyoto', 'Kyoto', '京都'],
  ['japan-osaka', 'Osaka', '大阪'],
  ['japan-nara', 'Nara', '奈良'],
];

describe('shipped Japan skills', () => {
  it('ships the core and city skills', () => {
    expect([...byName.keys()]).toEqual(expect.arrayContaining(['japan-travel', ...cities.map(([name]) => name)]));
  });

  it('only the core skill is always loaded', () => {
    expect(core().always).toBe(true);
    for (const [name] of cities) expect(byName.get(name)?.always).toBe(false);
  });

  it('names match their folders', () => {
    const folders = readdirSync(fileURLToPath(SKILLS_ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(skills.map((s) => s.name).sort()).toEqual(folders.sort());
  });

  it.each(cities)('%s describes the city in English and Chinese', (name, en, zh) => {
    expect(byName.get(name)?.description).toContain(en);
    expect(byName.get(name)?.description).toContain(zh);
  });

  it('stays within the prompt budget', () => {
    expect(core().body.length).toBeLessThanOrEqual(9000);
    for (const [name] of cities) expect(byName.get(name)?.body.length).toBeLessThanOrEqual(4500);
  });

  it('does not mention the placeholder scripts', () => {
    for (const skill of skills) expect(skill.body).not.toContain('.py');
  });

  it('uses the fixed section headings', () => {
    for (const heading of ['总览', '出发前要办', 'Overview', 'Before you go']) expect(core().body).toContain(heading);
  });
});
