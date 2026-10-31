// 引擎体积：esbuild minify（esm、tree-shaking）+ gzip / brotli（node:zlib）。
// 用插件把优先级表、token 对照表、inline、hot 换成最小替身，量各部分占多少。
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('./engine/', import.meta.url));

const STUBS = {
  priority: 'export const getPriority = () => 3000;',
  'token-map': 'export const TOKEN_GROUP_OF = new Map();',
  inline: 'export const registerInlineClass = () => {}; export const inlineStyle = () => "";',
  hot: 'export const HOT = Symbol(); export const hotStyles = (id, value) => value; export const hotUpdate = () => {};',
};

async function measure({ contents, stub = [], external = [] }) {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    treeShaking: true,
    external,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          b.onLoad({ filter: /engine[\\/][\w-]+\.ts$/ }, (args) => {
            const name = args.path.match(/([\w-]+)\.ts$/)[1];
            if (stub.includes(name)) return { contents: STUBS[name], loader: 'js' };
          });
        },
      },
    ],
  });
  const code = Buffer.from(result.outputFiles[0].contents);
  return {
    min: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
    brotli: brotliCompressSync(code, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

/** 运行时入口（runtime.ts 的全部导出）+ 可选的配方 */
const RUNTIME = "export * from './runtime';";
const WITH_RECIPE = `${RUNTIME} export * from './recipe';`;

export async function sizes() {
  const rows = [
    ['引擎（runtime.ts 全部导出），含 alien-signals', { contents: RUNTIME }],
    ['引擎，alien-signals 外置（只算引擎自己）', { contents: RUNTIME, external: ['alien-signals'] }],
    [
      '  去掉 token 对照表',
      { contents: RUNTIME, external: ['alien-signals'], stub: ['token-map'] },
    ],
    ['  去掉优先级表', { contents: RUNTIME, external: ['alien-signals'], stub: ['priority'] }],
    [
      '  去掉两张表',
      { contents: RUNTIME, external: ['alien-signals'], stub: ['token-map', 'priority'] },
    ],
    [
      '  去掉 inline（小程序行内样式）与 hot（热更新）',
      { contents: RUNTIME, external: ['alien-signals'], stub: ['inline', 'hot'] },
    ],
    [
      '  去掉两张表 + inline + hot（最小核心）',
      {
        contents: RUNTIME,
        external: ['alien-signals'],
        stub: ['token-map', 'priority', 'inline', 'hot'],
      },
    ],
    ['引擎 + recipe，alien-signals 外置', { contents: WITH_RECIPE, external: ['alien-signals'] }],
    [
      '只有 alien-signals（effect + signal + 作用域，tree-shake 后）',
      {
        contents:
          "export { effect, effectScope, signal, startBatch, endBatch, setActiveSub } from 'alien-signals';",
      },
    ],
  ];
  const out = [];
  for (const [label, options] of rows) out.push({ label, ...(await measure(options)) });
  return out;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  console.table(await sizes());
}
