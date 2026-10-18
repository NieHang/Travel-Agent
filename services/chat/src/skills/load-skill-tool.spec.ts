import { loadSkillTool } from './load-skill-tool.js';
import type { Skill } from './registry.js';

const skills: Skill[] = [
  { name: 'japan-tokyo', description: 'Tokyo', always: false, body: 'TOKYO-NOTES' },
  { name: 'japan-osaka', description: 'Osaka', always: false, body: 'OSAKA-NOTES' },
];

describe('loadSkillTool', () => {
  it('returns the requested bodies', async () => {
    const output = String(await loadSkillTool(skills).invoke({ names: ['japan-tokyo', 'japan-osaka'] }));
    expect(output).toContain('TOKYO-NOTES');
    expect(output.indexOf('TOKYO-NOTES')).toBeLessThan(output.indexOf('OSAKA-NOTES'));
  });

  it('names the available skills for an unknown name', async () => {
    const output = String(await loadSkillTool(skills).invoke({ names: ['japan-tokyo', 'x'] }));
    expect(output).toContain('TOKYO-NOTES');
    expect(output).toContain('Unknown skill "x"');
    expect(output).toContain('japan-osaka');
  });
});
