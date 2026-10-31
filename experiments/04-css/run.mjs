// node 04-css/run.mjs [--rounds=9] [--rows=1000] [--lib=300] [--only=checks,bench,lib,size]
// 工作目录是 experiments。计时只在独占机器、串行跑时有意义；--rounds=1 --rows=100 --lib=30 可以快速验证脚本。
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { bundle, launch, median, openPage } from '../lib/browser.mjs';
import { sizes } from './size.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ROUNDS = Number(option('rounds', 9));
const ROWS = Number(option('rows', 1000));
const LIB = Number(option('lib', 300));
const only = new Set(option('only', 'checks,bench,lib,size').split(','));
const entry = fileURLToPath(new URL('./entry.ts', import.meta.url));
const fix = (value, digits = 1) => +value.toFixed(digits);
const table = (head, rows) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

const browser = await launch();

/* ───────────── 1. 语义断言 ───────────── */
if (only.has('checks')) {
  console.log('## 语义断言（真实 Chromium）\n');
  const code = await bundle(entry, { minify: false });
  const page = await openPage(browser, code);
  const results = await page.evaluate(() => window.api.checks());

  // 悬停要真实鼠标：条件合并后 :hover 仍是蓝色，普通状态是绿色
  await page.evaluate(() => window.api.hoverFixture());
  const colorOf = () =>
    page.evaluate(() => getComputedStyle(document.getElementById('hover-target')).color);
  const idle = await colorOf();
  await page.hover('#hover-target');
  const hovered = await colorOf();
  await page.mouse.move(900, 800);
  const left = await colorOf();
  const ok = idle === 'rgb(0, 128, 0)' && hovered === 'rgb(0, 0, 255)' && left === idle;
  results.push({
    name: '真实悬停：default 被后者覆盖为绿，:hover 的蓝因条件里的 null 保留',
    ok,
    detail: ok ? '' : `期望 绿/蓝/绿，实际 ${idle} / ${hovered} / ${left}`,
  });

  for (const { name, ok, detail } of results) console.log(ok ? `ok   ${name}` : `FAIL ${name}\n     ${detail}`);
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 通过${failed ? `，${failed} 失败` : ''}\n`);
  if (failed) process.exitCode = 1;
  await page.close();
}

/* ───────────── 2. 1000 行样式更新 ───────────── */
if (only.has('bench')) {
  const code = await bundle(entry);
  const MODES = ['engine', 'engine-effect', 'hand'];
  const LABELS = {
    engine: '引擎 bind/select（signals）',
    'engine-effect': '引擎 整段 effect（signals）',
    hand: '手写类 + 元素变量（signals）',
  };
  const scenarios = await (async () => {
    const page = await openPage(browser, code);
    const list = await page.evaluate(() => window.api.scenarios);
    await page.close();
    return list;
  })();

  const result = {};
  for (const mode of MODES) {
    // 挂载与卸载：每轮新页面（首次渲染，JIT 冷）
    const mounts = [];
    const disposes = [];
    for (let round = 0; round < ROUNDS; round++) {
      const page = await openPage(browser, code);
      mounts.push(await page.evaluate(([m, n]) => window.api.mount(m, n), [mode, ROWS]));
      disposes.push(await page.evaluate(() => window.api.dispose()));
      await page.close();
    }
    // 场景：同一页面反复跑，轮数取中位数；计数另跑一遍（不计时）
    const page = await openPage(browser, code);
    await page.evaluate(([m, n]) => window.api.mount(m, n), [mode, ROWS]);
    const row = { mount: median(mounts), dispose: median(disposes), scenarios: {} };
    for (const [name, times] of scenarios) {
      const samples = [];
      for (let round = 0; round < ROUNDS; round++)
        samples.push(await page.evaluate(([n, t]) => window.api.time(n, t), [name, times]));
      const counts = await page.evaluate(([n, t]) => window.api.count(n, t), [name, times]);
      row.scenarios[name] = { ms: median(samples), ...counts };
    }
    result[mode] = row;
    await page.close();
  }

  const format = (table) =>
    Object.entries(table)
      .map(([key, value]) => `${key}×${fix(value, 2)}`)
      .join(' ') || '无';
  console.log(`## ${ROWS} 行样式更新（${ROUNDS} 轮中位数，每次改状态后强制布局）\n`);
  console.log(
    table(
      ['场景（次数）', ...MODES.map((mode) => `${LABELS[mode]} ms`)],
      [
        ...scenarios.map(([name, times]) => [
          `${name} ×${times}`,
          ...MODES.map((mode) => fix(result[mode].scenarios[name].ms)),
        ]),
        ['挂载（首次渲染）', ...MODES.map((mode) => fix(result[mode].mount))],
        ['卸载（停全部 effect）', ...MODES.map((mode) => fix(result[mode].dispose))],
      ],
    ),
  );
  console.log('\n每次状态变化平均改了几处 DOM（按属性名）/ CSSOM：\n');
  console.log(
    table(
      ['场景', ...MODES.map((mode) => LABELS[mode])],
      scenarios.map(([name]) => [
        name,
        ...MODES.map((mode) => {
          const { mutations, cssom } = result[mode].scenarios[name];
          return `DOM ${format(mutations)}；CSSOM ${format(cssom)}`;
        }),
      ]),
    ),
  );
  console.log();
}

/* ───────────── 3. 组件库规模：运行时 vs 构建期预计算 ───────────── */
if (only.has('lib')) {
  const code = await bundle(entry);
  // 构建期预计算在 Node 里做（不计时），再把结果表传进页面
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('./precompute.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const { precompute } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const tableData = precompute(LIB);
  const json = JSON.stringify(tableData);

  const engine = [];
  const stages = [];
  const precomputed = [];
  for (let round = 0; round < ROUNDS; round++) {
    let page = await openPage(browser, code);
    engine.push(await page.evaluate((n) => window.api.engineRun(n), LIB));
    await page.close();
    page = await openPage(browser, code);
    stages.push(await page.evaluate((n) => window.api.engineStages(n), LIB));
    await page.close();
    page = await openPage(browser, code);
    precomputed.push(await page.evaluate((t) => window.api.precomputedRun(t), tableData));
    await page.close();
  }
  const pick = (runs, key) => median(runs.map((run) => run[key]));
  const stage = (key) => median(stages.map((run) => run[key]));
  const inline = median(engine.map((run) => run.ms));
  const baked = median(precomputed.map((run) => run.ms));
  console.log(`## 组件库规模：${LIB} 个样式组首次渲染全部用到（${ROUNDS} 轮，每轮新页面）\n`);
  console.log(
    table(
      ['路径', 'JS 总耗时 ms', '挂元素 + 强制样式重算 ms', '规则数'],
      [
        ['运行时引擎（展开 + 组合 + 哈希 + 插规则）', fix(inline, 2), fix(pick(engine, 'recalcMs'), 2), engine[0].rules],
        ['构建期预计算（查表 + insertRule）', fix(baked, 2), fix(pick(precomputed, 'recalcMs'), 2), precomputed[0].rules],
      ],
    ),
  );
  console.log(
    `\n运行时 / 预计算 = ${fix(inline / baked, 2)}×；运行时多出 ${fix(inline - baked, 2)} ms（${fix((inline - baked) / LIB * 1000, 1)} µs / 组）`,
  );
  console.log(
    `\n引擎路径按阶段拆开（另一页面单独跑，约等于总耗时）：展开声明 ${fix(stage('expand'), 2)} ms，` +
      `组合 + 序列化 + 哈希 ${fix(stage('compose'), 2)} ms，插规则 ${fix(stage('insert'), 2)} ms`,
  );
  console.log(
    `预计算表的体积：${json.length} 字节 JSON（gzip ${gzipSync(json, { level: 9 }).length}），` +
      `平均每组 ${fix(json.length / LIB, 0)} 字节、${fix(tableData.reduce((sum, e) => sum + e.rules.length, 0) / LIB, 1)} 条规则\n`,
  );
}

/* ───────────── 4. 体积 ───────────── */
if (only.has('size')) {
  console.log('## 引擎体积（esbuild minify + gzip -9 / brotli -11，字节）\n');
  const rows = await sizes();
  console.log(
    table(
      ['内容', 'minify', 'gzip', 'brotli'],
      rows.map((row) => [row.label, row.min, row.gzip, row.brotli]),
    ),
  );
  console.log();
}

await browser.close();
