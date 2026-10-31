// 方向 3 的页面侧：在浏览器里把用例（JSON）搭成真实的 props 层，跑 spread / viewOf / ssrSpread，
// 和按 rules.js 文件头规则独立写的参考模型比。esbuild 打成 IIFE 后挂 window.attrsFuzz。
import { merge, omit, propsView, registerStyleEngine, signal, flushSync, dispose } from '../03-publish/packages/runtime/index.js';
import { spread } from '../03-publish/packages/runtime/index.js';
import { scope } from '../03-publish/packages/runtime/reactive.js';
import { config } from '../03-publish/packages/runtime/rules.js';
import { ssrSpread } from '../03-publish/packages/runtime/server.js';

config.dev = false;
// 假的样式引擎：sx 值里的每个单词变成一个类和一个行内变量，足够观察“累加”和“用户 style 盖住变量”
registerStyleEngine((...values) => {
  const names = [];
  const walk = (value) => {
    if (typeof value === 'string') names.push(...value.split(/\s+/).filter(Boolean));
    else if (Array.isArray(value)) value.forEach(walk);
  };
  values.forEach(walk);
  const unique = [...new Set(names)];
  return { class: unique.map((name) => `sx-${name}`).join(' '), style: Object.fromEntries(unique.map((name) => [`--sx-${name}`, '1'])) };
});

const isEventKey = (key) => /^on[A-Z:]/.test(key);
const SPECIAL = new Set(['class', 'className', 'style', 'sx', 'ref', 'children']);
const BOOL_KEYS = new Set(['hidden', 'disabled', 'required', 'readonly', 'open']);

// ---------------------------------------------------------------- 搭用例
function build(spec) {
  const sig = spec.signals.map((value) => signal(value));
  const functions = new Map(); // 描述对象 -> 函数，保证同一处永远是同一个函数
  const calls = [];
  const refCalls = [];
  const state = { muted: false };
  const val = (vs) => {
    if (vs !== null && typeof vs === 'object' && !Array.isArray(vs) && vs.$) {
      switch (vs.$) {
        case 'u':
          return undefined;
        case 'g':
          return val(vs.pool[sig[vs.sig].value % vs.pool.length]);
        case 'obj':
          return Object.fromEntries(Object.entries(vs.entries).map(([key, item]) => [key, val(item)]));
        case 'h': {
          if (!functions.has(vs)) {
            functions.set(vs, (event) => {
              calls.push(vs.id);
              if (vs.prevent) event.preventDefault?.();
              if (vs.stop) event.stopImmediatePropagation?.();
            });
          }
          return functions.get(vs);
        }
        case 'r': {
          if (!functions.has(vs)) functions.set(vs, (node) => !state.muted && refCalls.push([vs.id, node === null ? 'null' : 'el']));
          return functions.get(vs);
        }
      }
    }
    return vs;
  };
  const makeObject = (props) => {
    const object = {};
    for (const [key, vs] of Object.entries(props)) {
      if (vs && vs.$ === 'g') Object.defineProperty(object, key, { get: () => val(vs), enumerable: true, configurable: true });
      else object[key] = val(vs);
    }
    return object;
  };
  // 每层同时产出：真实的 merge 部件 + 参考模型要用的 [{ get, hide }]
  const layerOf = (layer) => {
    if (layer.t === 'obj') {
      const object = makeObject(layer.props);
      return { part: object, pairs: [{ get: () => object, hide: new Set() }] };
    }
    if (layer.t === 'fn') {
      const a = makeObject(layer.a);
      const b = makeObject(layer.b);
      const fn = () => (sig[layer.cond].value % 2 ? a : b);
      return { part: fn, pairs: [{ get: fn, hide: new Set() }] };
    }
    const inner = layer.inner.map(layerOf);
    const keys = new Set(layer.hide);
    return {
      part: omit(merge(...inner.map((x) => x.part)), layer.hide),
      pairs: inner.flatMap((x) => x.pairs).map((pair) => ({ get: pair.get, hide: new Set([...pair.hide, ...keys]) })),
    };
  };
  const built = spec.layers.map(layerOf);
  const props = built.length === 1 && spec.layers[0].t === 'obj' && spec.direct ? built[0].part : merge(...built.map((x) => x.part));
  return { sig, props, pairs: built.flatMap((x) => x.pairs), calls, refCalls, state };
}

// ---------------------------------------------------------------- 参考模型（按 rules.js 文件头的规则，独立写）
const plain = (object) => {
  if (object == null) return null;
  const copy = {};
  for (const key of Object.keys(object)) copy[key] = object[key];
  return copy;
};
function classText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(classText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return Object.keys(value).filter((key) => value[key]).join(' ');
  return '';
}
const cssName = (key) => (key.startsWith('--') ? key : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
function addStyle(map, value) {
  if (typeof value === 'string') {
    for (const declaration of value.split(';')) {
      const at = declaration.indexOf(':');
      if (at < 0) continue;
      const name = declaration.slice(0, at).trim();
      const text = declaration.slice(at + 1).trim();
      if (name && text) map.set(name.startsWith('--') ? name : name.toLowerCase(), text);
    }
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item === undefined) continue;
      if (item === null || item === false || item === '') map.delete(cssName(key));
      else map.set(cssName(key), String(item));
    }
  }
}
/** 当前所有层的“生效值” */
function modelOf(pairs) {
  const live = pairs.map((pair) => ({ src: plain(pair.get()), hide: pair.hide }));
  const keys = new Set();
  for (const layer of live) if (layer.src) for (const key of Object.keys(layer.src)) if (!layer.hide.has(key)) keys.add(key);
  const over = {};
  for (const key of keys) {
    if (SPECIAL.has(key) || isEventKey(key)) continue;
    for (let i = live.length - 1; i >= 0; i--) {
      const { src, hide } = live[i];
      if (!src || hide.has(key)) continue;
      if (src[key] !== undefined) {
        over[key] = src[key];
        break;
      }
    }
  }
  const rawClassName = (() => {
    for (let i = live.length - 1; i >= 0; i--) if (live[i].src && !live[i].hide.has('className') && live[i].src.className !== undefined) return live[i].src.className;
    return undefined;
  })();
  const classes = [];
  const style = new Map();
  const sxValues = [];
  const handlers = {};
  const refs = [];
  for (const { src, hide } of live) {
    if (!src) continue;
    if (!hide.has('class')) {
      const part = classText(src.class !== undefined ? src.class : src.className);
      if (part) classes.push(part);
    }
    if (!hide.has('style')) addStyle(style, src.style);
    if (!hide.has('sx') && src.sx !== undefined) sxValues.push(src.sx);
    if (!hide.has('ref') && typeof src.ref === 'function') refs.push(src.ref);
    for (const key of Object.keys(src)) if (isEventKey(key) && !hide.has(key) && typeof src[key] === 'function') (handlers[key] ??= []).push(src[key]);
  }
  return { keys, over, rawClassName, classText: classes.join(' '), style, sxValues, handlers, refs };
}
const engineOf = (values) => {
  const names = [];
  const walk = (value) => {
    if (typeof value === 'string') names.push(...value.split(/\s+/).filter(Boolean));
    else if (Array.isArray(value)) value.forEach(walk);
  };
  values.forEach(walk);
  return [...new Set(names)];
};

/** 把模型的结论落到一个临时元素上（用 DOM 原语，不经过被测代码），得到可比的快照 */
function expectedSnapshot(model, spec) {
  const el = document.createElement(spec.tag);
  if (spec.type) el.setAttribute('type', spec.type);
  for (const [key, value] of Object.entries(model.over)) {
    if (value === null) continue;
    if (key === 'value') {
      el.setAttribute('value', String(value));
      el.value = String(value);
    } else if (key === 'checked') {
      el.checked = !!value;
      el.defaultChecked = !!value;
    } else if (BOOL_KEYS.has(key)) {
      if (typeof value === 'string') el.setAttribute(key, value);
      else if (value) el.setAttribute(key, '');
    } else if (key === 'href') {
      if (!/^javascript:/i.test(String(value).replace(/[\u0000- ]/g, ''))) el.setAttribute(key, String(value));
    } else if (key === 'translate') {
      el.setAttribute(key, typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value));
    } else if (typeof value !== 'object' && typeof value !== 'function') {
      el.setAttribute(key, String(value));
    }
  }
  // 值是 null 的 value / checked：落成零值（没有 attribute，property 是空 / false）
  const tokens = [...model.classText.split(/\s+/).filter(Boolean)];
  const sxNames = model.sxValues.some(Boolean) ? engineOf(model.sxValues) : [];
  tokens.push(...sxNames.map((name) => `sx-${name}`));
  if (tokens.length) el.setAttribute('class', tokens.join(' '));
  // 用户 style 盖住引擎变量
  const style = new Map(sxNames.map((name) => [`--sx-${name}`, '1']));
  for (const [name, value] of model.style) {
    style.delete(name);
    style.set(name, value);
  }
  for (const [name, value] of style) {
    const important = /\s*!important\s*$/i.test(value);
    el.style.setProperty(name, value.replace(/\s*!important\s*$/i, ''), important ? 'important' : '');
  }
  return snap(el);
}

/** 两次模型结果之间，输入有变化的属性名 */
function changedAttrs(a, b) {
  const out = new Set();
  for (const key of new Set([...Object.keys(a.over), ...Object.keys(b.over)])) if (!same(a.over[key], b.over[key])) out.add(key);
  const sx = (m) => (m.sxValues.some(Boolean) ? engineOf(m.sxValues) : []);
  if (!same([a.classText, sx(a)], [b.classText, sx(b)])) out.add('class');
  if (!same([[...a.style], sx(a)], [[...b.style], sx(b)])) out.add('style');
  return out;
}

// ---------------------------------------------------------------- 快照
function snap(el) {
  const attrs = {};
  for (const attr of el.attributes) attrs[attr.name] = attr.value;
  const tokens = attrs.class ? [...new Set(attrs.class.split(/\s+/).filter(Boolean))].sort().join(' ') : '';
  delete attrs.class;
  delete attrs.style;
  const style = {};
  for (let i = 0; i < el.style.length; i++) {
    const name = el.style[i];
    const priority = el.style.getPropertyPriority(name);
    style[name] = el.style.getPropertyValue(name) + (priority ? ` !${priority}` : '');
  }
  const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { attrs: sorted(attrs), class: tokens, style: sorted(style), value: el.value, checked: el.checked };
}
/** 原始属性字符串：用来判断“有没有碰这个属性” */
const rawAttrs = (el) => Object.fromEntries([...el.attributes].map((attr) => [attr.name, attr.value]));

const show = (value) => JSON.stringify(value, (key, item) => (item === undefined ? '__undefined__' : typeof item === 'function' ? '__fn__' : item));
const same = (a, b) => show(a) === show(b);
function diff(a, b) {
  const out = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) if (!same(a?.[key], b?.[key])) out[key] = [a?.[key], b?.[key]];
  return out;
}

// ---------------------------------------------------------------- 执行
const makeEl = (spec) => {
  const el = document.createElement(spec.tag);
  if (spec.type) el.setAttribute('type', spec.type);
  return el;
};
const ssrSnapshot = (props, spec) => {
  const box = document.createElement('div');
  const type = spec.type ? ` type="${spec.type}"` : '';
  box.innerHTML = `<${spec.tag}${type}${ssrSpread(props, spec.tag)}>`;
  return snap(box.firstElementChild);
};
const fireClick = (el) => {
  const checked = el.checked;
  el.dispatchEvent(new MouseEvent('click', { cancelable: true }));
  el.checked = checked; // 复选框的默认行为会翻转
};
/** 模型对一个事件键的预期调用顺序：靠后的层先执行，preventDefault / stopImmediatePropagation 之后下层不再执行 */
function expectedCalls(model, key, ids, honorStop) {
  const out = [];
  const list = model.handlers[key] ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const id = ids.get(list[i]);
    out.push(id);
    const flags = ids.flags.get(list[i]);
    if (flags.prevent || (honorStop && flags.stop)) break;
  }
  return out;
}

export function runSpec(spec) {
  const failures = [];
  const fail = (kind, detail) => failures.push({ kind, detail });
  let ctx;
  try {
    ctx = build(spec);
  } catch (error) {
    return [{ kind: 'build-error', detail: String(error.stack ?? error) }];
  }
  // 处理函数 / ref 的反查表（模型按函数身份找编号）
  const ids = new Map();
  ids.flags = new Map();
  // 先让每个函数报出自己的编号：调一次看看谁被记录
  const identify = () => {
    for (const pair of ctx.pairs) {
      const source = pair.get();
      for (const key of Object.keys(source ?? {})) {
        const fn = source[key];
        if (typeof fn !== 'function' || ids.has(fn)) continue;
        if (key === 'ref') {
          const before = ctx.refCalls.length;
          fn(null);
          const id = ctx.refCalls[before]?.[0];
          ctx.refCalls.length = before;
          ids.set(fn, id);
          ids.flags.set(fn, {});
        } else {
          const before = ctx.calls.length;
          const probe = { preventDefault() { flags.prevent = true; }, stopImmediatePropagation() { flags.stop = true; } };
          const flags = {};
          fn(probe);
          ids.set(fn, ctx.calls[before]);
          ctx.calls.length = before;
          ids.flags.set(fn, flags);
        }
      }
    }
  };
  const compareDom = (label, got, want) => {
    if (!same(got, want)) fail(label, { got, want, diff: diff({ ...got.attrs, class: got.class, ...Object.fromEntries(Object.entries(got.style).map(([k, v]) => [`style:${k}`, v])), value: got.value, checked: got.checked }, { ...want.attrs, class: want.class, ...Object.fromEntries(Object.entries(want.style).map(([k, v]) => [`style:${k}`, v])), value: want.value, checked: want.checked }) });
  };

  const el = makeEl(spec);
  const observed = new MutationObserver(() => {});
  let owner;
  try {
    owner = scope(() => spread(el, ctx.props));
    flushSync();
  } catch (error) {
    return [{ kind: 'spread-throws', detail: String(error.stack ?? error).split('\n').slice(0, 4).join(' | ') }];
  }
  identify();
  const check = (stage) => {
    identify();
    const model = modelOf(ctx.pairs);
    const expected = expectedSnapshot(model, spec);
    const got = snap(el);
    compareDom(`${stage}:dom-vs-model`, got, expected);
    // 从头算一遍：增量更新的结果必须和重新 spread 一样
    const fresh = makeEl(spec);
    ctx.state.muted = true;
    const freshOwner = scope(() => spread(fresh, ctx.props));
    flushSync();
    compareDom(`${stage}:incremental-vs-fresh`, got, snap(fresh));
    dispose(freshOwner);
    ctx.state.muted = false;
    // 服务端
    try {
      compareDom(`${stage}:ssr-vs-client`, ssrSnapshot(ctx.props, spec), snap(fresh));
    } catch (error) {
      fail(`${stage}:ssr-throws`, String(error.stack ?? error).split('\n').slice(0, 3).join(' | '));
    }
    // 读视图（直接传普通对象时视图就是它自己，没有合并语义可言）
    const view = propsView(ctx.props);
    if (spec.direct && spec.layers.length === 1 && spec.layers[0].t === 'obj') {
      if (view !== ctx.props) fail(`${stage}:view-identity`, 'propsView(普通对象) 应该原样返回');
      return { model, got };
    }
    const viewKeys = Object.keys(view).sort();
    const wantKeys = [...model.keys].sort();
    if (!same(viewKeys, wantKeys)) fail(`${stage}:view-keys`, { got: viewKeys, want: wantKeys });
    for (const key of model.keys) {
      let want;
      let got = view[key];
      if (key === 'class') want = model.classText || undefined;
      else if (key === 'style') want = model.style.size ? Object.fromEntries(model.style) : undefined;
      else if (key === 'sx') want = model.sxValues.length > 1 ? model.sxValues : model.sxValues[0];
      else if (key === 'ref' || isEventKey(key)) {
        got = typeof got;
        want = (key === 'ref' ? model.refs.length : (model.handlers[key] ?? []).length) ? 'function' : 'undefined';
      } else if (key === 'className') want = model.rawClassName;
      else want = model.over[key];
      if (!same(got, want)) fail(`${stage}:view-value`, { key, got, want });
    }
    // 事件：落到元素上的和读视图合并出来的顺序，都要和模型一致
    for (const key of Object.keys(model.handlers)) {
      ctx.calls.length = 0;
      fireClick(el);
      const onElement = [...ctx.calls];
      const wantElement = expectedCalls(model, key, ids, true);
      if (key === 'onClick' && !same(onElement, wantElement)) fail(`${stage}:event-order`, { got: onElement, want: wantElement });
      ctx.calls.length = 0;
      const merged = view[key];
      const event = new MouseEvent('click', { cancelable: true });
      merged?.(event);
      const onView = [...ctx.calls];
      if (key === 'onClick' && !same(onView, wantElement)) fail(`${stage}:view-event-order`, { element: onElement, view: onView, want: wantElement });
    }
    return { model, got };
  };

  const first = check('init');
  // ref：初始调用一次拿到元素，和模型的 ref 集合一致
  const wantRefs = first.model.refs.map((fn) => ids.get(fn)).sort();
  const gotRefs = ctx.refCalls.filter(([, what]) => what === 'el').map(([id]) => id).sort();
  if (!same(gotRefs, wantRefs)) fail('init:refs', { got: gotRefs, want: wantRefs });

  observed.observe(el, { attributes: true });
  for (const step of spec.steps) {
    const before = rawAttrs(el);
    const modelBefore = modelOf(ctx.pairs);
    observed.takeRecords();
    for (const [index, value] of step.set) if (ctx.sig[index]) ctx.sig[index].value = value ?? 0;
    flushSync();
    const touched = new Set(observed.takeRecords().map((record) => record.attributeName));
    const after = rawAttrs(el);
    // 输入没变的属性不该被碰（写同样的值也会产生一条记录；先删后加同样的值也算）。输入变了但落到 DOM 上一样（1 -> true）不算
    const modelAfter = modelOf(ctx.pairs);
    const changed = changedAttrs(modelBefore, modelAfter);
    const redundant = [...touched].filter((name) => !changed.has(name) && name !== 'type');
    if (redundant.length) fail('update:touched-unchanged', { redundant, changed: [...changed], before, after, step: step.set });
    check('update');
  }
  dispose(owner);
  flushSync();
  const wantNull = first.model.refs.length;
  const gotNull = ctx.refCalls.filter(([, what]) => what === 'null').length;
  if (gotNull !== wantNull) fail('dispose:ref-null', { got: gotNull, want: wantNull });
  observed.disconnect();
  return failures;
}

window.attrsFuzz = { runSpec };
