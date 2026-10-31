// 把原型编译器接进 esbuild，供 05-compare/rows/run.mjs 使用
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../packages/compiler/index.mjs';

export const hiltEntry = fileURLToPath(new URL('./entry.tsx', import.meta.url));
export const hiltBuild = {
  alias: {
    '@hilt/runtime': fileURLToPath(new URL('../packages/runtime/index.js', import.meta.url)),
    '@hilt/css/abi': fileURLToPath(new URL('../../10-css/engine/abi.ts', import.meta.url)),
    '@hilt/css': fileURLToPath(new URL('../../10-css/engine/runtime.ts', import.meta.url)),
  },
  plugins: [
    {
      name: 'hilt',
      setup(build) {
        build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
          contents: (await compile(await readFile(path, 'utf8'), path)).code,
          loader: 'js',
          resolveDir: dirname(path),
        }));
      },
    },
  ],
};
