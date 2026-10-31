// 服务端运行时：导出名和 index.js 一致，组件库的两份产物各自对着自己的入口。
// 没有 DOM、没有依赖追踪、effect 不执行；一次渲染同步拼完字符串。
import { isEvent, keysOf, layersOf, merge, omit, readClass, readKey, readSx } from './props.js';

export { merge, omit };

export const warnings = [];
export const untrack = (read) => read();
export const flushSync = () => {};
export const bound = (write) => write;
export function signal(initial) {
  let value = initial;
  return (...next) => {
    if (!next.length) return value;
    value = next[0];
  };
}
export const computed = (read) => read;
export function overridable(read) {
  let held;
  return (...next) => {
    if (next.length) held = { value: next[0] };
    return held ? held.value : read();
  };
}
export const effect = () => () => {};
export const onCleanup = () => {};
export const userEffect = () => {};
export const scope = (fn) => {
  fn();
  return () => {};
};
// 服务端不需要追踪：对象原样用，读写都是普通读写
export const deep = (value) => value;
export const selector = (read) => (key) => read() === key;
export function bindable(props, key, initial) {
  const value = props[key];
  return signal(value !== undefined ? value : initial);
}

// 依赖注入：和客户端一样的原型链
const ROOT = Object.create(null);
const APP = Symbol('app');
let contexts = ROOT;
export function component(Comp, props) {
  const previous = contexts;
  try {
    return Comp(props);
  } finally {
    contexts = previous;
  }
}
export const createContext = (fallback) => ({ id: Symbol('context'), fallback });
export function provide(context, value) {
  contexts = Object.create(contexts);
  contexts[context.id] = value;
}
export function inject(context) {
  const value = contexts[context.id];
  return value === undefined ? context.fallback : value;
}
export function createService(factory) {
  const id = Symbol('service');
  return {
    use() {
      const provided = contexts[id];
      if (provided !== undefined) return provided;
      const app = contexts[APP];
      if (!app) throw new Error('服务只能在组件或其他服务里使用');
      if (!app.services.has(id)) app.services.set(id, factory());
      return app.services.get(id);
    },
    provide(value) {
      contexts = Object.create(contexts);
      contexts[id] = value !== undefined ? value : factory();
      return contexts[id];
    },
  };
}
/** 懒加载：服务端渲染前要把用到的加载好（renderToString 是同步的）。输出的 [ ] 让客户端能跳过这一段 */
const lazyComponents = [];
export function lazy(load) {
  let loaded;
  const entry = () => load().then((module) => (loaded = module.default ?? module));
  lazyComponents.push(entry);
  const Lazy = (props) => (loaded ? html(`<!--[-->${ssrChild(component(loaded, props))}<!--]-->`) : html(`<!--[-->${ssrChild(props.fallback)}<!--]-->`));
  Lazy.preload = entry;
  return Lazy;
}
export const preloadLazy = () => Promise.all(lazyComponents.map((entry) => entry()));

let styleEngine;
export const useStyleEngine = (attrs) => (styleEngine = attrs);

// ---- 拼字符串 ----
const SAFE = Symbol('hilt.html');
const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escapeAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const html = (text) => ({ [SAFE]: text });
export const ssr = (parts) => html(parts.join(''));

export function ssrAttr(key, value) {
  if (value == null || value === false) return '';
  if (key === 'style' && typeof value === 'object') return ` style="${escapeAttr(styleText(value))}"`;
  return value === true ? ` ${key}` : ` ${key}="${escapeAttr(value)}"`;
}
const styleText = (style) => Object.entries(style).map(([name, value]) => `${name}:${value}`).join(';');

export function ssrSpread(props) {
  const layers = layersOf(props);
  let out = '';
  let inline = '';
  const keys = keysOf(layers);
  if (keys.has('class') || keys.has('sx')) {
    const sx = readSx(layers);
    const composed = sx.length ? styleEngine(...sx) : {};
    const own = readClass(layers);
    const names = own && composed.class ? `${own} ${composed.class}` : own || composed.class;
    if (names) out += ` class="${escapeAttr(names)}"`;
    if (composed.style) inline = styleText(composed.style);
  }
  for (const key of keys) {
    if (key === 'class' || key === 'sx' || key === 'ref' || key === 'children' || isEvent(key)) continue;
    if (key === 'style') {
      const value = readKey(layers, key);
      const text = typeof value === 'object' ? styleText(value) : value;
      inline = inline && text ? `${inline};${text}` : inline || text;
      continue;
    }
    out += ssrAttr(key, readKey(layers, key));
  }
  if (inline) out += ` style="${escapeAttr(inline)}"`;
  return out;
}

/** 动态内容。函数是独立的一段，前后放 [ ]；相邻文本之间放空注释，否则解析时会合成一个节点 */
export function ssrChild(value) {
  // 这一段的内容就是个内容函数：同客户端的 unwrap，不多一层 [ ]
  while (typeof value === 'function') value = value();
  return ssrValue(value);
}
function ssrValue(value) {
  if (value == null || value === false || value === true) return '';
  if (Array.isArray(value)) {
    let out = '';
    let lastWasText = false;
    for (const item of value) {
      const isText = typeof item === 'string' || typeof item === 'number';
      if (isText && lastWasText) out += '<!---->';
      out += ssrValue(item);
      lastWasText = isText;
    }
    return out;
  }
  if (typeof value === 'function') return `<!--[-->${ssrChild(value())}<!--]-->`;
  if (typeof value === 'object' && SAFE in value) return value[SAFE];
  return escapeText(value);
}

export function For(props) {
  const items = props.each ?? [];
  const row = (item, index) => props.children(props.key ? () => item : item, () => index);
  return html(`<!--[-->${items.map((item, index) => ssrChild(row(item, index))).join('')}<!--]-->`);
}

/** 每次渲染一个新的应用实例：服务按请求隔离 */
export function renderToString(render) {
  const previous = contexts;
  contexts = Object.create(ROOT);
  contexts[APP] = { services: new Map() };
  try {
    return ssrChild(render());
  } finally {
    contexts = previous;
  }
}
