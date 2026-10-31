// 打包：只用 esbuild 自带的 JSX 转换（automatic + jsxImportSource），没有任何插件。
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const runtime = (file) => here(`../03-publish/packages/runtime/${file}`);
export const ALIAS = {
  'hilt/jsx-runtime': here('./hilt/jsx-runtime.ts'),
  'hilt/jsx-dev-runtime': here('./hilt/jsx-runtime.ts'),
  'hilt/css': here('./hilt/css.ts'),
  'hilt/devtools': here('./hilt/devtools.ts'),
  hilt: here('./hilt/index.ts'),
  '@hilt/reactive': runtime('reactive.js'),
  '@hilt/attrs': runtime('attrs.js'),
  '@hilt/rules': runtime('rules.js'),
  '@hilt/server': runtime('server.js'),
  '@hilt/state': runtime('state.js'),
  // 样式引擎里的 import：contexts、effect 都来自同一个内核
  '@hilt/runtime': runtime('index.js'),
  '@hilt/css/abi': here('../10-css/engine/abi.ts'),
  '@hilt/css': here('../10-css/engine/runtime.ts'),
};
export async function bundle(contents, { server = false, minify = false, alias = {}, external = [], plugins = [], jsxDev = false } = {}) {
  const result = await build({
    stdin: { contents, resolveDir: here('.'), loader: 'tsx' },
    bundle: true,
    write: false,
    format: server ? 'esm' : 'iife',
    platform: server ? 'node' : 'browser',
    target: 'es2022',
    minify,
    jsx: 'automatic',
    jsxDev,
    jsxImportSource: 'hilt',
    alias: { ...ALIAS, ...alias },
    external,
    plugins,
  });
  return result.outputFiles[0].text;
}
