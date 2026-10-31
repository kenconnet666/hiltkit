/**
 * hiltkit_lsp：把 TypeScript 语言服务以 MCP 工具的形式提供给 AI 工具。
 *
 * 用法：node scripts/lsp/server.mjs <仓库根目录>
 * 所有位置都是 1 起始的行号与列号。
 */
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TypeScriptWorkspace } from './workspace.mjs';

const workspace = new TypeScriptWorkspace(resolve(process.argv[2] ?? '.'));
const server = new McpServer({ name: 'hiltkit-lsp', version: '0.0.0' });

const file = {
  filePath: z.string().describe(`Path of a .ts/.tsx file, relative to ${workspace.root}`),
};
const position = {
  ...file,
  line: z.number().int().min(1).describe('1-based line'),
  column: z.number().int().min(1).describe('1-based column'),
};
const limit = (fallback, max) => z.number().int().min(1).max(max).default(fallback);

/** 所有工具都是只读的；异常转成 isError 结果，避免中断会话 */
function register(name, description, inputSchema, run) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await run(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: String(error?.message ?? error) }],
        };
      }
    },
  );
}

register(
  'diagnostics',
  'Type errors for one file from the project TypeScript (same as `pnpm typecheck`).',
  file,
  ({ filePath }) => workspace.diagnostics(filePath),
);

register(
  'hover',
  'Type and documentation at a position, as shown on hover.',
  position,
  ({ filePath, line, column }) => workspace.hover(filePath, line, column),
);

register(
  'definitions',
  'Go to definition for the symbol at a position.',
  { ...position, limit: limit(50, 500) },
  ({ filePath, line, column, limit }) => workspace.definitions(filePath, line, column, limit),
);

register(
  'references',
  'Find all references to the symbol at a position.',
  { ...position, limit: limit(100, 500) },
  ({ filePath, line, column, limit }) => workspace.references(filePath, line, column, limit),
);

register(
  'completions',
  'Completions at a position, optionally filtered by a name prefix. detailLimit fetches signatures/docs for the first N items.',
  {
    ...position,
    prefix: z.string().default(''),
    limit: limit(40, 200),
    detailLimit: z.number().int().min(0).max(20).default(0),
  },
  ({ filePath, line, column, prefix, limit, detailLimit }) =>
    workspace.completions(filePath, line, column, prefix, limit, detailLimit),
);

await server.connect(new StdioServerTransport());
