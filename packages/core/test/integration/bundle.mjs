// 集成测试的打包：只用 esbuild 自带的 JSX 转换（automatic + jsxImportSource），没有任何插件，和使用方一样。
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const src = (file) => here(`../../src/${file}`);
/** 直接测源码，不用先构建 */
export const ALIAS = {
  'hiltkit/jsx-runtime': src('jsx-runtime.ts'),
  'hiltkit/jsx-dev-runtime': src('jsx-dev-runtime.ts'),
  'hiltkit/css': src('css/index.ts'),
  'hiltkit/devtools': src('devtools/index.ts'),
  hiltkit: src('index.ts'),
};
export async function bundle(
  contents,
  { server = false, minify = false, alias = {}, external = [], plugins = [], jsxDev = false } = {},
) {
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
    jsxImportSource: 'hiltkit',
    alias: { ...ALIAS, ...alias },
    external,
    plugins,
  });
  return result.outputFiles[0].text;
}
