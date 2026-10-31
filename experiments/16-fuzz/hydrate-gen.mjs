// 方向 4 的生成器：随机组件树 -> TSX 源码。用例是 JSON（状态声明 + 节点树 + 若干轮操作），可最小化；
// 同一份源码分别用编译器的 client / server 两种产物编译。
// 内容模型（哪里能放什么）按 HTML 解析规则收着生成：服务端输出的 HTML 经解析器再造出来的树必须和客户端建的树同形，
// 否则差异来自“HTML 不允许这样嵌套”，不是水合缺陷（p 里不放块级、ul 里只放 li、select 里只放 option……）。
import { makeRng } from './lib/rng.mjs';

const STR_POOL = ['', 'abc', 'x y', 'a<b', 'q&r', '"q"', 'hello world', '0', 'é中文', ' pad '];
const WORDS = ['hello', 'a b', 'x', '中文', '1', 'tail', 'a&b', '<tag>', "it's", '"q"', '  sp ', 'end '];
const TAGS_FLOW = ['div', 'section', 'span', 'b', 'p'];
const TAGS_PHRASING = ['span', 'b', 'i', 'em'];

/** 库组件：编译产物里每个都是一个 _component；slot 说明 children 能放哪一类内容 */
export const LIBRARY = {
  Box: { slot: 'flow', context: 'flow' }, //        <div title {...rest}>{children}</div>
  Tag: { slot: 'phrasing', context: 'phrasing' }, // <span {...rest}>{children}</span>
  Pass: { slot: 'same', context: 'any' }, //        直接返回 children
  Pair: { slot: 'flow', context: 'flow', header: 'phrasing' }, // 内容 prop header + children
  Maybe: { slot: 'flow', context: 'flow' }, //      片段根：{when && <hr/>}{when ? children : null}
  Item: { slot: 'phrasing', context: 'list' }, //   <li>{children}</li>，用在 ul 里
  Labelled: { slot: undefined, context: 'any' }, // useId：<label for>/<input id>
  Counter: { slot: undefined, context: 'phrasing' }, // _derived
};

/** 已知缺陷（见 bugs/）会让大量种子以同一种方式失败，默认绕开；--with-known-bugs 打开，修复后用来回归 */
const KNOWN = { enabled: false };

export function generate(seed, options = {}) {
  KNOWN.enabled = !!options['with-known-bugs'];
  const rng = makeRng(seed);
  const states = [];
  const add = (type, init) => {
    const name = { str: 's', bool: 'n', num: 'k', list: 'l', pick: 'p', bomb: 'x' }[type] + states.filter((s) => s.type === type).length;
    states.push({ name, type, init });
    return name;
  };
  for (let i = rng.range(1, 3); i > 0; i--) add('str', rng.pick(STR_POOL));
  for (let i = rng.range(1, 3); i > 0; i--) add('bool', rng.chance(0.5));
  for (let i = rng.range(1, 2); i > 0; i--) add('num', rng.int(4));
  let nextId = 1;
  const newRow = () => ({ id: nextId++, t: rng.pick(['a', 'b', 'c', 'd', 'e']), v: rng.int(5) });
  for (let i = rng.range(1, 2); i > 0; i--) add('list', Array.from({ length: rng.chance(0.3) ? 0 : rng.range(1, 4) }, newRow));
  if (rng.chance(0.8)) add('pick', rng.pick(['a', 'b', 'c']));
  const names = (type) => states.filter((s) => s.type === type).map((s) => s.name);

  const features = { sx: false, lazy: new Set(), boundary: false };
  const counters = { click: 0, bind: 0, key: 0 };

  // ---- 表达式（直接是源码字符串；row 作用域里多出 it / i）
  const strExpr = (row) => {
    const options = [[() => rng.pick(names('str')), 4], [() => `${rng.pick(names('str'))} + ${rng.pick(names('num'))}`, 1], [() => `${rng.pick(names('bool'))} ? ${rng.pick(names('str'))} : 'no'`, 2], [() => `${rng.pick(names('str'))}.toUpperCase()`, 1], [() => JSON.stringify(rng.pick(WORDS)), 1]];
    if (row) options.push([() => 'it.t', 4], [() => '`${it.t}-${i}`', 2], [() => 'String(it.v)', 2]);
    return rng.weighted(options)();
  };
  const boolExpr = (row) => {
    const options = [[() => rng.pick(names('bool')), 5], [() => `!${rng.pick(names('bool'))}`, 2], [() => `${rng.pick(names('num'))} > 1`, 2], [() => `${rng.pick(names('str'))}.length > 2`, 1], [() => `${rng.pick(names('list'))}.length > 0`, 2], [() => `${rng.pick(names('bool'))} && ${rng.pick(names('bool'))}`, 1]];
    if (row) options.push([() => 'it.v > 2', 3], [() => 'i % 2 === 0', 2]);
    return rng.weighted(options)();
  };
  const numExpr = (row) => {
    const options = [[() => rng.pick(names('num')), 4], [() => `${rng.pick(names('num'))} + 1`, 1], [() => `${rng.pick(names('list'))}.length`, 2], [() => `${rng.pick(names('str'))}.length`, 1]];
    if (row) options.push([() => 'it.v', 3], [() => 'i', 2]);
    return rng.weighted(options)();
  };
  /** 文本位置的动态值：字符串、数字、布尔（不渲染）、短路表达式 */
  const textExpr = (row) =>
    rng.weighted([
      [() => strExpr(row), 5],
      [() => numExpr(row), 3],
      [() => boolExpr(row), 1],
      [() => `${rng.pick(names('bool'))} && ${JSON.stringify(rng.pick(WORDS))}`, 2],
      [() => `${rng.pick(names('bool'))} ? ${JSON.stringify(rng.pick(WORDS))} : ${JSON.stringify(rng.pick(WORDS))}`, 2],
      [() => (KNOWN.enabled ? `${rng.pick(names('num'))} && 'n'` : `${rng.pick(names('bool'))} && 'n'`), 1],
    ])();

  // ---- 属性
  const classAttr = (row) =>
    rng.weighted([
      [() => ({ k: 'class', v: { s: rng.pick(['a', 'a b', 'box']) } }), 3],
      [() => ({ k: 'class', v: { e: `['c', ${boolExpr(row)} && 'on', ${strExpr(row)}]` } }), 2],
      [() => ({ k: 'class', v: { e: `${boolExpr(row)} ? 'x' : 'y'` } }), 2],
      // bugs/013：属性值直接是符文变量的对象字面量会丢掉 effect，默认包一层 !!(…)
      [() => ({ k: 'class', v: { e: KNOWN.enabled ? `{ p: ${boolExpr(row)}, q: ${boolExpr(row)} }` : `{ p: !!(${boolExpr(row)}), q: !!(${boolExpr(row)}) }` } }), 1],
    ])();
  const styleAttr = (row) =>
    rng.weighted([
      [() => ({ k: 'style', v: { s: 'color: green' } }), 2],
      [() => ({ k: 'style', v: { e: `{ color: ${boolExpr(row)} ? 'red' : 'blue' }` } }), 2],
      [() => ({ k: 'style', v: { e: `{ width: ${numExpr(row)} + 'px', marginTop: ${boolExpr(row)} ? '2px' : undefined }` } }), 2],
    ])();
  const genericAttrs = (row, tag, allowSx = true) => {
    const attrs = [];
    const pool = [
      [() => classAttr(row), 3],
      [() => styleAttr(row), 2],
      [() => ({ k: 'title', v: { e: strExpr(row) } }), 2],
      [() => ({ k: 'title', v: { s: 'plain' } }), 1],
      [() => ({ k: 'data-a', v: { e: textExpr(row) } }), 2],
      [() => ({ k: 'hidden', v: { e: boolExpr(row) } }), 1],
      [() => ({ k: 'aria-label', v: { e: strExpr(row) } }), 1],
      [() => ({ spread: `${boolExpr(row)} ? { title: ${strExpr(row)} } : { 'data-b': ${strExpr(row)} }` }), 1],
      [() => ({ spread: `{ 'data-s': ${strExpr(row)}, class: ${boolExpr(row)} ? 'sp' : undefined }` }), 1],
    ];
    if (allowSx) pool.push([() => ((features.sx = true), { k: 'sx', v: { e: `[styles.a, ${boolExpr(row)} && styles.b, styles.w(${numExpr(row)} + 'px')]` } }), 1]);
    for (let i = rng.weighted([[0, 3], [1, 3], [2, 2], [3, 1]]); i > 0; i--) {
      const attr = rng.weighted(pool)();
      if (attr.k && attrs.some((other) => other.k === attr.k)) continue;
      attrs.push(attr);
    }
    void tag;
    return attrs;
  };

  // ---- 节点
  const text = () => ({ t: 'text', s: rng.pick(WORDS) });
  /** 作为属性值（header={...}）的内容：文本、动态文本或一个元素 */
  const leaf = (row) => (rng.chance(0.4) ? text() : rng.chance(0.4) ? dynText(row) : { t: 'el', tag: rng.pick(TAGS_PHRASING), attrs: [], kids: [rng.chance(0.5) ? text() : dynText(row)] });
  const dynText = (row) => ({ t: 'expr', e: textExpr(row) });

  function children(ctx, depth, row, max = 4) {
    const out = [];
    for (let i = rng.range(0, max); i > 0; i--) out.push(node(ctx, depth, row));
    return out;
  }

  function node(ctx, depth, row) {
    if (ctx === 'list') return listChild(depth, row);
    if (ctx === 'option') return optionChild(depth, row);
    if (ctx === 'svg') return svgChild(depth, row);
    if (ctx === 'text') return rng.chance(0.5) ? text() : dynText(row);
    const phrasing = ctx === 'phrasing';
    if (depth <= 0) return rng.chance(0.5) ? text() : dynText(row);
    const options = [
      [() => text(), 2],
      [() => dynText(row), 3],
      [() => element(ctx, depth, row), 5],
      [() => cond(ctx, depth, row), 4],
      [() => list(ctx, depth, row), 3],
      [() => ({ t: 'frag', kids: children(ctx, depth - 1, row, 3) }), 1],
      [() => component(ctx, depth, row), 3],
      [() => form(row), 2],
      [() => ({ t: 'el', tag: rng.pick(['br', 'hr']), attrs: [], kids: [], void: true }), phrasing ? 0 : 0.5],
    ];
    if (!phrasing) options.push([() => svg(depth, row), 1], [() => lazyNode(ctx, depth, row), 1.5], [() => boundary(ctx, depth, row), 1]);
    return rng.weighted(options)();
  }

  function element(ctx, depth, row) {
    const phrasing = ctx === 'phrasing';
    const tag = rng.pick(phrasing ? TAGS_PHRASING : TAGS_FLOW.concat(['ul', 'button', 'button']));
    const el = { t: 'el', tag, attrs: genericAttrs(row, tag), kids: [] };
    if (tag === 'ul') {
      el.kids = children('list', depth - 1, row, 3);
    } else if (tag === 'p' || tag === 'button') {
      el.kids = children('phrasing', depth - 1, row, 3);
      if (tag === 'button') {
        const id = counters.click++;
        const target = rng.chance(0.5) ? rng.pick(names('num')) : undefined;
        el.attrs.push({ k: 'data-click', v: { s: String(id) } }, { k: 'onClick', v: { e: target ? `() => (${target} = ${target} + 1)` : `() => (${rng.pick(names('bool'))} = !${rng.pick(names('bool'))})` } });
        void target;
      }
    } else {
      el.kids = children(phrasing || ['span', 'b', 'i', 'em'].includes(tag) ? 'phrasing' : 'flow', depth - 1, row, 4);
    }
    if (rng.chance(0.06) && tag === 'div') el.attrs.push({ k: 'innerHTML', v: { s: '<b>raw</b>' } }), (el.kids = []);
    return el;
  }

  const dynamic = { depth: 0 };
  function cond(ctx, depth, row) {
    const form = rng.weighted([['and', 4], ['tern', 4], ['ternNull', 2], ['ternNullFirst', 1], ['andNum', KNOWN.enabled ? 1.5 : 0]]);
    const test = form === 'andNum' ? rng.pick(names('num')) : boolExpr(row);
    dynamic.depth++;
    const branches = { t: 'cond', form, test, a: node(ctx, depth - 1, row), b: node(ctx, depth - 1, row) };
    dynamic.depth--;
    return branches;
  }

  function list(ctx, depth, row) {
    if (row) return text(); // 不嵌套列表：行里再套列表会让下标 / item 作用域翻倍，价值不大
    const phrasing = ctx === 'phrasing';
    const keyed = rng.chance(0.5);
    const rowTag = phrasing ? 'span' : rng.pick(['div', 'span', 'p']);
    const rowEl = { t: 'el', tag: rowTag, attrs: genericAttrs({}, rowTag, false).slice(0, 1), kids: [] };
    dynamic.depth++;
    rowEl.kids = children(rowTag === 'div' ? 'flow' : 'phrasing', depth - 1, { row: true }, 3);
    dynamic.depth--;
    return { t: 'list', src: rng.pick(names('list')), keyed, row: rowEl, wrap: rng.weighted([['plain', 5], ['tern', 2], ['and', 1]]), fallback: node(ctx, 0, undefined), test: boolExpr(undefined) };
  }

  function listChild(depth, row) {
    const roll = rng.next();
    const liAttrs = () => genericAttrs(row, 'li', false).slice(0, 1);
    const li = () => ({ t: 'el', tag: 'li', attrs: liAttrs(), kids: children('flow', Math.max(0, depth - 1), row, 2) });
    if (roll < 0.4 || depth <= 0) return li();
    if (roll < 0.6) return { t: 'cond', form: rng.pick(['and', 'tern', 'ternNull']), test: boolExpr(row), a: li(), b: li() };
    if (roll < 0.85 && !row) {
      const keyed = rng.chance(0.5);
      const rowEl = { t: 'el', tag: 'li', attrs: [], kids: children('phrasing', Math.max(0, depth - 1), { row: true }, 2) };
      return { t: 'list', src: rng.pick(names('list')), keyed, row: rowEl, wrap: 'plain', fallback: li(), test: boolExpr(undefined) };
    }
    return { t: 'comp', name: 'Item', props: [{ k: 'label', v: { e: strExpr(row) } }], kids: children('phrasing', Math.max(0, depth - 1), row, 2) };
  }

  function optionChild(depth, row) {
    void depth;
    const option = () => ({ t: 'el', tag: 'option', attrs: [{ k: 'value', v: { s: rng.pick(KNOWN.enabled ? ['a', 'b', 'c', 'd'] : ['d', 'e']) } }], kids: [text()] });
    const roll = rng.next();
    if (roll < 0.5 || row) return option();
    if (roll < 0.75) return { t: 'cond', form: rng.pick(['and', 'tern']), test: boolExpr(undefined), a: option(), b: option() };
    const rowEl = { t: 'el', tag: 'option', attrs: [{ k: 'value', v: { e: KNOWN.enabled ? 'it.t' : "'m' + it.id" } }], kids: [{ t: 'expr', e: 'it.t' }] };
    return { t: 'list', src: rng.pick(names('list')), keyed: rng.chance(0.5), row: rowEl, wrap: 'plain', fallback: option(), test: boolExpr(undefined) };
  }

  function svgChild(depth, row) {
    const shape = () => {
      const tag = rng.pick(['circle', 'rect', 'path', 'g']);
      const attrs = [];
      if (tag === 'circle') attrs.push({ k: 'r', v: { e: `${numExpr(row)} + 1` } });
      if (tag === 'rect') attrs.push({ k: 'width', v: { e: numExpr(row) } });
      if (tag === 'path') attrs.push({ k: 'd', v: { e: `${boolExpr(row)} ? 'M0 0' : 'M1 1'` } });
      if (rng.chance(0.4)) attrs.push(classAttr(row));
      const el = { t: 'el', tag, attrs, kids: [] };
      if (tag === 'g' && depth > 0) el.kids = children('svg', depth - 1, row, 2);
      return el;
    };
    const roll = rng.next();
    if (roll < 0.45 || depth <= 0) return shape();
    if (roll < 0.65) return { t: 'cond', form: rng.pick(['and', 'tern']), test: boolExpr(row), a: shape(), b: shape() };
    if (roll < 0.8 && !row) return { t: 'list', src: rng.pick(names('list')), keyed: rng.chance(0.5), row: { t: 'el', tag: 'circle', attrs: [{ k: 'r', v: { e: 'it.v + 1' } }], kids: [] }, wrap: 'plain', fallback: shape(), test: boolExpr(undefined) };
    return { t: 'el', tag: 'text', attrs: [], kids: [dynText(row)] };
  }

  function svg(depth, row) {
    return { t: 'el', tag: 'svg', attrs: [{ k: 'viewBox', v: { s: '0 0 10 10' } }, ...(rng.chance(0.5) ? [classAttr(row)] : [])], kids: children('svg', depth - 1, row, 3) };
  }

  function form(row) {
    const kind = rng.weighted([['text', 3], ['check', 2], ['textarea', 2], ['select', 4], ['number', 1.5], ['oneway', 2]]);
    const out = { t: 'form', kind, attrs: [] };
    if (kind === 'text' || kind === 'textarea') {
      out.bind = rng.pick(names('str'));
      out.id = counters.bind++;
    } else if (kind === 'check') {
      out.bind = rng.pick(names('bool'));
      out.id = counters.bind++;
    } else if (kind === 'number') {
      out.bind = rng.pick(names('num'));
      out.id = counters.bind++;
    } else if (kind === 'select') {
      const pick = names('pick')[0];
      if (!pick) return { t: 'form', kind: 'text', bind: rng.pick(names('str')), id: counters.bind++, attrs: [] };
      out.bind = pick;
      out.id = counters.bind++;
      out.options = [{ t: 'el', tag: 'option', attrs: [{ k: 'value', v: { s: 'a' } }], kids: [{ t: 'text', s: 'A' }] }, ...children('option', 1, undefined, 3), { t: 'el', tag: 'option', attrs: [{ k: 'value', v: { s: 'b' } }], kids: [{ t: 'text', s: 'B' }] }, { t: 'el', tag: 'option', attrs: [{ k: 'value', v: { s: 'c' } }], kids: [{ t: 'text', s: 'C' }] }];
    } else {
      out.kind = rng.pick(['textarea1', 'input1', 'check1']);
      out.e = out.kind === 'check1' ? boolExpr(row) : strExpr(row);
    }
    if (rng.chance(0.4)) out.attrs = genericAttrs(row, 'input', false).slice(0, 1);
    return out;
  }

  function component(ctx, depth, row) {
    const phrasing = ctx === 'phrasing';
    // bugs/012：更新时才创建的片段里 useId 抛错，所以 Labelled 只放在不会被条件 / 列表“更新时才创建”的位置
    const names2 = Object.keys(LIBRARY).filter((name) => (LIBRARY[name].context === 'any' || LIBRARY[name].context === ctx) && name !== 'Item' && (KNOWN.enabled || name !== 'Labelled' || dynamic.depth === 0));
    const name = rng.pick(names2);
    const spec = LIBRARY[name];
    const slotCtx = spec.slot === 'same' ? ctx : spec.slot;
    const comp = { t: 'comp', name, props: [], kids: [] };
    if (name === 'Box' || name === 'Tag') {
      comp.props = [{ k: 'title', v: { e: strExpr(row) } }, ...genericAttrs(row, 'div', true).filter((a) => !a.k || a.k !== 'title')];
      if (name === 'Box' && rng.chance(0.3)) comp.props.push({ spread: `{ 'data-r': ${strExpr(row)} }` });
    }
    if (name === 'Pair') comp.props = [{ k: 'header', v: { node: leaf(row) } }];
    if (name === 'Maybe') comp.props = [{ k: 'when', v: { e: boolExpr(row) } }];
    if (name === 'Labelled') comp.props = [{ k: 'label', v: { e: strExpr(row) } }];
    if (name === 'Counter') comp.props = [{ k: 'n', v: { e: numExpr(row) } }];
    if (slotCtx) comp.kids = children(slotCtx, depth - 1, row, 3);
    // Pass 在组件体里直接返回 children：children 只有一个非 JSX 的动态值（{a && 'x'}）时编译成 getter，
    // 组件体只读一次，之后不再更新（开发期有“组件体顶层读响应式数据”提示）。属于语义差异，凑够两个子节点就会变成内容函数数组
    if (name === 'Pass' && comp.kids.length === 1 && ['expr', 'text', 'cond'].includes(comp.kids[0].t)) comp.kids.push({ t: 'el', tag: slotCtx === 'phrasing' ? 'i' : 'div', attrs: [], kids: [] });
    void phrasing;
    return comp;
  }

  /** 同一个 lazy 在整棵树里只用一次：别处已经加载完（loaded 为真）时，另一个实例在水合里走到 bugs/006 */
  const lazyStack = [];
  function lazyNode(ctx, depth, row) {
    const combos = ['load', 'idle', 'visible'].flatMap((h) => ['Box', 'Pair'].map((i) => `${h}:${i}`)).filter((name) => KNOWN.enabled || !features.lazy.has(name));
    if (!combos.length) return element(ctx, depth, row);
    const [hydrate, inner] = rng.pick(combos).split(':');
    features.lazy.add(`${hydrate}:${inner}`);
    const comp = { t: 'lazy', hydrate, inner, props: inner === 'Pair' ? [{ k: 'header', v: { node: leaf(row) } }] : [{ k: 'title', v: { e: strExpr(row) } }], kids: (lazyStack.push(`${hydrate}:${inner}`), children('flow', depth - 1, row, 3)), fallback: { t: 'el', tag: 'span', attrs: [], kids: [{ t: 'text', s: 'wait' }] } };
    lazyStack.pop();
    void ctx;
    return comp;
  }

  function boundary(ctx, depth, row) {
    features.boundary = true;
    const throws = rng.chance(0.25);
    const kids = children(ctx, depth - 1, row, 3);
    if (throws) {
      // 炸弹开关：默认只会从 false 变成 true（边界出错后不自动恢复，来回切换不是“同状态同 DOM”）；
      // 服务端已经炸了的边界水合不上，属于已知缺陷（bugs/006）
      let bomb = states.find((s) => s.type === 'bomb')?.name;
      bomb ??= add('bomb', KNOWN.enabled ? rng.chance(0.5) : false);
      kids.push({ t: 'comp', name: 'Bomb', props: [{ k: 'armed', v: { e: bomb } }], kids: [] });
    }
    return { t: 'boundary', kids };
  }

  const tree = { t: 'el', tag: 'div', attrs: [{ k: 'id', v: { s: 'root' } }], kids: children('flow', 4, undefined, 5) };
  void newRow;

  // ---- 轮次：随机改状态
  const rounds = [];
  const sim = Object.fromEntries(states.filter((s) => s.type === 'list').map((s) => [s.name, { len: s.init.length, ids: new Set(s.init.map((r) => r.id)) }]));
  for (let r = rng.range(3, 7); r > 0; r--) {
    const ops = [];
    for (let k = rng.range(1, 3); k > 0; k--) {
      const roll = rng.next();
      if (roll < 0.15 && counters.click) ops.push({ t: 'click', n: rng.int(counters.click) });
      else if (roll < 0.25 && counters.bind) ops.push({ t: 'type', n: rng.int(counters.bind), v: rng.pick(['', 'typed', '7', 'a<b']) });
      else if (roll < 0.6 || !names('list').length) {
        const state = rng.pick(states.filter((s) => s.type !== 'list'));
        const v = state.type === 'bomb' ? true : state.type === 'bool' ? !!rng.int(2) : state.type === 'num' ? rng.int(4) : state.type === 'pick' ? rng.pick(KNOWN.enabled ? ['a', 'b', 'c', 'd'] : ['a', 'b', 'c']) : rng.pick(STR_POOL);
        ops.push({ t: 'set', name: state.name, v });
      } else {
        const name = rng.pick(names('list'));
        const info = sim[name];
        const fresh = () => {
          let id = nextId++;
          while (info.ids.has(id)) id = nextId++;
          info.ids.add(id);
          return { id, t: rng.pick(['a', 'b', 'c', 'd', 'e']), v: rng.int(5) };
        };
        const options = [['push', 4], ['unshift', 2], ['clear', 1], ['reverse', 1], ['splice', 3]];
        if (info.len) options.push(['pop', 2], ['shift', 2], ['label', 3], ['set', 2], ['swap', 1]);
        const t = rng.weighted(options);
        let op;
        if (t === 'push' || t === 'unshift') {
          const rows = Array.from({ length: rng.range(1, 2) }, fresh);
          op = { t, rows };
          info.len += rows.length;
        } else if (t === 'splice') {
          const at = rng.range(0, info.len);
          const del = rng.range(0, Math.min(2, info.len - at));
          const rows = Array.from({ length: rng.range(0, 2) }, fresh);
          op = { t, at, del, rows };
          info.len += rows.length - del;
        } else if (t === 'pop' || t === 'shift') {
          op = { t };
          info.len--;
        } else if (t === 'clear') {
          op = { t };
          info.len = 0;
        } else if (t === 'label') op = { t, at: rng.int(info.len), label: rng.pick(['a', 'b', 'c', 'zz']), v: rng.int(5) };
        else if (t === 'set') op = { t, at: rng.int(info.len), row: fresh() };
        else if (t === 'swap') op = { t, a: rng.int(info.len), b: rng.int(info.len) };
        else op = { t };
        ops.push({ t: 'list', name, op });
      }
    }
    rounds.push({ ops });
  }
  return { states, tree, features: { sx: features.sx, lazy: [...features.lazy], boundary: features.boundary }, rounds, preload: KNOWN.enabled && rng.chance(0.25) };
}

// ---------------------------------------------------------------- 打印成 TSX
const safeText = (s) => /^[A-Za-z0-9一-龥][A-Za-z0-9一-龥 ]*[A-Za-z0-9一-龥]$|^[A-Za-z0-9一-龥]$/.test(s);
const safeAttr = (s) => /^[A-Za-z0-9 _-]*$/.test(s);

function attrSource(attr) {
  if (attr.spread) return `{...(${attr.spread})}`;
  const { k, v } = attr;
  if (v.s !== undefined) return safeAttr(v.s) ? `${k}="${v.s}"` : `${k}={${JSON.stringify(v.s)}}`;
  if (v.e !== undefined) return `${k}={${v.e}}`;
  if (v.node) return `${k}={${printExpr(v.node)}}`;
  return k;
}
const attrsSource = (attrs) => (attrs.length ? ` ${attrs.map(attrSource).join(' ')}` : '');

/** 作为 JS 表达式的源码（属性值、条件分支里用） */
function printExpr(n) {
  switch (n.t) {
    case 'text':
      return JSON.stringify(n.s);
    case 'expr':
      return `(${n.e})`;
    case 'cond': {
      const a = printExpr(n.a);
      switch (n.form) {
        case 'and':
        case 'andNum':
          return `(${n.test} && ${a})`;
        case 'tern':
          return `(${n.test} ? ${a} : ${printExpr(n.b)})`;
        case 'ternNull':
          return `(${n.test} ? ${a} : null)`;
        default:
          return `(${n.test} ? null : ${a})`;
      }
    }
    case 'list': {
      const row = { ...n.row, attrs: [...(n.keyed ? [{ k: 'key', v: { e: 'it.id' } }] : []), ...n.row.attrs] };
      const map = `${n.src}.map((it: any, i: number) => ${printNode(row)})`;
      if (n.wrap === 'tern') return `(${n.test} ? ${map} : ${printExpr(n.fallback)})`;
      if (n.wrap === 'and') return `(${n.test} && ${map})`;
      return map;
    }
    default:
      return printNode(n);
  }
}

export function printNode(n) {
  switch (n.t) {
    case 'text':
      return safeText(n.s) ? n.s : `{${JSON.stringify(n.s)}}`;
    case 'expr':
      return `{${n.e}}`;
    case 'el': {
      const open = `<${n.tag}${attrsSource(n.attrs)}`;
      if (n.void || !n.kids.length) return n.void ? `${open} />` : `${open}></${n.tag}>`;
      return `${open}>${n.kids.map(printNode).join('')}</${n.tag}>`;
    }
    case 'frag':
      return `<>${n.kids.map(printNode).join('')}</>`;
    case 'cond':
    case 'list':
      return `{${printExpr(n)}}`;
    case 'comp':
      return n.kids.length ? `<${n.name}${attrsSource(n.props)}>${n.kids.map(printNode).join('')}</${n.name}>` : `<${n.name}${attrsSource(n.props)} />`;
    case 'lazy': {
      const name = `Lazy_${n.hydrate}_${n.inner}`;
      const props = [...n.props, { k: 'fallback', v: { node: n.fallback } }];
      return `<${name}${attrsSource(props)}>${n.kids.map(printNode).join('')}</${name}>`;
    }
    case 'boundary':
      return `<Boundary fallback={(e: any) => <i class="fb">fb</i>}>${n.kids.map(printNode).join('')}</Boundary>`;
    case 'form':
      return printForm(n);
    default:
      return '';
  }
}
function printForm(n) {
  const extra = attrsSource(n.attrs);
  const id = n.id !== undefined ? ` data-bind="${n.id}"` : '';
  switch (n.kind) {
    case 'text':
      return `<input${id} value={_bind(${n.bind})}${extra} />`;
    case 'textarea':
      return `<textarea${id} value={_bind(${n.bind})}${extra}></textarea>`;
    case 'check':
      return `<input${id} type="checkbox" checked={_bind(${n.bind})}${extra} />`;
    case 'number':
      return `<input${id} type="number" value={_bind(${n.bind})}${extra} />`;
    case 'select':
      return `<select${id} value={_bind(${n.bind})}${extra}>${n.options.map(printNode).join('')}</select>`;
    case 'textarea1':
      return `<textarea value={${n.e}}${extra}></textarea>`;
    case 'check1':
      return `<input type="checkbox" checked={${n.e}}${extra} />`;
    default:
      return `<input value={${n.e}}${extra} />`;
  }
}

function listApply(name) {
  return `
    case '${name}': {
      const op = args;
      switch (op.t) {
        case 'push': ${name}.push(...op.rows); break;
        case 'unshift': ${name}.unshift(...op.rows); break;
        case 'pop': ${name}.pop(); break;
        case 'shift': ${name}.shift(); break;
        case 'splice': ${name}.splice(op.at, op.del, ...op.rows); break;
        case 'clear': ${name}.length = 0; break;
        case 'reverse': ${name}.reverse(); break;
        case 'label': if (${name}[op.at]) { ${name}[op.at].t = op.label; ${name}[op.at].v = op.v; } break;
        case 'set': if (op.at < ${name}.length) ${name}[op.at] = op.row; break;
        case 'swap': { const x = ${name}[op.a]; const y = ${name}[op.b]; if (x && y) { ${name}[op.a] = y; ${name}[op.b] = x; } break; }
      }
      break;
    }`;
}

/** 整个模块的源码 */
export function printModule(c) {
  const lazyInners = [...new Set(c.features.lazy.map((entry) => entry.split(':')[1]))];
  const head = [
    `import { Boundary, lazy, useId, onCleanup } from '@hilt/runtime';`,
    c.features.sx ? `import { create } from '@hilt/css';` : '',
    c.features.sx ? `const styles = create({ a: { color: 'rgb(255, 0, 0)' }, b: { fontWeight: 700 }, w: (width: string) => ({ width }) });` : '',
  ].filter(Boolean);
  const library = `
const Box = _component(({ children, title, ...rest }: any) => <div title={title} {...rest}>{children}</div>);
const Tag = _component(({ children, ...rest }: any) => <span {...rest}>{children}</span>);
const Pass = _component(({ children }: any) => children);
const Pair = _component(({ header, children }: any) => <section><h4>{header}</h4>{children}</section>);
const Maybe = _component(({ when, children }: any) => <>{when && <hr />}{when ? children : null}</>);
const Item = _component(({ children, label }: any) => <li data-label={label}>{children}</li>);
const Labelled = _component(({ label }: any) => { const id = useId(); return <><label for={id}>{label}</label><input id={id} /></>; });
const Counter = _component(({ n }: any) => { const d = _derived(n * 2); return <span class="ctr">{d}</span>; });
const explode = (armed: any) => { if (armed) throw new Error('boom'); return 'ok'; };
const Bomb = _component(({ armed }: any) => <u>{explode(armed)}</u>);
${[...new Set(c.features.lazy)]
  .map((entry) => {
    const [hydrate, inner] = entry.split(':');
    return `const Lazy_${hydrate}_${inner} = lazy(() => Promise.resolve({ default: ${inner} }), { hydrate: '${hydrate}' });`;
  })
  .join('\n')}
export const lazies = [${[...new Set(c.features.lazy)].map((entry) => `Lazy_${entry.replace(':', '_')}`).join(', ')}];
void ${JSON.stringify(lazyInners)};
void onCleanup;
`;
  const lists = c.states.filter((s) => s.type === 'list');
  const declarations = c.states.map((s) => `  let ${s.name} = _state<any>(init.${s.name});`).join('\n');
  const setCases = c.states.filter((s) => s.type !== 'list').map((s) => `      case '${s.name}': ${s.name} = args; break;`).join('\n');
  const snapshot = c.states.map((s) => `${s.name}: ${s.type === 'list' ? `_state.snapshot(${s.name})` : s.name}`).join(', ');
  const root = `
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
${declarations}
  (globalThis as any).__apis[slot] = {
    apply(name: string, args: any) {
      switch (name) {
${setCases}
${lists.map((s) => listApply(s.name)).join('\n')}
      }
    },
    snapshot() { return { ${snapshot} }; },
  };
  return ${printNode(c.tree)};
});
`;
  return `${head.join('\n')}\n${library}\n${root}`;
}
