import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stable from both src/llm/tools and dist/llm/tools, independent of process.cwd().
export const WORKSPACE_ROOT = fileURLToPath(
  new URL('../../../workspace/', import.meta.url),
);

/** Validate the relative name and every existing component before filesystem access. */
export async function safePath(
  path: string,
  workspaceRoot = WORKSPACE_ROOT,
): Promise<string> {
  const parts = path.replaceAll('\\', '/').split('/');
  if (
    !path.trim() ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    parts[0].toLowerCase() === 'workspace' ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[<>:"|?*]/.test(part) ||
        /\p{Cc}/u.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new Error(
      'Use a file path relative to workspace, without traversal or workspace/ prefix',
    );

  const root = resolve(workspaceRoot);
  const target = resolve(root, ...parts);
  const within = (base: string, candidate: string) => {
    const suffix = relative(base, candidate);
    return (
      suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
    );
  };
  if (!within(root, target) || target === root)
    throw new Error('Path outside workspace');
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error('Workspace must be a real directory');
  const canonicalRoot = await realpath(root);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    // Reject links even when they currently point inside the sandbox.
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) {
      throw new Error('Filesystem links are not allowed in workspace paths');
    }
    if (!within(canonicalRoot, await realpath(current)))
      throw new Error('Path outside workspace');
  }
  return target;
}

export function createBusinessTools(workspaceRoot = WORKSPACE_ROOT) {
  const queryRequirement = tool(
    async ({ requirementId }) => {
      const path = await safePath(
        `requirements/${requirementId}.json`,
        workspaceRoot,
      );
      return JSON.stringify(JSON.parse(await readFile(path, 'utf8')));
    },
    {
      name: 'query_requirement',
      description:
        '根据需求单号读取需求详情，来源为 workspace/requirements/{requirementId}.json。',
      schema: z.object({
        requirementId: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
          .describe('需求单号，例如 REQ-2026-001'),
      }),
    },
  );

  const readWorkspaceFile = tool(
    async ({ path }) => {
      return readFile(await safePath(path, workspaceRoot), 'utf8');
    },
    {
      name: 'read_file',
      description:
        '读取 workspace 下 UTF-8 文件内容，例如规范和标准。path 为相对路径，不带 workspace/ 前缀。',
      schema: z.object({
        path: z.string().min(1).describe('例如 standards/requirement-spec.md'),
      }),
    },
  );

  const writeWorkspaceFile = tool(
    async ({ path, content }) => {
      const target = await safePath(path, workspaceRoot);
      await mkdir(dirname(target), { recursive: true });
      // Recheck newly created directories before writing the file.
      await safePath(path, workspaceRoot);
      await writeFile(target, content, 'utf8');
      return JSON.stringify({ path, written: true });
    },
    {
      name: 'write_file',
      description:
        '将 UTF-8 内容写入 workspace 下相对路径，自动创建父目录，覆盖已有文件。用于分析报告和制品；path 不带 workspace/ 前缀。',
      schema: z.object({
        path: z
          .string()
          .min(1)
          .describe('例如 reports/REQ-2026-001-analysis.md'),
        content: z.string().describe('完整文件内容'),
      }),
    },
  );
  return [queryRequirement, readWorkspaceFile, writeWorkspaceFile] as const;
}

export const businessTools = createBusinessTools();
