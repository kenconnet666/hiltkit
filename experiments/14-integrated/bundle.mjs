// 把集成用例编译打包：packages 可以换成别的版本做对照
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from '../03-publish/packages/compiler/index.mjs';

export const here = (path) => fileURLToPath(new URL(path, import.meta.url));
export async function bundle(entry, generate, packages = '../03-publish/packages', minify = false) {
  const result = await build({
    entryPoints: [here(entry)],
    bundle: true,
    write: false,
    format: generate === 'server' ? 'esm' : 'iife',
    platform: generate === 'server' ? 'node' : 'browser',
    target: 'es2022',
    minify,
    alias: {
      '@hilt/runtime': here(`${packages}/runtime/${generate === 'server' ? 'server.js' : 'index.js'}`),
      '@hilt/css/abi': here('../10-css/engine/abi.ts'),
      '@hilt/css': here('../10-css/engine/runtime.ts'),
    },
    plugins: [
      {
        name: 'hilt',
        setup(b) {
          b.onLoad({ filter: /14-integrated[\\/].*\.tsx$/ }, async ({ path }) => ({
            contents: (await compile(await readFile(path, 'utf8'), path, { generate })).code,
            loader: 'js',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

