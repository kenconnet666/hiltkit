// 属性方向的共用件（Node 端渲染 HTML 和浏览器端挂载共用同一份）：
//   用例 JSON -> 状态（sig）-> 描述对象；以及一个不看实现、只按文档语义推演的“期望值”。
// 值的 JSON 表示：{u:1} undefined、{z:1} null、{s:'x'} 字符串、{n:1} 数字、{b:true} 布尔
import { createElement, merge, sig } from 'hilt';
import { classOf, styleOf, styleText, unsafeUrl } from '@hilt/rules';

export const dec = (tagged) => ('s' in tagged ? tagged.s : 'n' in tagged ? tagged.n : 'b' in tagged ? tagged.b : 'z' in tagged ? null : undefined);
const truthy = (value) => !!value;

/** 初始值 { s0: tagged, ... } -> { s0: sig, ... }；值直接给原始值时用 fromRaw */
export function makeState(init, fromRaw = false) {
  const state = {};
  for (const [name, value] of Object.entries(init)) state[name] = sig(fromRaw ? value : dec(value));
  return state;
}
/** 引用到的所有状态名都有初值（ref 用的 sig 以 r 开头，初值 null） */
export const stateNames = (init) => Object.keys(init);

// ---- 解码：用例里的值描述 -> 真实的属性值 ----
function decodeClass(c, state) {
  switch (c.c) {
    case 'lit':
      return dec(c.v);
    case 'arr':
      return c.items.map((item) => decodeClass(item, state));
    case 'obj':
      return Object.fromEntries(c.e.map(([name, value]) => [name, decodeClass(value, state)]));
    default: // fn：状态为真取 a，否则取 b
      return () => (truthy(state[c.ref]()) ? decodeClass(c.a, state) : decodeClass(c.b, state));
  }
}
function decodeStyle(c, state) {
  switch (c.c) {
    case 'lit':
      return dec(c.v);
    case 'obj':
      return Object.fromEntries(c.e.map(([name, value]) => [name, value.fnv ? () => state[value.fnv]() : dec(value)]));
    default:
      return () => (truthy(state[c.ref]()) ? decodeStyle(c.a, state) : decodeStyle(c.b, state));
  }
}
function decodeFn(v, state) {
  switch (v.wrap) {
    case 'upper':
      return () => {
        const value = state[v.ref]();
        return typeof value === 'string' ? value.toUpperCase() : value;
      };
    case 'blank':
      return () => {
        const value = state[v.ref]();
        return value === '' || value === false ? undefined : value;
      };
    case 'const':
      return () => dec(v.v);
    default:
      return () => state[v.ref]();
  }
}
export function decodeValue(v, state, env) {
  switch (v.k) {
    case 'lit':
      return dec(v.v);
    case 'fn':
      return decodeFn(v, state);
    case 'sig':
    case 'refsig':
      return state[v.ref];
    case 'cls':
      return decodeClass(v.c, state);
    case 'sty':
      return decodeStyle(v.c, state);
    case 'ev':
      return (event) => {
        env.log.push(v.id);
        if (v.prevent) event.preventDefault();
      };
    default: // ref
      return (el) => {
        env.refs[v.id] = el;
      };
  }
}

const decodeLayer = (layer, state, env) => Object.fromEntries(Object.entries(layer).map(([key, v]) => [key, decodeValue(v, state, env)]));

/** 被测元素的描述对象。svg 元素包在 <svg> 里。viaMerge = 只有一层时也走 merge */
export function buildView(spec, state, env) {
  const layers = spec.layers.map((layer) => decodeLayer(layer, state, env));
  let props = layers.length === 1 && !spec.viaMerge ? layers[0] : merge(...layers);
  if (spec.type) props = { ...props, type: spec.type };
  const el = createElement(spec.tag, props);
  return spec.svg ? createElement('svg', { children: el }) : el;
}

// ---- 期望值：按 rules.js 写的分层语义，独立于 hilt/index.ts 的 merge ----
/** 把值里的函数递归调用掉（class、style 里嵌的函数） */
function settle(value) {
  if (typeof value === 'function') return settle(value());
  if (Array.isArray(value)) return value.map(settle);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, settle(item)]));
  return value;
}
const BOOL_KEYS = new Set(['hidden', 'disabled', 'readonly', 'required']);
const URL_KEYS = new Set(['href']);
/** 普通属性的有效值：从上往下第一个不是 undefined 的；Sig 是终点（merge 里 Sig 整个替换下层，不落回） */
function effective(layers, key, state) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const v = layers[i][key];
    if (v === undefined) continue;
    if (v.k === 'sig') return { value: state[v.ref].peek() };
    const value = decodeValue(v, state, undefined);
    const settled = typeof value === 'function' ? value() : value;
    if (settled !== undefined) return { value: settled };
  }
  return undefined;
}
/** 期望：普通 attribute 名 -> 字符串（不应出现则 undefined）、class 集合、style 文本 */
export function expected(spec, state) {
  const attrs = {};
  const keys = new Set(spec.layers.flatMap((layer) => Object.keys(layer)));
  for (const key of keys) {
    if (key === 'class' || key === 'style' || key === 'value' || key === 'checked' || key === 'ref' || /^on[A-Z]/.test(key)) continue;
    const found = effective(spec.layers, key, state);
    let value = found?.value;
    if (value === undefined) value = null;
    if (BOOL_KEYS.has(key)) value = typeof value === 'string' ? value : value ? '' : null;
    else if (URL_KEYS.has(key) && unsafeUrl(value)) value = null;
    attrs[key] = value === null ? undefined : String(value);
  }
  const layerObjects = spec.layers.flatMap((layer) => [{ class: layer.class && settle(decodeValue(layer.class, state)), style: layer.style && settle(decodeValue(layer.style, state)) }, undefined]);
  const classes = new Set(classOf(layerObjects).split(/\s+/).filter(Boolean));
  const style = styleText(styleOf(layerObjects));
  return { attrs, classes, style };
}
/** 事件：靠后的层先执行，preventDefault 之后下层跳过 */
export function expectedEvents(spec) {
  const out = [];
  for (let i = spec.layers.length - 1; i >= 0; i--) {
    const v = spec.layers[i].onClick;
    if (!v) continue;
    out.push(v.id);
    if (v.prevent) break;
  }
  return out;
}
