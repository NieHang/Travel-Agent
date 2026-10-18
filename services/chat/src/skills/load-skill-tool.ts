import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { Skill } from './registry.js';

export const LOAD_SKILL = 'load_skill';

/** Returns the bodies of the named skills; unknown names get a line listing what is available. */
export function loadSkillTool(skills: Skill[]): StructuredToolInterface {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const available = skills.map((s) => s.name).join(', ');
  return tool(
    async ({ names }: { names: string[] }) =>
      names
        .map((name) => {
          const skill = byName.get(name);
          return skill ? `Skill ${name}:\n${skill.body}` : `Unknown skill "${name}". Available: ${available}`;
        })
        .join('\n\n'),
    {
      name: LOAD_SKILL,
      description: 'Load skills by name from the skill list in the system prompt. Load several at once when needed.',
      schema: z.object({ names: z.array(z.string()).min(1).describe('Skill names, e.g. ["japan-tokyo"]') }),
    },
  );
}
