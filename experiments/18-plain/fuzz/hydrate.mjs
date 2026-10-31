// 方向 4：水合（最重要）。随机组件树：嵌套元素、文本、相邻文本、函数子节点、when、For（带 by / 不带、初始为空）、Fragment、
// 组件（children、内容 prop、...rest、merge）、sx、select / textarea / input、svg、useId，条件初始为假。
// 流程：renderToString（Node）-> 页面解析 -> hydrate，断言 0 次 DOM 改动、节点身份不变、无报错；
// 再随机改状态若干轮（含模拟用户输入），每轮断言页面 DOM 与同样状态下新挂载的 DOM 规范化后相等。断言细节见 hydrate-page.js。
// 用例是纯 JSON：{ spec, init, rounds }。
import { makeRng } from './lib/rng.mjs';
import { bundleClient, launch, loadServer, openPage } from './lib/harness.mjs';

// ---- 词表 ----
const STR = ['a', 'b c', '', 'x&y', '<t>', '你好', '0', ' ', 'x\ny', '\nx'];
const WIDTHS = ['1px', '2px', '10px'];
const PICKS = ['a', 'b', 'c'];
const LABELS = ['a', 'b', 'c', 'x y', ''];
const STRINGS = ['s0', 's1', 's2'];
const BOOLS = ['b0', 'b1', 'b2'];
const LISTS = ['l0', 'l1'];

// ---- 生成 ----
class Gen {
  constructor(rng) {
    this.rng = rng;
  }
  text() {
    const r = this.rng;
    return r.chance(0.12) ? { t: 'text', num: r.pick([0, 1, 42]) } : { t: 'text', v: r.pick(STR) };
  }
  dyn() {
    const r = this.rng;
    if (r.chance(0.15)) return { t: 'dyn', ref: 'n0', mode: r.pick(['sig', 'fn']) };
    return { t: 'dyn', ref: r.pick(STRINGS), mode: r.weighted([['fn', 3], ['sig', 4], ['maybe', 2], ['prefix', 2]]) };
  }
  attrValue(name) {
    const r = this.rng;
    const staticOrDyn = () => (r.chance(0.55) ? { k: 's', v: r.pick(STR) } : { k: 'd', ref: r.pick(STRINGS), w: r.pick(['id', 'id', 'upper', 'nullIfEmpty', 'undefIfEmpty']) });
    switch (name) {
      case 'hidden':
        return { k: 'bool', ref: r.pick(BOOLS) };
      case 'class':
        return {
          k: 'cls',
          items: Array.from({ length: r.range(1, 3) }, () => r.pick([{ k: 's', v: r.pick(['a', 'b c', 'd']) }, { k: 'if', ref: r.pick(BOOLS), v: r.pick(['on', 'x y']), else: r.pick([false, null, 'off']) }, { k: 'd', ref: r.pick(STRINGS) }])),
        };
      case 'style':
        return {
          k: 'sty',
          e: Array.from({ length: r.range(1, 3) }, () =>
            r.pick([['width', { k: 'd', ref: 'w0' }], ['color', { k: 'if', ref: r.pick(BOOLS), v: 'red', else: 'blue' }], ['height', { k: 's', v: '2px' }], ['display', { k: 'if', ref: r.pick(BOOLS), v: 'none', else: null }], ['margin-top', { k: 'if', ref: r.pick(BOOLS), v: '4px', else: null }]]),
          ),
        };
      case 'sx':
        return { k: 'sx', items: Array.from({ length: r.range(1, 3) }, () => r.pick([{ k: 'root' }, { k: 'cond', ref: r.pick(BOOLS) }, { k: 'bar', ref: 'w0' }])) };
      case 'onClick':
        return { k: 'ev' };
      default:
        return staticOrDyn();
    }
  }
  attrs() {
    const r = this.rng;
    const out = {};
    for (const name of r.sample(['data-a', 'title', 'class', 'style', 'hidden', 'sx', 'aria-label', 'onClick'], r.weighted([[0, 4], [1, 4], [2, 2], [3, 1]]))) out[name] = this.attrValue(name);
    return out;
  }
  kids(ctx, depth, min = 1, max = 3) {
    return Array.from({ length: this.rng.range(min, max) }, () => this.node(ctx, depth));
  }
  /** 一行：For 的行模板。item / index 是行里才有的叶子 */
  row(ctx, depth) {
    const r = this.rng;
    // 行里除了本行的数据，还可能有条件、useId、嵌套的列表（只嵌一层：depth 为 0 时不再嵌）
    const leaf = () =>
      r.weighted([
        [{ t: 'item', f: 'label' }, 4],
        [{ t: 'index' }, 3],
        [{ t: 'text', v: '|' }, 2],
        [this.dyn(), 2],
        [{ t: 'sw', ref: r.pick(BOOLS), a: { t: 'item', f: 'label' }, ...(r.chance(0.5) ? { b: { t: 'text', v: '-' } } : {}) }, 1],
        [{ t: 'id', label: 'R' }, ctx === 'flow' ? 1 : 0],
        [{ t: 'for', ref: 'l1', by: r.chance(0.5), eachFn: false, row: { t: 'el', tag: 'span', kids: [{ t: 'item', f: 'label' }] } }, ctx === 'flow' && depth > 0 ? 1 : 0],
      ].filter(([, weight]) => weight > 0));
    const inner = () => Array.from({ length: r.range(1, 3) }, leaf);
    const attrs = r.chance(0.4) ? { 'data-a': { k: 'item', f: 'label' } } : {};
    if (ctx === 'list') return { t: 'el', tag: 'li', attrs, kids: depth > 0 && r.chance(0.3) ? [...inner(), this.node('flow', depth - 1)] : inner() };
    if (ctx === 'select') return { t: 'el', tag: 'option', attrs: { value: { k: 'item', f: 'label' } }, kids: [{ t: 'item', f: 'label' }] };
    if (r.chance(0.35)) return { t: 'frag', kids: [...inner(), ...(r.chance(0.5) ? inner() : [])] };
    // phrasing 里（p 的内部）不能放块级元素：解析器会自动闭合 p
    return { t: 'el', tag: ctx === 'flow' ? r.pick(['div', 'span']) : 'span', attrs, kids: inner() };
  }
  node(ctx, depth) {
    const r = this.rng;
    if (ctx === 'list') return this.listNode(depth);
    if (ctx === 'select') return this.optionNode(depth);
    if (ctx === 'svg') return this.svgNode(depth);
    const leaf = depth <= 0;
    const flow = ctx === 'flow';
    const kind = r.weighted([
      ['text', 12],
      ['dyn', 12],
      ['pair', 5],
      ['form', 6],
      ['id', 2],
      ...(leaf ? [] : [['inline', 10], ['sw', 12], ['when', 10], ['for', 10], ['frag', 7], ['comp', 10]]),
      ...(flow && !leaf ? [['block', 16], ['ul', 5], ['select', 3], ['svg', 3]] : []),
    ]);
    switch (kind) {
      case 'text':
        return this.text();
      case 'dyn':
        return this.dyn();
      case 'pair':
        return { t: 'frag', kids: Array.from({ length: r.range(2, 3) }, () => (r.chance(0.5) ? this.text() : r.chance(0.5) ? this.dyn() : this.text())) };
      case 'form':
        return this.form();
      case 'id':
        return { t: 'id', label: r.pick(['L', 'M']) };
      case 'inline':
        return { t: 'el', tag: r.pick(['span', 'b', 'em']), attrs: this.attrs(), kids: this.kids('phrasing', depth - 1, 0, 3) };
      case 'block': {
        const tag = r.pick(['div', 'div', 'section', 'p']);
        return { t: 'el', tag, attrs: this.attrs(), kids: this.kids(tag === 'p' ? 'phrasing' : 'flow', depth - 1, 0, 3) };
      }
      case 'ul':
        return { t: 'el', tag: 'ul', attrs: this.attrs(), kids: this.kids('list', depth - 1, 0, 3) };
      case 'sw':
        return { t: 'sw', ref: r.pick(BOOLS), a: this.node(ctx, depth - 1), ...(r.chance(0.6) ? { b: this.node(ctx, depth - 1) } : {}) };
      case 'when':
        return { t: 'when', ref: r.pick([...BOOLS, 's1']), then: this.node(ctx, depth - 1), ...(r.chance(0.5) ? { otherwise: this.node(ctx, depth - 1) } : {}) };
      case 'for':
        return { t: 'for', ref: r.pick(LISTS), by: r.chance(0.6), eachFn: r.chance(0.25), row: this.row(ctx, depth - 1) };
      case 'frag':
        return { t: 'frag', fragment: r.chance(0.5), kids: this.kids(ctx, depth - 1, 1, 3) };
      case 'comp':
        return this.comp(ctx, depth);
      case 'select':
        return { t: 'select', ref: 'p0', mode: r.pick(['two', 'two', 'one', 'static']), v: r.pick(PICKS), attrs: this.attrs(), kids: this.kids('select', depth - 1, 1, 3) };
      default:
        return { t: 'svg', attrs: r.chance(0.5) ? { class: this.attrValue('class') } : {}, kids: this.kids('svg', depth - 1, 1, 3) };
    }
  }
  form() {
    const r = this.rng;
    const mode = r.pick(['two', 'two', 'one', 'static']);
    const kind = r.pick(['input', 'input', 'checkbox', 'textarea']);
    if (kind === 'checkbox') return { t: 'checkbox', ref: r.pick(BOOLS), mode, v: r.chance(0.5), attrs: this.attrs() };
    return { t: kind, ref: r.pick(STRINGS), mode, v: r.pick(STR), attrs: this.attrs() };
  }
  comp(ctx, depth) {
    const r = this.rng;
    const flow = ctx === 'flow';
    const c = r.pick(flow ? ['Box', 'Card', 'Merged', 'Pass', 'Inline'] : ['Inline', 'Pass']);
    const kidsCtx = c === 'Inline' ? 'phrasing' : c === 'Pass' ? ctx : 'flow';
    const out = { t: 'comp', c, props: c === 'Pass' ? {} : this.attrs(), kids: this.kids(kidsCtx, depth - 1, r.pick([0, 1, 1, 2]), 3) };
    if (c === 'Card') out.title = r.pick([this.text(), this.dyn(), { t: 'el', tag: 'em', kids: [this.text()] }]);
    return out;
  }
  listNode(depth) {
    const r = this.rng;
    const kind = r.weighted([['li', 8], ['for', 6], ['sw', 3], ['when', 3], ['frag', 2]]);
    if (depth <= 0 && kind !== 'li' && kind !== 'for') return { t: 'el', tag: 'li', kids: [this.text()] };
    switch (kind) {
      case 'li':
        return { t: 'el', tag: 'li', attrs: this.attrs(), kids: this.kids('flow', depth - 1, 0, 2) };
      case 'for':
        return { t: 'for', ref: r.pick(LISTS), by: r.chance(0.6), eachFn: r.chance(0.25), row: this.row('list', depth - 1) };
      case 'sw':
        return { t: 'sw', ref: r.pick(BOOLS), a: this.listNode(depth - 1), ...(r.chance(0.6) ? { b: this.listNode(depth - 1) } : {}) };
      case 'when':
        return { t: 'when', ref: r.pick(BOOLS), then: this.listNode(depth - 1), ...(r.chance(0.5) ? { otherwise: this.listNode(depth - 1) } : {}) };
      default:
        return { t: 'frag', fragment: r.chance(0.5), kids: Array.from({ length: r.range(1, 2) }, () => this.listNode(depth - 1)) };
    }
  }
  optionNode(depth) {
    const r = this.rng;
    const kind = r.weighted([['option', 8], ['for', 5], ['sw', 2], ['when', 2], ['frag', 2]]);
    const option = () => {
      const value = r.pick(PICKS);
      return { t: 'el', tag: 'option', attrs: { value: { k: 's', v: value } }, kids: [{ t: 'text', v: value.toUpperCase() }] };
    };
    if (depth <= 0 || kind === 'option') return option();
    switch (kind) {
      case 'for':
        return { t: 'for', ref: r.pick(LISTS), by: r.chance(0.6), eachFn: false, row: this.row('select', 0) };
      case 'sw':
        return { t: 'sw', ref: r.pick(BOOLS), a: this.optionNode(depth - 1), ...(r.chance(0.6) ? { b: this.optionNode(depth - 1) } : {}) };
      case 'when':
        return { t: 'when', ref: r.pick(BOOLS), then: this.optionNode(depth - 1), ...(r.chance(0.5) ? { otherwise: this.optionNode(depth - 1) } : {}) };
      default:
        return { t: 'frag', fragment: r.chance(0.5), kids: Array.from({ length: r.range(1, 2) }, () => this.optionNode(depth - 1)) };
    }
  }
  /** svg 上下文：只放 path / circle / g（以及 sw / when 包起来的它们） */
  svgNode(depth) {
    const r = this.rng;
    const roll = r.next();
    if (roll < 0.7 || depth <= 0) return this.svgKid(Math.max(depth, 0));
    if (roll < 0.85) return { t: 'sw', ref: r.pick(BOOLS), a: this.svgKid(depth - 1), ...(r.chance(0.5) ? { b: this.svgKid(depth - 1) } : {}) };
    return { t: 'when', ref: r.pick(BOOLS), then: this.svgKid(depth - 1), ...(r.chance(0.5) ? { otherwise: this.svgKid(depth - 1) } : {}) };
  }
  svgKid(depth) {
    const r = this.rng;
    const dynamic = () => (r.chance(0.5) ? { k: 's', v: r.pick(['M0 0', 'M1 1L2 2']) } : { k: 'if', ref: r.pick(BOOLS), v: 'M0 0', else: 'M5 5' });
    const tag = depth > 0 ? r.pick(['path', 'circle', 'g']) : r.pick(['path', 'circle']);
    const attrs = tag === 'path' ? { d: dynamic() } : tag === 'circle' ? { r: { k: 's', v: '2' }, fill: { k: 'if', ref: r.pick(BOOLS), v: 'red', else: 'blue' } } : {};
    if (r.chance(0.3)) attrs.class = this.attrValue('class');
    return { t: 'el', tag, attrs, kids: tag === 'g' ? Array.from({ length: r.range(1, 2) }, () => this.svgKid(depth - 1)) : [] };
  }
}
function genList(rng, empty) {
  const ids = rng.sample([1, 2, 3, 4, 5, 6], empty ? 0 : rng.range(0, 4));
  return ids.map((id) => ({ id, label: rng.pick(LABELS) }));
}

export function generate(seed, options = {}) {
  const rng = makeRng(seed);
  const gen = new Gen(rng);
  const depth = options.depth ? Number(options.depth) : rng.range(2, 4);
  const spec = { t: 'frag', kids: gen.kids('flow', depth, 1, 4) };
  const init = {
    ...Object.fromEntries(STRINGS.map((name) => [name, rng.pick(STR)])),
    // 条件初始为假、列表初始为空都要多覆盖
    ...Object.fromEntries(BOOLS.map((name) => [name, rng.chance(0.4)])),
    n0: rng.pick([0, 1, 2]),
    w0: rng.pick(WIDTHS),
    p0: rng.pick(PICKS),
    ...Object.fromEntries(LISTS.map((name) => [name, genList(rng, rng.chance(0.35))])),
  };
  const rounds = Array.from({ length: rng.range(2, 6) }, () =>
    Array.from({ length: rng.range(1, 3) }, () => {
      const kind = rng.weighted([['str', 3], ['bool', 5], ['n', 1], ['w', 1], ['p', 1], ['list', 4], ['type', 2]]);
      if (kind === 'str') return { op: 'set', ref: rng.pick(STRINGS), v: rng.pick(STR) };
      if (kind === 'bool') return { op: 'toggle', ref: rng.pick(BOOLS) };
      if (kind === 'n') return { op: 'set', ref: 'n0', v: rng.pick([0, 1, 2, 3]) };
      if (kind === 'w') return { op: 'set', ref: 'w0', v: rng.pick(WIDTHS) };
      if (kind === 'p') return { op: 'set', ref: 'p0', v: rng.pick(PICKS) };
      if (kind === 'list') return { op: 'list', ref: rng.pick(LISTS), v: genList(rng, rng.chance(0.25)) };
      return { op: 'type', pick: rng.int(1000), v: rng.pick(STR) };
    }),
  );
  return { spec, init, rounds };
}

// ---- 校验：最小化时不能缩成缺字段的形状 ----
const KINDS = new Set(['text', 'dyn', 'sw', 'when', 'for', 'item', 'index', 'frag', 'el', 'comp', 'id', 'input', 'checkbox', 'textarea', 'select', 'svg']);
function validAttr(v, init) {
  const ref = (name) => typeof name === 'string' && name in init;
  switch (v?.k) {
    case 's':
      return typeof v.v === 'string';
    case 'd':
    case 'bool':
      return ref(v.ref);
    case 'if':
      return ref(v.ref) && 'v' in v;
    case 'item':
      return v.f === 'label';
    case 'cls':
      return Array.isArray(v.items) && v.items.every((item) => validAttr(item, init));
    case 'sty':
      return Array.isArray(v.e) && v.e.every((e) => Array.isArray(e) && typeof e[0] === 'string' && validAttr(e[1], init));
    case 'sx':
      return Array.isArray(v.items) && v.items.every((item) => item?.k === 'root' || (['cond', 'bar'].includes(item?.k) && ref(item.ref)));
    case 'ev':
      return true;
    default:
      return false;
  }
}
const BLOCK_TAGS = new Set(['div', 'section', 'p', 'ul', 'li', 'header']);
const BLOCK_COMPS = new Set(['Box', 'Card', 'Merged']);
function hasBlock(list) {
  return (list ?? []).some((kid) => (kid.t === 'el' && BLOCK_TAGS.has(kid.tag)) || (kid.t === 'comp' && BLOCK_COMPS.has(kid.c)) || (kid.t === 'for' && hasBlock([kid.row])) || hasBlock([kid.a, kid.b, kid.then, kid.otherwise].filter(Boolean)) || hasBlock(kid.kids));
}
function validNode(n, init) {
  if (!n || !KINDS.has(n.t)) return false;
  const ref = (name) => typeof name === 'string' && name in init;
  const optional = (x) => x === undefined || validNode(x, init);
  const kids = (list) => list === undefined || (Array.isArray(list) && list.every((kid) => validNode(kid, init)));
  const attrs = (a) => a === undefined || (typeof a === 'object' && Object.values(a).every((v) => validAttr(v, init)));
  switch (n.t) {
    case 'text':
      return typeof n.v === 'string' || typeof n.num === 'number';
    case 'dyn':
      return ref(n.ref) && ['fn', 'sig', 'maybe', 'prefix'].includes(n.mode);
    case 'sw':
      return ref(n.ref) && validNode(n.a, init) && optional(n.b);
    case 'when':
      return ref(n.ref) && validNode(n.then, init) && optional(n.otherwise);
    case 'for':
      return ref(n.ref) && Array.isArray(init[n.ref]) && validNode(n.row, init);
    case 'item':
      return n.f === 'label';
    case 'index':
      return true;
    case 'frag':
      return Array.isArray(n.kids) && kids(n.kids);
    case 'el':
      // option 要有 value；p 里不能出现块级内容（HTML 解析器会自动闭合 p，两边结构天然不同）
      return typeof n.tag === 'string' && attrs(n.attrs) && kids(n.kids) && (n.tag !== 'option' || !!n.attrs?.value) && (n.tag !== 'p' || !hasBlock(n.kids));
    case 'comp':
      return ['Box', 'Inline', 'Card', 'Pass', 'Merged'].includes(n.c) && attrs(n.props) && kids(n.kids) && optional(n.title);
    case 'id':
      return typeof n.label === 'string';
    case 'select':
      return ref(n.ref) && ['two', 'one', 'static', 'none'].includes(n.mode) && attrs(n.attrs) && kids(n.kids);
    case 'svg':
      return attrs(n.attrs) && kids(n.kids);
    default: // input / checkbox / textarea
      return ref(n.ref) && ['two', 'one', 'static', 'none'].includes(n.mode) && attrs(n.attrs);
  }
}
function validCase(c) {
  if (!c.init || typeof c.init !== 'object' || !validNode(c.spec, c.init) || !Array.isArray(c.rounds)) return false;
  const validList = (list) => Array.isArray(list) && list.every((item) => Number.isInteger(item?.id) && typeof item.label === 'string') && new Set(list.map((item) => item.id)).size === list.length;
  if (!LISTS.every((name) => validList(c.init[name]))) return false;
  return c.rounds.every((ops) => Array.isArray(ops) && ops.every((op) => (op.op === 'type' ? Number.isInteger(op.pick) : op.ref in c.init && (op.op === 'toggle' || (op.op === 'list' ? validList(op.v) : op.v !== undefined)))));
}

let browser;
let page;
let server;
export async function runCase(c, extra = {}) {
  let html;
  try {
    html = server.render(c.spec, c.init);
  } catch (error) {
    return { kind: 'ssr-exception', message: String(error.stack ?? error).split('\n').slice(0, 4).join(' | ') };
  }
  page.errors.length = 0;
  const result = await page.evaluate((input) => window.hydrateFuzz.run(input), { ...c, html, ...extra });
  if (!result.kind && page.errors.length) return { kind: 'page-error', message: page.errors.join(' | ') };
  return { ...result, html };
}

export const direction = {
  name: 'hydrate',
  title: '水合',
  defaultSeeds: 200,
  shrinkBudget: 500,
  async setup() {
    server = await loadServer('hydrate-server.js');
    browser = await launch();
    page = await openPage(browser, await bundleClient('hydrate-page.js'));
  },
  async teardown() {
    await browser?.close();
  },
  async check(seed, options) {
    const c = generate(seed, options);
    const result = await runCase(c, { skipSsrCompare: options?.['skip-ssr-compare'] === true });
    return result.kind ? { ok: false, kind: result.kind, message: `${result.message}\n     服务端 HTML：${(result.html ?? '').slice(0, 600)}`, caseData: c } : { ok: true, notes: result.notes };
  },
  async recheck(c) {
    if (!validCase(c)) return undefined;
    return (await runCase(c)).kind;
  },
};
