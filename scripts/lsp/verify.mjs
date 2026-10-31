/**
 * 端到端验证 hiltkit_lsp：按 .mcp.json 真实启动服务器，逐个调用工具并检查结果。
 * 改过配置或升级 TypeScript 后跑一遍：pnpm lsp:verify
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SERVER_NAME = 'hiltkit_lsp';
const DOCS_MAIN = 'apps/docs/src/main.tsx';
const BUTTON = 'packages/ui/src/button/Button.tsx';
const PROVIDER = 'packages/ui/src/provider/Provider.tsx';
const NODE_CONFIG = 'vitest.config.ts';
const TEMP = 'packages/ui/src/__lsp_verify__.tsx';

/** 某段文字在文件中的 1 起始位置；offset 用于定位到文字内部 */
function locate(file, text, offset = 0) {
  const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
  const index = lines.findIndex((line) => line.includes(text));
  if (index < 0) throw new Error(`${file} 中找不到 ${text}`);
  return { line: index + 1, column: lines[index].indexOf(text) + 1 + offset };
}

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

const { command, args } = JSON.parse(readFileSync(resolve(root, '.mcp.json'), 'utf8')).mcpServers[
  SERVER_NAME
];
console.log(`启动：${command} ${args.join(' ')}\n`);
const client = new Client({ name: 'hiltkit-lsp-verify', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command, args, cwd: root, stderr: 'inherit' }));

async function call(name, params) {
  const result = await client.callTool({ name, arguments: params });
  const text = result.content[0]?.text ?? '';
  if (result.isError) throw new Error(`${name} 返回错误：${text}`);
  return JSON.parse(text);
}

try {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  check(
    '工具列表',
    names.join() === 'completions,definitions,diagnostics,hover,references',
    names.join(', '),
  );

  const clean = await call('diagnostics', { filePath: DOCS_MAIN });
  check(
    '诊断：跨包引用的文件没有错误',
    clean.errors === 0,
    `TypeScript ${clean.typescript}，${clean.errors} 个错误`,
  );

  const hover = await call('hover', { filePath: BUTTON, ...locate(BUTTON, 'function Button', 9) });
  check('悬停：组件的类型', /ButtonProps/.test(hover.contents ?? ''), hover.contents);

  const definition = await call('definitions', {
    filePath: DOCS_MAIN,
    ...locate(DOCS_MAIN, '  Provider,', 2),
  });
  const target = definition.items[0]?.filePath ?? '';
  check('跳转定义：跨包到源码，不是 dist', target.startsWith('packages/ui/src/'), target);

  const references = await call('references', {
    filePath: PROVIDER,
    ...locate(PROVIDER, 'export function Provider', 16),
  });
  check(
    '查找引用：跨包找到使用处',
    references.items.some((item) => item.filePath === DOCS_MAIN),
    `${references.total} 处`,
  );

  const completions = await call('completions', {
    filePath: BUTTON,
    ...locate(BUTTON, '  children,', 2),
    prefix: 'chi',
  });
  check(
    '补全：包含 children',
    // 可选属性的补全名带问号
    completions.items.some((item) => item.name.startsWith('children')),
    completions.items.map((item) => item.name).join(', '),
  );

  const config = await call('diagnostics', { filePath: NODE_CONFIG });
  check(
    '诊断：Node 配置文件能解析依赖',
    config.errors === 0,
    config.errors ? JSON.stringify(config.diagnostics[0]) : '0 个错误',
  );

  writeFileSync(resolve(root, TEMP), "export const wrong: number = 'x';\n");
  try {
    const typeError = await call('diagnostics', { filePath: TEMP });
    const found = typeError.diagnostics.find((item) => item.code === 'TS2322');
    check('诊断：发现真实类型错误', found?.range?.start.line === 1, found?.message);

    // 编辑过程中的语法错误应作为诊断返回，而不是让请求失败
    writeFileSync(resolve(root, TEMP), 'export const broken = (\n');
    const broken = await call('diagnostics', { filePath: TEMP });
    check('诊断：语法错误不中断请求', broken.errors > 0, `${broken.errors} 个错误`);
  } finally {
    rmSync(resolve(root, TEMP), { force: true });
  }
} finally {
  await client.close();
}

for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}  —  ${item.detail}`);
const failed = checks.filter((item) => !item.ok).length;
console.log(failed ? `\n${failed} 项未通过` : `\n全部 ${checks.length} 项通过`);
process.exitCode = failed ? 1 : 0;
