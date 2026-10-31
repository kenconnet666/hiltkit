// 基准：node 10-css/run.mjs --only=bench [--rounds=9] [--rows=1000]
// 1. 1000 行：sx 拆分（编译器把静态项与动态项分开）/ 整段 effect / 手写 / 条件走 DOM 属性
// 2. 1000 个按钮：配方 / 直接写 sx 数组 / 静态 sx
// 计时只看量级（别的进程同时在跑时有波动）；语义断言（三种写法算出的样式一致）不依赖计时。
import { heapAfterGc, median, openPage } from '../lib/browser.mjs';
import { bundle, here } from './lib.mjs';

const fix = (value, digits = 1) => +value.toFixed(digits);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
const format = (record) =>
  Object.entries(record)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}×${fix(value, 2)}`)
    .join(' ') || '无';

export async function run({ browser, check, option }) {
  const ROUNDS = Number(option('rounds', 9));
  const ROWS = Number(option('rows', 1000));
  console.log(`## 基准（${ROWS} 行 / 按钮，${ROUNDS} 轮中位数）\n`);
  const split = await bundle(here('./cases/bench.tsx'), { sx: 'split' });
  const whole = await bundle(here('./cases/bench.tsx'), { sx: 'whole' });

  const RUNS = {
    rows: {
      scenarios: [['widths', 20], ['oneWidth', 20], ['hot', 10], ['unrelated', 10], ['theme', 4]],
      variants: [
        ['sx 拆分（bind/select）', split, 'sx'],
        ['sx 整段 effect', whole, 'sx'],
        ['手写类 + 元素变量', split, 'hand'],
        ['条件走 data 属性', split, 'attr'],
      ],
    },
    buttons: {
      scenarios: [['size', 10], ['variant', 10], ['unrelated', 10]],
      variants: [
        ['配方 button({ variant, size })', split, 'recipe'],
        ['直接写 sx 数组（查表 + 条件）', split, 'sx'],
        ['静态 sx（下限）', split, 'static'],
      ],
    },
  };

  for (const [kind, { scenarios, variants }] of Object.entries(RUNS)) {
    const results = [];
    for (const [label, code, mode] of variants) {
      const mounts = [];
      const disposes = [];
      const heaps = [];
      let effects = 0;
      for (let round = 0; round < ROUNDS; round++) {
        const page = await openPage(browser, code);
        const baseline = await heapAfterGc(page);
        mounts.push(await page.evaluate(([k, m, n]) => window.api.mount(k, m, n), [kind, mode, ROWS]));
        heaps.push((await heapAfterGc(page)) - baseline);
        effects = await page.evaluate(() => window.api.effects());
        disposes.push(await page.evaluate(() => window.api.dispose()));
        await page.close();
      }
      const page = await openPage(browser, code);
      await page.evaluate(([k, m, n]) => window.api.mount(k, m, n), [kind, mode, ROWS]);
      const row = { label, mount: median(mounts), dispose: median(disposes), heap: median(heaps), effects, scenarios: {} };
      row.elements = await page.evaluate(() => window.api.elements());
      for (const [name, times] of scenarios) {
        const samples = [];
        for (let round = 0; round < ROUNDS; round++) samples.push(await page.evaluate(([n, t]) => window.api.time(n, t), [name, times]));
        row.scenarios[name] = { ms: median(samples), ...(await page.evaluate(([n, t]) => window.api.count(n, t), [name, times])) };
      }
      results.push(row);
      await page.close();
    }

    console.log(`### ${kind === 'rows' ? '1000 行样式更新' : '1000 个按钮（配方）'}\n`);
    console.log(
      table(
        ['场景（次数）', ...results.map((r) => `${r.label} ms`)],
        [
          ...scenarios.map(([name, times]) => [`${name} ×${times}`, ...results.map((r) => fix(r.scenarios[name].ms))]),
          ['挂载（首次渲染）', ...results.map((r) => fix(r.mount))],
          ['卸载（停全部 effect）', ...results.map((r) => fix(r.dispose, 2))],
          ['挂载后堆内存增量 KB（GC 后，含 DOM）', ...results.map((r) => fix(r.heap / 1024, 0))],
          ['挂载后存活的 effect 数', ...results.map((r) => r.effects)],
        ],
      ),
    );
    console.log('\n每次状态变化平均：DOM 改动（按属性名）/ CSSOM 改动 / 引擎求值（evaluations）、换类（reshapes）、新建 effect 数\n');
    console.log(
      table(
        ['场景', ...results.map((r) => r.label)],
        scenarios.map(([name]) => [
          name,
          ...results.map((r) => {
            const { mutations, cssom, engine } = r.scenarios[name];
            return `DOM ${format(mutations)}；CSSOM ${format(cssom)}；求值 ${fix(engine.evaluations, 1)}，换类 ${fix(engine.reshapes, 1)}，新建 effect ${fix(engine.effectsCreated, 1)}`;
          }),
        ]),
      ),
    );
    console.log();
    // 部件级的“不重算”：配方只有读了档位的部件求值
    if (kind === 'buttons') {
      const recipeRun = results[0];
      const perButton = (name) => recipeRun.scenarios[name].engine.evaluations / ROWS;
      check('配方：切 size 每个按钮求值 2 次（root、icon），label 部件不求值', Math.abs(perButton('size') - 2) < 0.01, perButton('size'));
      check('配方：切 variant 每个按钮求值 1 次（只有 root 用到 variant）', Math.abs(perButton('variant') - 1) < 0.01, perButton('variant'));
      check('配方：无关状态一次求值都没有', recipeRun.scenarios.unrelated.engine.evaluations === 0, recipeRun.scenarios.unrelated);
    }
  }

  // ---- 语义：几种写法算出的样式一致 ----
  for (const [kind, modes] of [['rows', [['sx', split], ['sx', whole], ['hand', split], ['attr', split]]], ['buttons', [['recipe', split], ['sx', split]]]]) {
    const snapshots = [];
    for (const [mode, code] of modes) {
      const page = await openPage(browser, code);
      await page.evaluate(([k, m]) => window.api.mount(k, m, 60), [kind, mode]);
      const steps = kind === 'rows' ? ['widths', 'hot', 'theme', 'widths'] : ['size', 'variant', 'size'];
      const shots = [await page.evaluate(() => window.api.snapshot())];
      for (const name of steps) {
        await page.evaluate((n) => window.api.step(n), name);
        shots.push(await page.evaluate(() => window.api.snapshot()));
      }
      snapshots.push(shots);
      await page.close();
    }
    const same = snapshots.every((shots) => shots.every((shot, index) => JSON.stringify(shot) === JSON.stringify(snapshots[0][index])));
    check(`${kind === 'rows' ? '行' : '按钮'}：各种写法逐元素算出的样式一致（初始 + 每步状态变化后）`, same, snapshots.map((shots) => shots.map((shot) => shot.length)));
  }
}
