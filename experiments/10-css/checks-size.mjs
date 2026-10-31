// 体积、摇树、预编译组件库、首屏成本：node 10-css/run.mjs --only=size [--rounds=9] [--lib=300]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { median, openPage } from '../lib/browser.mjs';
import { bundle, here, sizeOf } from './lib.mjs';

const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

/** 应用里用到哪些引擎部件，就只写那些 import（和编译产物里的写法一致） */
const VARIANTS = [
  ['A 不用 sx（只有运行时：class / style / 事件 / 列表 / 水合）', `import { spread } from '@hilt/runtime'; spread(document.body, { class: 'a', style: 'color:red' });`],
  [
    'B A + create + 静态 sx',
    `import { spread } from '@hilt/runtime'; import { create } from '@hilt/css';
     const s = create({ root: { padding: 4, color: { default: 'red', ':hover': 'blue' } } });
     spread(document.body, { sx: [s.root] });`,
  ],
  [
    'C B + 动态样式与条件项（bind、select，编译器的输出）',
    `import { spread } from '@hilt/runtime'; import { create } from '@hilt/css'; import { bind, select } from '@hilt/css/abi';
     const s = create({ root: { padding: 4 }, hot: { color: 'red' }, bar: (w) => ({ width: w }) });
     let w = 1; let on = true;
     spread(document.body, { sx: [s.root, select(() => on && s.hot), bind(s.bar, () => [w])] });`,
  ],
  [
    'D C + recipe',
    `import { spread } from '@hilt/runtime'; import { create, recipe } from '@hilt/css'; import { bind, select } from '@hilt/css/abi';
     const s = create({ root: { padding: 4 }, hot: { color: 'red' }, bar: (w) => ({ width: w }) });
     const chip = recipe({ name: 'Chip', parts: ['root'], base: { root: { color: 'red' } }, variants: { size: { sm: { root: { fontSize: 10 } } } } });
     let w = 1; let on = true;
     spread(document.body, { sx: [s.root, select(() => on && s.hot), bind(s.bar, () => [w])] });
     spread(document.body, chip({ get size() { return w } }).root);`,
  ],
  [
    'E C + 主题（defineTokens、createTheme、themeStyle）',
    `import { spread } from '@hilt/runtime'; import { create, defineTokens, createTheme, themeStyle } from '@hilt/css'; import { bind, select } from '@hilt/css/abi';
     const t = defineTokens('z', { colors: { text: '#000' }, space: { md: '8px' } });
     const dark = createTheme(t, { colors: { text: '#fff' } });
     const s = create({ root: { padding: '_md', color: '_text' }, hot: { color: 'red' }, bar: (w) => ({ width: w }) });
     let w = 1; let on = true;
     spread(document.body, { sx: [s.root, dark, themeStyle(t.colors, { text: 'red' }), select(() => on && s.hot), bind(s.bar, () => [w])] });`,
  ],
  [
    'F 全部（C + recipe + 主题 + keyframes + provideStyles/useRecipe + renderStyleTag/themeBootScript + defineConditions）',
    `import { spread } from '@hilt/runtime';
     import { create, recipe, defineTokens, createTheme, themeStyle, keyframes, provideStyles, useRecipe, renderStyleTag, themeBootScript, defineConditions, defineMarker, when } from '@hilt/css';
     import { bind, select } from '@hilt/css/abi';
     const t = defineTokens('z', { colors: { text: '#000' }, space: { md: '8px' } });
     const dark = createTheme(t, { colors: { text: '#fff' } });
     defineConditions({ _loading: '[data-loading]' });
     const m = defineMarker('m');
     const s = create({ root: { padding: '_md', color: { default: '_text', [when.ancestor(':hover', m)]: 'red' } }, hot: { color: 'red', animationName: keyframes({ to: { opacity: 1 } }) }, bar: (w) => ({ width: w }) });
     const chip = recipe({ name: 'Chip', parts: ['root'], base: { root: { color: 'red' } }, variants: { size: { sm: { root: { fontSize: 10 } } } } });
     let w = 1; let on = true;
     provideStyles({});
     spread(document.body, { sx: [s.root, dark, themeStyle(t.colors, { text: 'red' }), select(() => on && s.hot), bind(s.bar, () => [w])] });
     spread(document.body, useRecipe(chip, { get size() { return w } }).root);
     globalThis.ssr = [renderStyleTag, themeBootScript];`,
  ],
];

export async function run({ browser, check, option }) {
  const ROUNDS = Number(option('rounds', 9));
  const LIB = Number(option('lib', 300));
  console.log('## 体积（esbuild minify + gzip -9 / brotli -11，字节，含 alien-signals）\n');
  const results = [];
  const codes = {};
  for (const [label, contents] of VARIANTS) {
    const code = await bundle(undefined, { contents, format: 'iife' });
    codes[label[0]] = code;
    results.push([label, ...Object.values(await sizeOf(code))]);
  }
  console.log(table(['内容', 'minify', 'gzip', 'brotli'], results));
  const gz = (key) => results.find((row) => row[0].startsWith(key))[2];
  console.log(`\n     引擎增量（gzip）：静态 sx ${gz('B') - gz('A')}，+动态/条件 ${gz('C') - gz('B')}，+recipe ${gz('D') - gz('C')}，+主题 ${gz('E') - gz('C')}，全部相对 A ${gz('F') - gz('A')}\n`);

  check('摇树：不用 sx 的应用，产物里没有引擎（没有样式表、没有哈希）', !codes.A.includes('data-hilt-css') && !codes.A.includes('0x5bd1e995') && !codes.A.includes('data-names'), 'A 含引擎');
  check('摇树：用了 create 才带上引擎', codes.B.includes('data-hilt-css'));
  check('摇树：不用 recipe 时没有 recipe 的代码（档位组合缓存）', !codes.C.includes('compound') && codes.D.includes('compound'));
  check('摇树：不用主题时没有主题的代码（防闪烁脚本、themeStyle）', !codes.C.includes('prefers-color-scheme') && codes.F.includes('prefers-color-scheme'));

  // ---- 预编译组件库：编译成 JS，只依赖运行时与引擎的公开入口 ----
  console.log('## 预编译组件库经 ...rest 转交 sx\n');
  const dist = join(tmpdir(), 'hilt-10-css-lib');
  await mkdir(dist, { recursive: true });
  const external = ['@hilt/runtime', '@hilt/css', '@hilt/css/abi'];
  for (const name of ['Box', 'Card']) {
    const code = await bundle(here(`./cases/lib/${name}.tsx`), { format: 'esm', minify: false, external });
    await writeFile(join(dist, `${name}.js`), code);
  }
  const box = await readFile(join(dist, 'Box.js'), 'utf8');
  const card = await readFile(join(dist, 'Card.js'), 'utf8');
  check('库的编译产物（Box）只 import 运行时，没有引擎', /from "@hilt\/runtime"/.test(box) && !/@hilt\/css/.test(box), box.match(/from "[^"]+"/g));
  check('库的编译产物（Card）用公开入口 @hilt/css 与 @hilt/css/abi', /@hilt\/css"/.test(card) && /@hilt\/css\/abi"/.test(card), card.match(/from "[^"]+"/g));
  const appCode = await bundle(here('./cases/lib-app.tsx'), { minify: false, extraAlias: { '@lib/Box': join(dist, 'Box.js'), '@lib/Card': join(dist, 'Card.js') } });
  const page = await openPage(browser, appCode);
  const css = (id, prop) => page.evaluate(([i, p]) => getComputedStyle(document.getElementById(i))[p], [id, prop]);
  check('使用方的 sx 经库的 ...rest 落到元素上（margin 7、绿色、宽 30px）', (await css('box', 'marginTop')) === '7px' && (await css('box', 'color')) === 'rgb(0, 128, 0)' && (await css('box', 'width')) === '30px');
  check('库自己的 class 还在；库有样式时使用方的 sx 排在后面覆盖（绿色盖过库的红色）', (await page.evaluate(() => document.getElementById('card').classList.contains('lib-card'))) && (await css('card', 'color')) === 'rgb(0, 128, 0)' && (await css('card', 'paddingTop')) === '4px');
  await page.evaluate(() => (window.api.setWidth('44px'), window.api.flushSync()));
  check('使用方动态参数（库的 Box 只转交）变化：只改变量', (await css('box', 'width')) === '44px');
  await page.close();

  // ---- 首屏成本 ----
  console.log('## 首屏：300 个不同的样式组第一次渲染（运行时：展开 + 组合 + 哈希 + 插规则）\n');
  const first = await bundle(here('./cases/first-screen.ts'));
  const runs = [];
  for (let round = 0; round < ROUNDS; round++) {
    const p = await openPage(browser, first);
    runs.push(await p.evaluate((n) => window.api.run(n), LIB));
    await p.close();
  }
  const ms = median(runs.map((r) => r.ms));
  const recalc = median(runs.map((r) => r.recalcMs));
  console.log(`     ${LIB} 个样式组：JS ${ms.toFixed(1)} ms（${((ms / LIB) * 1000).toFixed(0)} µs / 组），挂元素 + 强制样式重算 ${recalc.toFixed(1)} ms，规则 ${runs[0].rules} 条（${ROUNDS} 轮中位数，每轮新页面）`);
  console.log('     对照（04-css 的上一轮实测，同样的负载）：运行时 56.8 ms，构建期预计算 8.5 ms');
  check('首屏 300 个样式组 JS 成本在 100 ms 以内（量级断言，机器忙时放宽）', ms < 100, ms);
}
