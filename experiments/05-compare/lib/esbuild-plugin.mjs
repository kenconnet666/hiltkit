// 把四种框架的源码接进 esbuild。kind: 'solid' | 'svelte' | 'vapor36' | 'vdom35'。
// 返回值直接展开进 lib/browser.mjs 的 bundle(entry, options)。
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compileSolid, compileSvelte, compileSvelteModule, compileVue } from './compilers.mjs';

const load = (build, filter, compileFn) =>
  build.onLoad({ filter }, async ({ path }) => ({
    contents: await compileFn(await readFile(path, 'utf8'), path),
    loader: 'js',
    resolveDir: dirname(path),
  }));

export function buildOptions(kind) {
  const plugin = {
    name: `compile-${kind}`,
    setup(build) {
      if (kind === 'solid') load(build, /\.jsx$/, compileSolid);
      if (kind === 'svelte') {
        load(build, /\.svelte\.js$/, compileSvelteModule);
        load(build, /\.svelte$/, compileSvelte);
      }
      if (kind === 'vapor36' || kind === 'vdom35') load(build, /\.vue$/, (code, path) => compileVue(code, path, kind));
    },
  };
  const isVue = kind === 'vapor36' || kind === 'vdom35';
  return {
    plugins: [plugin],
    // Vapor 产物 import 'vue'，实际要指到 3.6 的 vue36；vdom35 用普通 vue@3.5
    alias: kind === 'vapor36' ? { vue: 'vue36' } : {},
    define: {
      'process.env.NODE_ENV': '"production"',
      // 只用 <script setup>，关掉 Options API 与 devtools，等同常见的生产构建配置
      ...(isVue && { __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' }),
    },
  };
}
