// 服务端运行时：导出名和 index.js 一致，组件库的两份产物各自对着自己的入口。
// 没有 DOM、没有依赖追踪、effect 不执行；一次渲染同步拼完字符串。
import {
  BOOL, CHILD, KIND_MASK, PROP, PROP_ONLY, TABLE, UNSAFE_SPREAD, URL, YESNO,
  classOf, config, layersOf, scan, styleOf, styleText, sxValues, unsafeUrl, viewOf, warn,
} from './rules.js';

export { merge, omit, registerStyleEngine, setterOf, viewOf as propsView } from './rules.js';

export const warnings = [];
export const stats = { effects: 0, released: 0 };
export const untrack = (read) => read();
export const flushSync = () => {};
export const bound = (write) => write;

class Cell {
  constructor(value) {
    this.value = value;
  }
}
export const signal = (initial) => new Cell(initial);
class Derived {
  constructor(read) {
    this.read = read;
  }
  get value() {
    return this.read();
  }
}
export const computed = (read) => new Derived(read);
class Overridable extends Derived {
  get value() {
    return this.held ? this.held.value : this.read();
  }
  set value(next) {
    this.held = { value: next };
  }
}
export const overridable = (read) => new Overridable(read);
export const or = (value, fallback) => (value === undefined ? fallback : value);
export const orElse = (value, cell) => (value === undefined ? cell.value : value);
export const effect = () => () => {};
export const renderEffect = () => undefined;
export const dispose = () => {};
export const onCleanup = () => {};
export const onError = () => {};
export const userEffect = () => {};
// 服务端不需要追踪：对象原样用，读写都是普通读写
export const state = (value) => value;
export const raw = (value) => value;
export const strictEquals = (a, b) => a === b;
export const snapshot = (value) => (typeof value === 'object' && value !== null ? structuredClone(value) : value);
export const selector = (read) => (key) => read() === key;
export function bindable(props, key, initial) {
  const value = props[key];
  return new Cell(value !== undefined ? value : initial);
}

// 依赖注入：和客户端一样的原型链
const ROOT = Object.create(null);
const APP = Symbol('app');
let contexts = ROOT;
export function component(Comp, props) {
  const previous = contexts;
  try {
    const value = Comp(viewOf(props));
    return contexts === previous ? value : carryContext(value, contexts);
  } finally {
    contexts = previous;
  }
}
/** provider 组件直接返回 children：内容之后才求值，要带上 provide 出来的 context */
function carryContext(value, saved) {
  if (typeof value === 'function') {
    return () => {
      const previous = contexts;
      contexts = saved;
      try {
        return value();
      } finally {
        contexts = previous;
      }
    };
  }
  if (Array.isArray(value)) return value.map((item) => carryContext(item, saved));
  return value;
}
/** 错误边界：渲染内容时抛错就输出 fallback。服务端内容要先渲染成字符串才接得住 */
export function Boundary(props) {
  let inner;
  try {
    inner = ssrChild(props.children);
  } catch (error) {
    inner = ssrChild(props.fallback(error, () => {}));
  }
  return html(`<!--[-->${inner}<!--]-->`);
}
/** 传送：服务端不输出，客户端挂载之后才创建 */
export const Portal = () => undefined;
const IDS = Symbol('ids');
export function useId() {
  const ids = contexts[IDS];
  return `${ids.prefix}${ids.next++}`;
}
function forkIds() {
  const ids = contexts[IDS];
  if (!ids) return;
  contexts = Object.create(contexts);
  contexts[IDS] = { prefix: `${ids.prefix}${ids.next++}-`, next: 0 };
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
  const Lazy = (props) => {
    forkIds();
    return loaded ? html(`<!--[-->${ssrChild(component(loaded, props))}<!--]-->`) : html(`<!--[-->${ssrChild(props.fallback)}<!--]-->`);
  };
  Lazy.preload = entry;
  return Lazy;
}
export const preloadLazy = () => Promise.all(lazyComponents.map((entry) => entry()));

// ---- 拼字符串 ----
const SAFE = Symbol('hilt.html');
const escapeText = (text) => { const s = String(text); return /[&<]/.test(s) ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;') : s; };
const escapeAttr = (text) => { const s = String(text); return /[&"]/.test(s) ? s.replace(/&/g, '&amp;').replace(/"/g, '&quot;') : s; };
const html = (text) => ({ [SAFE]: text });
export const ssr = (parts) => html(parts.join(''));
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** 单个属性写成 ` name="value"`；不出现返回 ''。tag 只用来区分 value 在不同元素上的写法 */
export function ssrAttr(name, value, tag = '') {
  if (value == null) return '';
  if (name === 'class' && typeof value === 'string') return value ? ` class="${escapeAttr(value)}"` : '';
  if (name === 'class' || name === 'style') {
    const props = { [name]: value };
    const layers = [props, undefined];
    if (name === 'class') {
      const text = classOf(layers);
      return text ? ` class="${escapeAttr(text)}"` : '';
    }
    const text = styleText(styleOf(layers));
    return text ? ` style="${escapeAttr(text)}"` : '';
  }
  let kind = (TABLE[name] ?? 0) & KIND_MASK;
  if (kind === URL) {
    if (unsafeUrl(value)) {
      warn(`${name} 是 javascript: 链接，已拦截`);
      return '';
    }
    kind = 0;
  } else if (kind === YESNO) {
    if (typeof value === 'boolean') value = value ? 'yes' : 'no';
    kind = 0;
  }
  if (kind === BOOL) {
    const on = typeof value === 'string' ? value : value ? '' : null;
    return on === null ? '' : on === '' ? ` ${name}` : ` ${name}="${escapeAttr(on)}"`;
  }
  if (kind === PROP) {
    // textarea 的值是子文本，select 的值落在 option 的 selected 上
    if (name === 'value') return tag === 'textarea' || tag === 'select' ? '' : ` value="${escapeAttr(value)}"`;
    return value ? ` ${name}` : '';
  }
  if (kind === PROP_ONLY) return '';
  if (name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110) return '';
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') return '';
  return ` ${name}="${escapeAttr(value)}"`;
}

/** 一个元素的全部属性。props 是普通对象或 merge() 的结果 */
function renderAttrs(tag, props) {
  const layers = layersOf(props);
  const { names, kinds, vals, acc } = scan(layers, true);
  let attrs = '';
  let inner;
  let value;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (UNSAFE_SPREAD[name]) {
      warn(`${name} 不能经 spread 写入`);
      continue;
    }
    if ((kinds[i] & KIND_MASK) === PROP_ONLY && CHILD[name]) {
      inner = name === 'innerHTML' ? String(vals[i]) : escapeText(vals[i]);
      continue;
    }
    if (name === 'value') {
      value = vals[i];
      if (tag === 'textarea' && value != null) inner = escapeText(value);
    }
    attrs += ssrAttr(name, vals[i], tag);
  }
  if (acc) {
    const values = acc & 4 ? sxValues(layers) : [];
    const has = values.some(Boolean);
    if (has && !config.sx) throw new Error('sx 需要样式引擎：先导入创建样式的模块（create、recipe…）');
    const sx = has ? config.sx(...values) : undefined;
    const classes = classOf(layers, sx?.class);
    if (classes) attrs += ` class="${escapeAttr(classes)}"`;
    const style = styleText(styleOf(layers, sx?.style));
    if (style) attrs += ` style="${escapeAttr(style)}"`;
  }
  return { attrs, inner, value };
}
export const ssrSpread = (props, tag = '') => renderAttrs(tag, props).attrs;

let currentSelect; // 渲染 <select value> 的子节点时，option 靠它决定 selected
/** select、textarea、option 的值不是普通 attribute：整个元素一起算。children 是读取函数，select 的值要先定下来 */
export function ssrElement(tag, props, children) {
  const { attrs, inner: own, value } = renderAttrs(tag, props);
  if (VOID.has(tag)) return html(`<${tag}${attrs}>`);
  const previous = currentSelect;
  if (tag === 'select') currentSelect = value === undefined ? undefined : { value };
  let inner;
  try {
    inner = own ?? (children ? ssrChild(children()) : '');
  } finally {
    currentSelect = previous;
  }
  let extra = '';
  if (tag === 'option' && currentSelect && String(value ?? inner) === String(currentSelect.value)) extra = ' selected';
  // HTML 解析器会吞掉 <textarea> 后面紧跟的第一个换行：值以换行开头时要补一个
  if (tag === 'textarea' && /^[\r\n]/.test(inner)) inner = `\n${inner}`;
  return html(`<${tag}${attrs}${extra}>${inner}</${tag}>`);
}
/** innerHTML={x}：编译器只在作者显式写出时生成 */
export const ssrRaw = (value) => html(value == null ? '' : String(value));

/** 动态内容。函数是独立的一段，前后放 [ ]；相邻文本之间放空注释，否则解析时会合成一个节点 */
export function ssrChild(value) {
  if (typeof value === 'string' || typeof value === 'number') return escapeText(value);
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
  const row = (item, index) => props.children(props.key ? { value: item } : item, { value: index });
  return html(`<!--[-->${items.map((item, index) => ssrChild(row(item, index))).join('')}<!--]-->`);
}

/** 每次渲染一个新的应用实例：服务按请求隔离 */
export function renderToString(render) {
  const previous = contexts;
  contexts = Object.create(ROOT);
  contexts[APP] = { services: new Map() };
  contexts[IDS] = { prefix: 'h', next: 0 };
  try {
    return ssrChild(render());
  } finally {
    contexts = previous;
  }
}
