// node 05-compare/semantics.mjs
// 属性透传 / 合并的运行时探针：同一个“子组件自带 class/style/click/ref，父组件也传”的场景，
// 在 Solid / Svelte 5 / Vue Vapor / Vue 3.5 vdom 里各跑一遍，看 DOM 最终结果。
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../lib/browser.mjs';
import { buildOptions } from './lib/esbuild-plugin.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const CASES = [
  { name: 'solid', entry: 'semantics/solid/entry.jsx', kind: 'solid', labels: ['A {...props} 在前', 'B {...props} 在后'] },
  { name: 'svelte5', entry: 'semantics/svelte/entry.js', kind: 'svelte', labels: ['A {...rest} 在前', 'B {...rest} 在后'] },
  { name: 'vue36-vapor', entry: 'semantics/vue/entry-vapor.js', kind: 'vapor36', labels: ['A 默认透传', 'B $attrs 在前', 'C $attrs 在后'] },
  { name: 'vue35-vdom', entry: 'semantics/vue/entry-vdom35.js', kind: 'vdom35', labels: ['A 默认透传', 'B $attrs 在前', 'C $attrs 在后'] },
];

const browser = await launch();
for (const { name, entry, kind, labels } of CASES) {
  const page = await openPage(browser, await bundle(here(entry), buildOptions(kind)));
  const results = await page.evaluate(() => window.semantics());
  console.log(`\n== ${name} ==（父传 class="parent" style="color:red" onClick/ref；子自带 class="own" style="font-weight:bold" onClick/ref）`);
  results.forEach((r, i) =>
    console.log(`${labels[i]}\n  class=${JSON.stringify(r.class)} style=${JSON.stringify(r.style)} click=${r.clicks} ref命中该元素=${r.refHits} ${r.refOther}`),
  );
  await page.close();
}
await browser.close();
