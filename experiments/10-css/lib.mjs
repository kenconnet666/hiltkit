// 10-css 共用：把 TSX 入口用本目录的编译器、运行时、引擎打成一个包（客户端 IIFE 或服务端 ESM）。
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from '../03-publish/packages/compiler/index.mjs';

export const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/**
 * options：
 *   generate：'client' | 'server'
 *   sx：'split' | 'whole'（编译器怎么处理 sx）
 *   dev：开发模式（可读类名、热更新包装）
 *   legacyRuntime：用 03-publish 的原型运行时（对照旧行为）
 *   contents：不给入口文件，直接给源码（TS，相对 cases/ 解析）
 *   external / format：做预编译产物时用（组件库）
 *   minify：默认 true
 *   metafile：返回体积分析
 */
export async function bundle(entry, options = {}) {
  const { generate = 'client', sx = 'split', dev = false, minify = true, define = {}, contents, external = [], format, extraAlias = {} } = options;
  const server = generate === 'server';
  const result = await build({
    ...(contents === undefined ? { entryPoints: [entry] } : { stdin: { contents, resolveDir: here('./cases/'), loader: 'ts' } }),
    external,
    bundle: true,
    write: false,
    format: format ?? (server ? 'esm' : 'iife'),
    platform: server ? 'node' : 'browser',
    target: 'es2022',
    minify,
    define: { 'process.env.NODE_ENV': '"production"', ...define },
    plugins: [
      {
        name: 'hilt',
        setup(b) {
          const alias = {
            '@hilt/runtime': here(server ? '../03-publish/packages/runtime/server.js' : '../03-publish/packages/runtime/index.js'),
            '@hilt/css': here('./engine/runtime.ts'),
            '@hilt/css/abi': here('./engine/abi.ts'),
            ...extraAlias,
          };
          b.onResolve({ filter: /^@(hilt|lib)\// }, (args) =>
            external.includes(args.path) ? { path: args.path, external: true } : alias[args.path] ? { path: alias[args.path] } : undefined,
          );
          b.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
            contents: (await compile(await readFile(path, 'utf8'), path, { generate, sx, dev })).code,
            loader: 'js',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

/** 体积：min、gzip、brotli */
export async function sizeOf(code) {
  const { gzipSync, brotliCompressSync, constants } = await import('node:zlib');
  const buffer = Buffer.from(code);
  return {
    min: buffer.length,
    gzip: gzipSync(buffer, { level: 9 }).length,
    brotli: brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}
