// node 05-compare/publish.mjs
// 第一部分：同一个小组件分别用 Solid / Svelte 5 / Vue Vapor 编译，产物写到 output/，
// 并列出每个产物 import 的模块和符号，以及这些子路径在包的 exports 里是否存在、运行时版本。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSolid, compileSvelte, compileVue } from './lib/compilers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
const src = (...p) => readFileSync(join(here, 'src', ...p), 'utf8');
mkdirSync(out, { recursive: true });

const jobs = [
  { file: 'solid-Counter.js', code: await compileSolid(src('solid/Counter.jsx'), 'Counter.jsx') },
  { file: 'solid-App.js', code: await compileSolid(src('solid/App.jsx'), 'App.jsx') },
  { file: 'svelte-Counter.js', code: compileSvelte(src('svelte/Counter.svelte'), 'Counter.svelte') },
  { file: 'svelte-App.js', code: compileSvelte(src('svelte/App.svelte'), 'App.svelte') },
  { file: 'vue-vapor-Counter.js', code: compileVue(src('vue/Counter.vue'), 'Counter.vue', 'vapor36') },
  { file: 'vue-vapor-CounterAttrs.js', code: compileVue(src('vue/CounterAttrs.vue'), 'CounterAttrs.vue', 'vapor36') },
  { file: 'vue-vapor-App.js', code: compileVue(src('vue/App.vue'), 'App.vue', 'vapor36') },
  // 对照：同一个组件按虚拟 DOM 编译（3.5 与 3.6）
  { file: 'vue-vdom35-Counter.js', code: compileVue(src('vue/Counter.vue').replace('setup vapor', 'setup'), 'Counter.vue', 'vdom35') },
  { file: 'vue-vdom36-Counter.js', code: compileVue(src('vue/Counter.vue').replace('setup vapor', 'setup'), 'Counter.vue', 'vdom36') },
];

const require = createRequire(import.meta.url);
const pkgOf = (spec) => {
  // vue 的别名：产物里 import 'vue'，Vapor 产物实际对应 vue36（3.6.0-rc）
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return { name, sub: '.' + spec.slice(name.length) };
};

console.log('产物 import 清单（模块 -> 符号；exports 里是否声明该子路径）\n');
for (const { file, code } of jobs) {
  writeFileSync(join(out, file), code);
  if (file.includes('App') ) continue; // 调用方文件只看内容，不重复列 import
  const alias = file.startsWith('vue-vapor') || file.startsWith('vue-vdom36') ? 'vue36' : file.startsWith('vue-') ? 'vue' : null;
  console.log(`## ${file}`);
  const seen = new Map(); // 同一模块可能被拆成多条 import，合并显示
  for (const m of code.matchAll(/import\s+(?:([^'";]*?)\s+from\s+)?['"]([^'"]+)['"]/g)) {
    const [, clause, spec] = m;
    if (spec.startsWith('.')) continue;
    seen.set(spec, [...(seen.get(spec) ?? []), clause?.replace(/[{}]/g, '').trim() ?? '(副作用 import)']);
  }
  for (const [spec, clauses] of seen) {
    const clause = clauses.join(', ');
    const { name, sub } = pkgOf(spec);
    const real = alias && name === 'vue' ? alias : name;
    const pkg = JSON.parse(readFileSync(require.resolve(`${real}/package.json`), 'utf8'));
    const exp = pkg.exports?.[sub];
    const symbols = clause ? clause.replace(/\s+/g, ' ').slice(0, 400) : '(副作用 import)';
    console.log(`  ${spec}  [${real}@${pkg.version}] exports["${sub}"]=${exp ? '有' : '无'}\n    ${symbols}`);
  }
  console.log();
}
console.log(`产物已写入 ${out}`);
