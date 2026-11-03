import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const McpResultSchema = z.object({ content: z.string(), isError: z.boolean() });
export const CassetteSchema = z.object({
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    schema: z.record(z.unknown()),
  })),
  calls: z.array(z.object({
    tool: z.string(),
    args: z.record(z.unknown()),
    result: McpResultSchema,
  })),
});

export type Cassette = z.infer<typeof CassetteSchema>;

export async function readCassette(path: string): Promise<Cassette> {
  return CassetteSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
