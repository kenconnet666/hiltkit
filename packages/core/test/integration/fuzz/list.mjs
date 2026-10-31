// 方向 2：列表（For）。带 by 与不带 × 行内形状（单个元素 / 两个元素 / 纯文本段）× 周围有没有兄弟节点 × 同一数据再挂一个反向的 For，
// 随机插入、删除、移动、交换、替换、排序、反转、清空、整体替换；每一步之前还会改一些行的本地状态、写几次中间值（同一批里应当没有效果）。
// 断言见 list-page.js。用例是纯 JSON：{ keyed, shape, siblings, twin, eachFn, inline, initial, steps }。
import { makeRng } from './lib/rng.mjs';
import { bundleClient, launch, openPage } from './lib/harness.mjs';

const LABELS = ['a', 'b', 'c', 'd', 'e', 'f', ''];

/** 生成器自己维护的数据：每个 id 只出现一次 */
function simulate(rng, items, nextId) {
  const fresh = () => ({ id: nextId.value++, label: rng.pick(LABELS) });
  const ops = [
    ['insert', 6],
    ['append', 3],
    ['prepend', 3],
    ['remove', 6],
    ['move', 6],
    ['swap', 6],
    ['relabel', 4],
    ['replace', 3],
    ['reverse', 1],
    ['shuffle', 2],
    ['sort', 1],
    ['clear', 1],
    ['setAll', 2],
    ['truncate', 1],
  ];
  const op = rng.weighted(ops);
  const list = items.map((item) => ({ ...item }));
  const n = list.length;
  switch (op) {
    case 'insert':
      list.splice(rng.range(0, n), 0, ...Array.from({ length: rng.range(1, 3) }, fresh));
      break;
    case 'append':
      list.push(fresh());
      break;
    case 'prepend':
      list.unshift(fresh());
      break;
    case 'remove':
      if (n) list.splice(rng.int(n), rng.range(1, Math.min(3, n)));
      break;
    case 'move':
      if (n > 1) list.splice(rng.int(n), 0, ...list.splice(rng.int(n), 1));
      break;
    case 'swap':
      if (n > 1) {
        const i = rng.int(n);
        let j = rng.int(n);
        if (j === i) j = (j + 1) % n;
        [list[i], list[j]] = [list[j], list[i]];
      }
      break;
    case 'relabel':
      if (n) list[rng.int(n)].label = rng.pick(LABELS);
      break;
    case 'replace':
      // 同下标换成全新的行（新 id）
      if (n) list[rng.int(n)] = fresh();
      break;
    case 'reverse':
      list.reverse();
      break;
    case 'shuffle':
      return { op, list: rng.shuffle(list) };
    case 'sort':
      list.sort((a, b) => a.id - b.id);
      break;
    case 'clear':
      list.length = 0;
      break;
    case 'truncate':
      list.length = rng.range(0, n);
      break;
    default: {
      // 整体替换：一部分沿用旧行（顺序随机），其余全新
      const kept = rng.sample(list, rng.range(0, n));
      const all = rng.shuffle([...kept, ...Array.from({ length: rng.range(0, 4) }, fresh)]);
      return { op, list: all };
    }
  }
  return { op, list };
}

/** options.inline：0 / 1 强制行内写法（默认随机） */
export function generate(seed, options = {}) {
  const rng = makeRng(seed);
  const nextId = { value: 1 };
  const initial = Array.from({ length: rng.range(0, 8) }, () => ({
    id: nextId.value++,
    label: rng.pick(LABELS),
  }));
  const c = {
    keyed: rng.chance(0.6),
    shape: rng.weighted([
      ['single', 6],
      ['multi', 2],
      ['text', 2],
    ]),
    siblings: rng.chance(0.5),
    twin: rng.chance(0.3),
    eachFn: rng.chance(0.3),
    inline: options.inline === undefined ? rng.chance(0.25) : options.inline === '1',
    initial,
    steps: [],
  };
  let list = initial;
  const seen = [...initial];
  for (let i = rng.range(4, 14); i > 0; i--) {
    const { op, list: next } = simulate(rng, list, nextId);
    seen.push(...next);
    c.steps.push({
      op,
      list: next,
      bump: Array.from(
        { length: rng.range(0, 3) },
        () => rng.pick([...list, ...next, { id: 0 }]).id,
      ),
      // 中间写入：用见过的行拼出来的随机列表（同 id 取最新那份没关系，反正不会被渲染）
      noise: Array.from({ length: rng.range(0, 2) }, () =>
        rng.sample(seen, rng.range(0, Math.min(6, seen.length))),
      ),
    });
    list = next;
  }
  return c;
}

let browser;
let page;
async function runCase(c) {
  page.errors.length = 0;
  const result = await page.evaluate((input) => window.listFuzz.run(input), c);
  if (!result.kind && page.errors.length)
    return { kind: 'page-error', message: page.errors.join(' | ') };
  return result;
}

export const direction = {
  name: 'list',
  title: '列表',
  defaultSeeds: 300,
  async setup() {
    browser = await launch();
    page = await openPage(browser, await bundleClient('list-page.js'));
  },
  async teardown() {
    await browser?.close();
  },
  async check(seed, options) {
    const c = generate(seed, options);
    const result = await runCase(c);
    return result.kind
      ? { ok: false, kind: result.kind, message: result.message, caseData: c }
      : { ok: true };
  },
  async recheck(c) {
    if (
      !['single', 'multi', 'text'].includes(c.shape) ||
      ![c.keyed, c.siblings, c.twin, c.eachFn, c.inline].every((flag) => typeof flag === 'boolean')
    )
      return undefined;
    if (
      !Array.isArray(c.initial) ||
      !Array.isArray(c.steps) ||
      !c.steps.every(
        (step) => Array.isArray(step.list) && Array.isArray(step.bump) && Array.isArray(step.noise),
      )
    )
      return undefined;
    const valid = (item) => Number.isInteger(item?.id) && typeof item.label === 'string';
    if (
      ![
        c.initial,
        ...c.steps.map((step) => step.list),
        ...c.steps.flatMap((step) => step.noise),
      ].every((items) => Array.isArray(items) && items.every(valid))
    )
      return undefined;
    if (!c.steps.every((step) => step.bump.every(Number.isInteger))) return undefined;
    // id 必须唯一，否则就成了“重复键”的另一个问题
    const unique = (items) => new Set(items.map((item) => item.id)).size === items.length;
    if (!unique(c.initial) || !c.steps.every((step) => unique(step.list))) return undefined;
    return (await runCase(c)).kind;
  },
};
