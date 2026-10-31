// 方向 3：属性。随机 merge 多层（普通值、undefined、null、false、class 的字符串/数组/对象/函数、style、事件、ref、函数值、Sig），
//   1. 客户端挂载的 DOM 与 renderToString 解析回来的是否同形
//   2. 改背后的 sig 若干轮，增量结果是否等于用当前值新挂载的结果
//   3. 与按 rules.js 文档语义推演的期望（有效属性值、class 集合、style、事件顺序、ref）是否一致
//   4. 销毁后 ref 清空、不再更新
// 用例是纯 JSON：{ spec, init, rounds }。
import { makeRng } from './lib/rng.mjs';
import { bundleClient, launch, loadServer, openPage } from './lib/harness.mjs';

// ---- 值的词表 ----
const V = {
  str: [{ s: '' }, { s: 'a' }, { s: 'b c' }, { s: 'x&y' }, { s: 'q"r' }, { s: '<t>' }, { s: 'é中' }, { s: '0' }, { n: 0 }, { n: 1 }, { n: -2 }, { b: true }, { b: false }, { z: 1 }, { u: 1 }],
  booly: [{ b: true }, { b: false }, { s: '' }, { s: 'x' }, { s: 'until-found' }, { z: 1 }, { u: 1 }, { n: 0 }, { n: 1 }],
  url: [{ s: '/p?a=1&b=2' }, { s: '#h' }, { s: 'javascript:alert(1)' }, { s: ' Java\tScript:x' }, { z: 1 }, { u: 1 }, { b: false }],
  path: [{ s: 'M0 0' }, { s: 'M1 1L2 2' }, { z: 1 }, { u: 1 }],
  num: [{ n: 0 }, { n: -1 }, { s: '3' }, { z: 1 }, { u: 1 }],
  state: [{ u: 1 }, { z: 1 }, { b: true }, { b: false }, { s: '' }, { s: 'a' }, { s: 'b c' }, { n: 0 }, { n: 1 }, { s: 'x&y' }, { s: 'red' }],
  cls: [{ s: 'a' }, { s: 'b c' }, { s: ' d ' }, { s: '' }, { s: 'a b' }, { b: false }, { b: true }, { z: 1 }, { u: 1 }, { n: 1 }],
  styleText: ['', 'color:red', 'margin:8px', 'margin-top:4px;color:blue', 'margin-top:0', 'color:', ';;', 'width:calc(1px + 2px)', 'background:url(data:image/png;base64,xx);color:red', 'COLOR : Red ; Margin-Left : 1px', 'margin:0;margin-top:4px', '--x:1;--y:a b'],
  styleKeys: ['color', 'margin', 'marginTop', 'margin-top', 'marginBottom', 'backgroundColor', '--x', 'width', 'paddingLeft', 'padding-left'],
  styleVals: [{ s: 'red' }, { s: 'blue' }, { s: '8px' }, { s: '4px' }, { s: '0' }, { n: 0 }, { n: 3 }, { s: '' }, { z: 1 }, { u: 1 }, { b: false }, { s: 'calc(1px + 2px)' }, { s: '1px !important' }],
};
const BOOL_KEYS = new Set(['hidden', 'disabled', 'readonly', 'required']);
const COMMON = ['id', 'title', 'data-x', 'aria-label', 'role', 'lang', 'tabindex', 'hidden', 'class', 'style', 'ref'];
const TAGS = [
  { tag: 'div', keys: [...COMMON, 'onClick'] },
  { tag: 'button', keys: [...COMMON, 'disabled', 'onClick', 'name'] },
  { tag: 'input', type: 'text', keys: [...COMMON, 'value', 'disabled', 'readonly', 'required', 'placeholder'] },
  { tag: 'input', type: 'checkbox', keys: [...COMMON, 'checked', 'value', 'disabled'] },
  { tag: 'textarea', keys: [...COMMON, 'value', 'disabled', 'readonly', 'placeholder'] },
  { tag: 'a', keys: [...COMMON, 'href', 'target'] },
  { tag: 'path', svg: true, keys: ['id', 'class', 'style', 'ref', 'd', 'fill', 'stroke-width', 'data-x', 'aria-label'] },
];
const STATE_NAMES = ['s0', 's1', 's2', 's3'];

/** fn 只放在最外层（或数组项、对象值）：函数返回函数不是正常写法，merge 也只展开一层 */
function genClass(rng, depth, top = true) {
  const roll = rng.next();
  if (roll < 0.4 || depth <= 0) return { c: 'lit', v: rng.pick(V.cls) };
  if (roll < 0.6) return { c: 'arr', items: Array.from({ length: rng.range(0, 3) }, () => genClass(rng, depth - 1, true)) };
  if (roll < 0.8) {
    return { c: 'obj', e: Array.from({ length: rng.range(1, 3) }, () => [rng.pick(['a', 'b', 'c', 'd']), rng.chance(0.5) ? { c: 'lit', v: rng.pick([{ b: true }, { b: false }, { z: 1 }, { n: 1 }]) } : { c: 'fn', ref: rng.pick(STATE_NAMES), a: { c: 'lit', v: { b: true } }, b: { c: 'lit', v: { b: false } } }]) };
  }
  if (!top) return { c: 'lit', v: rng.pick(V.cls) };
  return { c: 'fn', ref: rng.pick(STATE_NAMES), a: genClass(rng, depth - 1, false), b: genClass(rng, depth - 1, false) };
}
function genStyle(rng, depth, top = true) {
  const roll = rng.next();
  if (roll < 0.3 || depth <= 0) return { c: 'lit', v: rng.chance(0.15) ? rng.pick([{ z: 1 }, { u: 1 }, { b: false }]) : { s: rng.pick(V.styleText) } };
  if (roll < 0.8) {
    // 同一个对象里 camelCase 和 kebab-case 同时出现、长短写同时出现，都是真实写法
    const e = Array.from({ length: rng.range(1, 3) }, () => [rng.pick(V.styleKeys), rng.chance(0.15) ? { fnv: rng.pick(STATE_NAMES) } : rng.pick(V.styleVals)]);
    return { c: 'obj', e };
  }
  if (!top) return { c: 'lit', v: { s: rng.pick(V.styleText) } };
  return { c: 'fn', ref: rng.pick(STATE_NAMES), a: genStyle(rng, depth - 1, false), b: genStyle(rng, depth - 1, false) };
}

let counter = 0;
function genValue(rng, key) {
  if (key === 'class') return { k: 'cls', c: genClass(rng, 2) };
  if (key === 'style') return { k: 'sty', c: genStyle(rng, 2) };
  if (key === 'onClick') return { k: 'ev', id: `e${counter++}`, prevent: rng.chance(0.3) };
  if (key === 'ref') return rng.chance(0.7) ? { k: 'ref', id: `f${counter++}` } : { k: 'refsig', ref: rng.pick(['r0', 'r1']) };
  const pool = key === 'd' ? V.path : BOOL_KEYS.has(key) ? V.booly : key === 'href' ? V.url : key === 'tabindex' ? V.num : V.str;
  const roll = rng.next();
  if (roll < 0.5) return { k: 'lit', v: rng.pick(pool) };
  if (roll < 0.75) return { k: 'fn', ref: rng.pick(STATE_NAMES), wrap: rng.weighted([['id', 4], ['upper', 1], ['blank', 2], ['const', 1]]), v: rng.pick(pool) };
  if (roll < 0.9) return { k: 'sig', ref: rng.pick(STATE_NAMES) };
  return { k: 'lit', v: rng.pick([{ u: 1 }, { z: 1 }]) };
}

export function generate(seed) {
  counter = 0;
  const rng = makeRng(seed);
  const shape = rng.pick(TAGS);
  const spec = { tag: shape.tag, layers: [], viaMerge: false };
  if (shape.type) spec.type = shape.type;
  if (shape.svg) spec.svg = true;
  for (let i = rng.weighted([[1, 2], [2, 4], [3, 3], [4, 1]]); i > 0; i--) {
    const layer = {};
    for (const key of rng.sample(shape.keys, rng.range(1, 6))) layer[key] = genValue(rng, key);
    spec.layers.push(layer);
  }
  spec.viaMerge = spec.layers.length === 1 && rng.chance(0.5);
  const init = { ...Object.fromEntries(STATE_NAMES.map((name) => [name, rng.pick(V.state)])), r0: { z: 1 }, r1: { z: 1 } };
  const rounds = Array.from({ length: rng.range(1, 4) }, () => Array.from({ length: rng.range(1, 3) }, () => ({ ref: rng.pick(STATE_NAMES), v: rng.pick(V.state) })));
  return { spec, init, rounds };
}

// ---- 结构校验：最小化时不能把用例缩成非法形状（缺字段的值描述会被当成另一种东西执行）----
const validTag = (t) => !!t && typeof t === 'object' && ['s', 'n', 'b', 'z', 'u'].some((key) => key in t);
const validClass = (c) =>
  !!c && (c.c === 'lit' ? validTag(c.v) : c.c === 'arr' ? Array.isArray(c.items) && c.items.every(validClass) : c.c === 'obj' ? Array.isArray(c.e) && c.e.every((e) => Array.isArray(e) && typeof e[0] === 'string' && validClass(e[1])) : typeof c.ref === 'string' && validClass(c.a) && validClass(c.b));
const validStyle = (c) =>
  !!c && (c.c === 'lit' ? validTag(c.v) : c.c === 'obj' ? Array.isArray(c.e) && c.e.every((e) => Array.isArray(e) && typeof e[0] === 'string' && (typeof e[1]?.fnv === 'string' || validTag(e[1]))) : typeof c.ref === 'string' && validStyle(c.a) && validStyle(c.b));
function validValue(v) {
  switch (v?.k) {
    case 'lit':
      return validTag(v.v);
    case 'fn':
    case 'sig':
    case 'refsig':
      return typeof v.ref === 'string';
    case 'cls':
      return validClass(v.c);
    case 'sty':
      return validStyle(v.c);
    case 'ev':
    case 'ref':
      return typeof v.id === 'string';
    default:
      return false;
  }
}
function validCase(c) {
  if (typeof c.spec?.tag !== 'string' || !Array.isArray(c.spec.layers) || !c.spec.layers.length || !c.init || !Array.isArray(c.rounds)) return false;
  if (!c.spec.layers.every((layer) => Object.values(layer).every(validValue))) return false;
  if (!Object.values(c.init).every(validTag)) return false;
  return c.rounds.every((ops) => Array.isArray(ops) && ops.every((op) => op.ref in c.init && validTag(op.v)));
}

let browser;
let page;
let server;
async function renderAll(c) {
  let current = c.init;
  const out = [server.render(c.spec, current)];
  for (const ops of c.rounds) {
    current = { ...current, ...Object.fromEntries(ops.map((op) => [op.ref, op.v])) };
    out.push(server.render(c.spec, current));
  }
  return out;
}
async function runCase(c) {
  let ssr;
  try {
    ssr = await renderAll(c);
  } catch (error) {
    return { kind: 'ssr-exception', message: String(error.stack ?? error).split('\n').slice(0, 4).join(' | ') };
  }
  page.errors.length = 0;
  const result = await page.evaluate((input) => window.attrsFuzz.run(input), { ...c, ssr });
  if (!result.kind && page.errors.length) return { kind: 'page-error', message: page.errors.join(' | ') };
  return result;
}

export const direction = {
  name: 'attrs',
  title: '属性',
  defaultSeeds: 300,
  async setup() {
    server = await loadServer('attrs-server.js');
    browser = await launch();
    page = await openPage(browser, await bundleClient('attrs-page.js'));
  },
  async teardown() {
    await browser?.close();
  },
  async check(seed) {
    const c = generate(seed);
    const result = await runCase(c);
    return result.kind ? { ok: false, kind: result.kind, message: result.message, caseData: c } : { ok: true, notes: result.notes };
  },
  async recheck(c) {
    if (!validCase(c)) return undefined;
    return (await runCase(c)).kind;
  },
};
