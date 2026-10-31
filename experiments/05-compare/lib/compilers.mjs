// 五个编译入口：Solid(Babel)、Svelte 5、Vue 3.6 Vapor、Vue 3.6 vdom、Vue 3.5 vdom。
// publish.mjs（只看产物）和 rows 的 esbuild 插件共用，保证两边编译参数一致。
import { createHash } from 'node:crypto';
import { transformAsync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import { compile, compileModule } from 'svelte/compiler';
import * as sfc35 from 'vue/compiler-sfc';
import * as sfc36 from 'vue36/compiler-sfc';

/** Solid：JSX -> dom-expressions 产物（等价 vite-plugin-solid 的 DOM 构建） */
export async function compileSolid(source, filename) {
  const result = await transformAsync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [[solidPreset, { generate: 'dom', hydratable: false }]],
  });
  return result.code;
}

/** Svelte 5：.svelte -> 客户端 JS（生产模式） */
export function compileSvelte(source, filename) {
  // a11y 警告对基准代码没有意义（<a> 没有 href），过滤掉
  const { js, warnings } = compile(source, { filename, generate: 'client', dev: false, warningFilter: (w) => !w.code.startsWith('a11y') });
  warnings.forEach((w) => console.warn(`[svelte] ${filename}: ${w.message}`));
  return js.code;
}

/** Svelte 5：.svelte.js 模块（里面可以用 $state 等符文） */
export function compileSvelteModule(source, filename) {
  return compileModule(source, { filename, generate: 'client', dev: false }).js.code;
}

/** Vue SFC -> JS。kind: 'vapor36' | 'vdom36' | 'vdom35'，inline 模板，生产模式 */
export function compileVue(source, filename, kind) {
  const sfc = kind === 'vdom35' ? sfc35 : sfc36;
  const { descriptor, errors } = sfc.parse(source, { filename });
  if (errors.length) throw new Error(`[vue] ${filename}: ${errors[0].message}`);
  const id = createHash('sha256').update(filename).digest('hex').slice(0, 8);
  const script = sfc.compileScript(descriptor, {
    id,
    isProd: true,
    inlineTemplate: true,
    // 只有 3.6 compileScript 认 vapor 选项；.vue 里写了 `<script setup vapor>` 时也会被识别
    ...(kind === 'vapor36' ? { vapor: true } : {}),
  });
  return script.content;
}
