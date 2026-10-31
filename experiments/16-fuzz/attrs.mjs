// 方向 3：属性合并。随机若干层 props（普通值、undefined、null、false、数组 / 对象形式的 class、字符串 / 对象 style、事件、ref、sx、
// getter、函数动态层、omit），比较 spread 写到元素、viewOf 读出的值、ssrSpread 解析回来的结果，三路都要和独立写的参考模型一致；
// 然后改 getter / 动态层背后的 signal，增量更新的结果必须等于重新 spread，且不碰没变的属性。
import { fileURLToPath } from 'node:url';
import { makeRng } from './lib/rng.mjs';
import { bundleIife, launch, openPage } from './lib/page.mjs';

const U = { $: 'u' };
const POOLS = {
  title: ['a', 'b', '', 0, 1, true, false, null, U],
  'data-x': ['a', '', 0, false, null, U],
  'aria-label': ['p', 'q', true, false, null, U],
  hidden: [true, false, '', null, U, 'until-found', 0, 1],
  disabled: [true, false, null, U, ''],
  value: ['a', 'b', '', 0, 5, null, U, 'x y'],
  checked: [true, false, null, U, 1, 0],
  class: ['a', 'a b', '', ['x', false, 'y'], { $: 'obj', entries: { p: true, q: false, r: U } }, null, U, false, ['z', ['w', { $: 'obj', entries: { v: 1 } }]], 'dup dup', 'a  b'],
  style: [
    'color: red', 'color:red; margin-top:1px', 'margin: 1px', 'margin-top: 2px; color: blue', 'color: red !important', 'background-color: green', '',
    { $: 'obj', entries: { color: 'red' } }, { $: 'obj', entries: { marginTop: '2px' } }, { $: 'obj', entries: { margin: '1px' } }, { $: 'obj', entries: { color: null } },
    { $: 'obj', entries: { color: U } }, { $: 'obj', entries: { color: U, width: '3px' } }, { $: 'obj', entries: { '--x': '1' } }, { $: 'obj', entries: { color: 'red !important' } },
    { $: 'obj', entries: { width: '' } }, { $: 'obj', entries: { backgroundColor: 'blue' } }, null, U, false,
  ],
  sx: ['s1', 's2', ['s3', 's1'], null, U, false],
  href: ['/a', 'javascript:alert(1)', ' JaVa\tScript:x', null, U],
  translate: [true, false, 'yes', null, U],
};
POOLS.className = POOLS.class;
const KEYS = [...Object.keys(POOLS), 'onClick', 'ref'];
const NUMBER_VALUES = ['5', 10, 0, '', null, U, '3.5'];

/** 已知缺陷（见 bugs/）会让大量种子以同一种方式失败，默认绕开；--with-known-bugs 打开，修复后用来回归 */
const KNOWN = { enabled: false };
const SHORTHAND = (item) => typeof item === 'string' ? /(^|;)s*margins*:/.test(item) : item?.entries?.margin !== undefined;

function valueFor(rng, key, ctx) {
  if (key === 'onClick') return { $: 'h', id: ctx.next++, prevent: rng.chance(0.25), stop: KNOWN.enabled && rng.chance(0.2) };
  if (key === 'ref') return { $: 'r', id: ctx.next++ };
  let pool = key === 'value' && ctx.type === 'number' ? NUMBER_VALUES : POOLS[key];
  if (!KNOWN.enabled) {
    // bugs/003：样式简写（margin）和长写（margin-top）混用，撤掉长写时把简写给的值一起删了
    if (key === 'style') pool = pool.filter((item) => !SHORTHAND(item));
  }
  return rng.pick(pool);
}
function genProps(rng, universe, ctx, allowGetter) {
  const props = {};
  for (const key of rng.sample(universe, rng.range(0, 4))) {
    if (allowGetter && ctx.signals > 0 && key !== 'onClick' && key !== 'ref' && rng.chance(0.35)) {
      props[key] = { $: 'g', sig: rng.int(ctx.signals), pool: Array.from({ length: rng.range(2, 3) }, () => valueFor(rng, key, ctx)) };
    } else props[key] = valueFor(rng, key, ctx);
  }
  return props;
}

export function generate(seed) {
  const rng = makeRng(seed);
  const type = rng.pick(['text', 'text', 'checkbox', 'number']);
  const ctx = { next: 0, type, signals: rng.range(0, 3) };
  // bugs/002：复选框 / 单选框的 value 只要被撤掉（null、undefined、动态层换掉）就会写出 value=""
  const universe = rng.sample(KEYS.filter((key) => KNOWN.enabled || !(type === 'checkbox' && key === 'value')), rng.range(4, 9));
  const genLayer = (depth) => {
    const roll = rng.next();
    if (roll < 0.62 || depth > 0 && roll < 0.8) return { t: 'obj', props: genProps(rng, universe, ctx, true) };
    if (roll < 0.76 && ctx.signals > 0) return { t: 'fn', cond: rng.int(ctx.signals), a: genProps(rng, universe, ctx, true), b: genProps(rng, universe, ctx, true) };
    if (depth > 0) return { t: 'obj', props: genProps(rng, universe, ctx, true) };
    return { t: 'omit', hide: rng.sample(universe.filter((key) => key !== 'className'), rng.range(1, 2)), inner: Array.from({ length: rng.range(1, 2) }, () => genLayer(1)) };
  };
  const layers = Array.from({ length: rng.range(1, 5) }, () => genLayer(0));
  const steps = Array.from({ length: ctx.signals ? rng.range(2, 5) : 0 }, () => ({ set: Array.from({ length: rng.range(1, 3) }, () => [rng.int(ctx.signals), rng.int(6)]) }));
  return { tag: 'input', type, signals: Array.from({ length: ctx.signals }, () => rng.int(3)), layers, steps, direct: rng.chance(0.3) };
}

let browser;
let page;
async function evaluate(spec) {
  return page.evaluate((input) => window.attrsFuzz.runSpec(input), spec);
}
export const direction = {
  name: 'attrs',
  title: '属性合并',
  defaultSeeds: 400,
  shrinkBudget: 250,
  async setup() {
    const code = await bundleIife(fileURLToPath(new URL('./attrs-page.js', import.meta.url)));
    browser = await launch();
    page = await openPage(browser, code);
  },
  async teardown() {
    await browser?.close();
  },
  async check(seed, options = {}) {
    KNOWN.enabled = !!options['with-known-bugs'];
    const spec = generate(seed);
    const failures = await evaluate(spec);
    if (!failures.length) return { ok: true };
    return { ok: false, kind: failures[0].kind, message: JSON.stringify(failures[0].detail), caseData: spec };
  },
  async recheck(spec) {
    const failures = await evaluate(spec);
    return failures[0]?.kind;
  },
};
