import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { load } from 'js-yaml';
import { z } from 'zod';

/** `services/chat/skills/`; works from both src/skills and dist/skills. */
export const SKILLS_ROOT = new URL('../../skills/', import.meta.url);

export interface Skill {
  name: string;
  description: string;
  /** Always in the prompt; other skills are loaded by the model with load_skill. */
  always: boolean;
  body: string;
}

const FrontmatterSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  always: z.boolean().default(false),
});

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** Parses a SKILL.md: YAML frontmatter between `---` lines, then the Markdown body. */
export function parseSkill(text: string): Skill {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error('SKILL.md has no frontmatter');
  const meta = FrontmatterSchema.parse(load(match[1]));
  return { ...meta, body: text.slice(match[0].length) };
}

/** Reads `<root>/*\/SKILL.md`, skipping (and logging) any that fail to parse. Sorted by name. */
export function loadSkills(root: URL | string = SKILLS_ROOT): Skill[] {
  const dir = typeof root === 'string' ? root : fileURLToPath(root);
  if (!existsSync(dir)) return [];
  const skills: Skill[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(dir, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    try {
      skills.push(parseSkill(readFileSync(file, 'utf8')));
    } catch (error) {
      new Logger('Skills').warn(`Skipping ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
