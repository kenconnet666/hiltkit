// 浏览器运行时。编译产物只依赖这里导出的函数，这张导出表就是“预编译组件库”要稳定的 ABI。
// reactive.js 响应式内核、state.js 深代理、rules.js 属性规则（和服务端、编译器共用）、attrs.js 属性写到元素上。
import { hydrating, markBindingUsed, setHydrating } from './attrs.js';
import {
  ROOT_CONTEXT, computed, dispose, flushSync, getContext, getOwner, isDisposed, onCleanup, provideValue, renderEffect, runSetup, runWith, scope, setBoundary, signal, untrack, userEffect, withContext,
} from './reactive.js';
import { isEventKey, viewOf } from './rules.js';

export { attrBool, attrProp, attrState, attrStr, attrValue, bindInput, bound, on, setAttr, setClass, setRef, setStyle, setSx, spread } from './attrs.js';
export { computed, createContext, dispose, effect, flushSync, inject, onCleanup, onError, provide, renderEffect, signal, stats, untrack, userEffect, warnings } from './reactive.js';
export { merge, omit, registerStyleEngine, setterOf, viewOf as propsView } from './rules.js';
export { raw, snapshot, state, strictEquals } from './state.js';

// ---- 符文的小件 ----
/** let x = _derived(expr)：可以临时覆盖（乐观更新），依赖变化后重新跟随 */
class Overridable {
  constructor(read) {
    this.source = computed(read);
    this.override = signal(undefined);
  }
  get value() {
    const current = this.source.value;
    const held = this.override.value;
    return held && held.base === current ? held.value : current;
  }
  set value(next) {
    this.override.value = { value: next, base: untrack(() => this.source.value) };
  }
}
export const overridable = (read) => new Overridable(read);
/**
 * prop 的默认值：只有 undefined 才走默认值（null 是明确给的）。默认值是字面量时编译器用 or；
 * 否则放进 computed 用 orElse：用到才求值，依赖前面的 prop 时跟着变，对象默认值身份稳定
 */
export const or = (value, fallback) => (value === undefined ? fallback : value);
export const orElse = (value, cell) => (value === undefined ? cell.value : value);

const changeHandler = (key) => `on${key[0].toUpperCase()}${key.slice(1)}Change`;
/**
 * 可双向绑定的 prop：写入时通知 onXxxChange。父级给了值就以父级为准：
 * 回调没有采纳新值（比如要等接口返回）时退回父级的值，不用每个组件自己补偿
 */
class Bindable {
  constructor(props, key, initial, wrap) {
    this.props = props;
    this.key = key;
    this.wrap = wrap;
    const first = untrack(() => props[key]);
    this.local = signal(first !== undefined ? first : initial);
    this.handler = changeHandler(key);
    renderEffect(() => {
      const incoming = props[key];
      if (incoming !== undefined) this.local.value = incoming;
    });
    markBindingUsed(props, this.handler);
  }
  get value() {
    return this.local.value;
  }
  set value(next) {
    const { props, key, local } = this;
    const value = this.wrap ? this.wrap(next) : next;
    local.value = value;
    untrack(() => props[this.handler])?.(value);
    queueMicrotask(() => {
      const incoming = untrack(() => props[key]);
      if (incoming !== undefined && incoming !== untrack(() => local.value)) local.value = incoming;
    });
  }
}
/** wrap：默认是 state（和 _state 一样，整体替换后新对象也是深代理），.raw 不传。编译器传进来，不用深代理的应用不带 state.js */
export const bindable = (props, key, initial, wrap) => new Bindable(props, key, initial, wrap);

/** 选中态：n 行都在问“是不是我”时，只通知变了的那两行（同 Solid 的 createSelector） */
export function selector(read) {
  const subscribers = new Map();
  let current;
  renderEffect(() => {
    const next = read();
    const previous = subscribers.get(current);
    if (previous) previous.value = false;
    const cell = subscribers.get(next);
    if (cell) cell.value = true;
    current = next;
  });
  return (key) => {
    let cell = subscribers.get(key);
    if (!cell) subscribers.set(key, (cell = signal(key === current)));
    return cell.value;
  };
}

// ---- DOM ----
// 水合：hydrating 期间不创建节点，按文档顺序认领服务端的节点。cursor 指向下一个要认领的节点
let cursor = null;
const isMark = (node, data) => node?.nodeType === 8 && node.data === data;
/** 动态段的 [ 对应的 ] */
function closeOf(open) {
  let depth = 0;
  for (let node = open.nextSibling; node; node = node.nextSibling) {
    if (isMark(node, '[')) depth++;
    else if (isMark(node, ']') && depth-- === 0) return node;
  }
  throw new Error('水合：动态段没有结束标记');
}
function openOf(close) {
  let depth = 0;
  for (let node = close.previousSibling; node; node = node.previousSibling) {
    if (isMark(node, ']')) depth++;
    else if (isMark(node, '[') && depth-- === 0) return node;
  }
  throw new Error('水合：动态段没有开始标记');
}
/** 编译产物走子节点都经过这两个函数：水合时跳过动态段，停在它的 ]，和模板里的 <!> 位置对应 */
const skipRange = (node) => (hydrating && isMark(node, '[') ? closeOf(node) : node);
export const first = (el) => skipRange(el.firstChild);
export const next = (node) => skipRange(node.nextSibling);

/** svg：根元素是 SVG 的子元素（<path>、<g>），要放进 <svg> 里解析才有正确的命名空间 */
export function template(html, svg = false) {
  let node;
  return () => {
    if (hydrating) {
      const claimed = cursor;
      cursor = claimed.nextSibling;
      return claimed;
    }
    if (!node) {
      const tpl = document.createElement('template');
      tpl.innerHTML = svg ? `<svg>${html}</svg>` : html;
      node = svg ? tpl.content.firstChild.firstChild : tpl.content.firstChild;
    }
    return node.cloneNode(true);
  };
}

/** 水合时的 toNodes：元素已经被 template 认领了，这里把文本和嵌套的动态段也认领掉 */
function claim(value) {
  if (value == null || value === false || value === true || value instanceof Node) return;
  if (Array.isArray(value)) {
    for (const item of value) claim(item);
    return;
  }
  if (typeof value === 'function') {
    const close = closeOf(cursor);
    cursor = close.nextSibling;
    insert(close.parentNode, value, close);
    return;
  }
  // 相邻文本之间的空注释（服务端为了不让它们合成一个节点放的）
  if (isMark(cursor, '')) cursor = cursor.nextSibling;
  if (cursor?.nodeType === 3) cursor = cursor.nextSibling;
}

/** 把值展开成节点；函数是一段独立的动态内容，放进文档片段里起一个嵌套的 insert */
function toNodes(value, out = []) {
  if (value == null || value === false || value === true) return out;
  if (Array.isArray(value)) {
    for (const item of value) toNodes(item, out);
    return out;
  }
  if (typeof value === 'function') {
    const fragment = document.createDocumentFragment();
    const marker = document.createComment('');
    fragment.append(marker);
    insert(fragment, value, marker);
    out.push(fragment);
    return out;
  }
  out.push(value instanceof Node ? value : document.createTextNode(String(value)));
  return out;
}
/** 这一段的内容就是个内容函数（{children}）：直接调用，同一个 effect 就够了，不用再嵌一层 */
function unwrap(value) {
  while (typeof value === 'function') value = value();
  return value;
}
/**
 * 动态子节点：文本就地改，其余换节点。
 * 内容可能自己增减节点（列表、嵌套的动态段）时记不住有哪些节点，这时在前面放一个起点，按范围删
 */
export function insert(parent, read, marker = null) {
  let start;
  let single;
  let text;
  // 水合后才知道：这段是父元素的全部内容、又不止一个节点，清空时整个父元素清掉就行
  let wholeParent = false;
  let adopting = hydrating;
  const saved = getContext();
  renderEffect(() => {
    if (adopting) {
      adopting = false;
      const resume = cursor;
      if (marker) {
        start = openOf(marker);
        cursor = start.nextSibling;
      } else {
        cursor = parent.firstChild;
      }
      claim(withContext(saved, () => unwrap(read())));
      cursor = resume;
      if (marker) {
        const only = start.nextSibling;
        if (only !== marker && only.nextSibling === marker && only.nodeType === 3) text = only;
      } else if (parent.childNodes.length === 1) {
        single = parent.firstChild;
        text = single.nodeType === 3 ? single : undefined;
      } else if (parent.firstChild) {
        wholeParent = true;
      }
      return;
    }
    const value = withContext(saved, () => unwrap(read()));
    if (text && (typeof value === 'string' || typeof value === 'number')) {
      text.data = String(value);
      return;
    }
    const target = marker ? marker.parentNode : parent;
    if (start) {
      while (start.nextSibling !== marker) target.removeChild(start.nextSibling);
    } else if (single) {
      target.removeChild(liveNode(single));
    } else if (wholeParent) {
      target.textContent = '';
      wholeParent = false;
    }
    const nodes = toNodes(value);
    if (!start && (nodes.length > 1 || nodes[0]?.nodeType === 11)) {
      start = document.createComment('');
      target.insertBefore(start, marker);
    }
    for (const node of nodes) target.insertBefore(node, marker);
    single = !start ? nodes[0] : undefined;
    text = single?.nodeType === 3 ? single : undefined;
  });
}

/**
 * 组件体只执行一次；不占作用域节点，effect 挂在最近的 owner 上。merge 的结果在这里才建能读属性的视图。
 * provider 组件直接返回 children 时，内容是之后才求值的函数：包一层带上组件体里 provide 出来的 context
 */
export function component(Comp, props) {
  const before = getContext();
  let inner = before;
  const result = runSetup((view) => {
    const value = Comp(view);
    inner = getContext();
    return value;
  }, viewOf(props));
  return inner === before ? result : carryContext(result, inner);
}
function carryContext(value, saved) {
  if (typeof value === 'function') return () => withContext(saved, value);
  if (Array.isArray(value)) return value.map((item) => carryContext(item, saved));
  return value;
}

// ---- 错误边界、传送、稳定 id ----
/**
 * 错误边界：子树渲染或更新时抛错，显示 fallback(错误, 重试)。没有边界时交给 onError，默认 reportError。
 *   <Boundary fallback={(error, retry) => <p onClick={retry}>{error.message}</p>}>…</Boundary>
 */
export function Boundary(props) {
  const failure = signal(undefined);
  const content = () => {
    const current = failure.value;
    if (current !== undefined) return untrack(() => props.fallback(current.error, () => (failure.value = undefined)));
    setBoundary(getOwner(), (error) => (failure.value = { error }));
    return untrack(() => unwrap(props.children));
  };
  // 放进数组：内容单独一段（自己的 effect）。直接返回函数会和外层共用 effect，出错重跑时连边界本身也重建，状态丢了就死循环
  return [content];
}
/**
 * 传送：内容渲染到别的容器（默认 document.body），context 和销毁都跟着所在位置。
 * 服务端不输出；客户端挂载之后才创建，所以不参与水合
 */
export function Portal(props) {
  userEffect(() => {
    const target = props.to ?? document.body;
    const start = document.createComment('');
    const end = document.createComment('');
    target.append(start, end);
    insert(target, () => props.children, end);
    return () => {
      for (let node = start.nextSibling; node !== end; node = start.nextSibling) target.removeChild(node);
      target.removeChild(start);
      target.removeChild(end);
    };
  });
}
/** 稳定 id：服务端和客户端按同样的顺序得到同样的值，给 aria-labelledby、label for 用。懒加载的段各有自己的前缀，推迟接管也不错位 */
const IDS = Symbol('ids');
export function useId() {
  const ids = getContext()[IDS];
  return `${ids.prefix}${ids.next++}`;
}
function forkIds() {
  const ids = getContext()[IDS];
  if (ids) provideValue(IDS, { prefix: `${ids.prefix}${ids.next++}-`, next: 0 });
}

// ---- 开发期热更新：编译器只在开发服务器上生成这些调用，生产构建摇掉 ----
const hotRecords = new Map();
/** 模块 -> 这个模块里的组件。改一个文件只看它自己的组件，不随组件库总量变慢 */
const hotByModule = new Map();
const hotModules = new Map();
const hotValues = new Map();
/** 元素被热更新替换后，手里还拿着旧节点的地方（列表行、insert）顺着它找到新节点 */
const liveNode = (node) => {
  while (node?.$$hotNext) node = node.$$hotNext;
  return node;
};
function renderHotInstance(record, instance) {
  let value;
  // 开发期每个实例一个作用域：改组件时只销毁它自己
  instance.scope = scope(() => {
    value = runSetup(record.fn, viewOf(instance.props));
  });
  return value;
}
/** 组件的稳定包装：导入方手里的引用永远是它。同一个 id 再次调用（模块重新执行）只记下新函数 */
export function hotComponent(id, fn) {
  const existing = hotRecords.get(id);
  if (existing) {
    existing.next = fn;
    return existing.wrapper;
  }
  const record = { id, fn, next: undefined, instances: new Set(), wrapper: undefined };
  record.wrapper = (props) => {
    const instance = { props, owner: getOwner(), saved: getContext(), node: undefined, scope: undefined };
    const value = renderHotInstance(record, instance);
    instance.node = value;
    record.instances.add(instance);
    onCleanup(() => record.instances.delete(instance));
    return value;
  };
  hotRecords.set(id, record);
  const moduleId = id.slice(0, id.lastIndexOf('#'));
  const siblings = hotByModule.get(moduleId);
  if (siblings) siblings.push(record);
  else hotByModule.set(moduleId, [record]);
  return record.wrapper;
}
/** 顶层的 context、服务跨热更新保持同一个对象 */
export function hotValue(id, create) {
  if (!hotValues.has(id)) hotValues.set(id, create());
  return hotValues.get(id);
}
export function hotModule(id, skeleton, surface) {
  const known = hotModules.get(id);
  hotModules.set(id, { skeleton, surface, previous: known?.skeleton, previousSurface: known?.surface });
}
/** 新模块执行完之后调用。骨架没变：只改了样式，规则已经原地改好。变了：只重建这个模块里组件的实例 */
export function hotCommit(id, otherExports, hot) {
  const { skeleton, surface, previous, previousSurface } = hotModules.get(id);
  const records = hotByModule.get(id) ?? [];
  if (skeleton === previous) {
    for (const record of records) record.next = undefined;
    window.__hiltHot?.({ kind: 'style', id });
    return;
  }
  let rebuilt = 0;
  for (const record of records) {
    if (record.next) record.fn = record.next;
    record.next = undefined;
    for (const instance of [...record.instances]) {
      const old = liveNode(instance.node);
      if (!(old instanceof Node) || !old.parentNode) {
        // 根不是单个节点（返回列表、片段）：换不了，让导入方重新执行
        hot.invalidate('组件的根不是单个元素');
        return;
      }
      dispose(instance.scope);
      const value = runWith(instance.owner, instance.saved, () => renderHotInstance(record, instance));
      if (!(value instanceof Node)) {
        hot.invalidate('组件的根不是单个元素');
        return;
      }
      old.replaceWith(value);
      old.$$hotNext = value;
      instance.node = value;
      rebuilt++;
    }
  }
  flushSync();
  window.__hiltHot?.({ kind: 'component', id, rebuilt });
  // 导出的函数、常量真的变了：导入方拿着旧的，要它们也重新执行。只改了组件就不用
  if (otherExports && surface !== previousSurface) hot.invalidate('导出的函数或常量变了');
}

// ---- 懒加载 ----
const REPLAYED = ['pointerdown', 'pointerup', 'click', 'focusin', 'input', 'keydown'];
const describe = (event) => ({ target: event.target, type: event.type, constructor: event.constructor, init: event });
/**
 * 懒加载组件。代码第一次要渲染时才加载；SSR 过的内容可以推迟接管：
 *   hydrate: 'load'（尽快）| 'visible'（进入视口）| 'idle'（空闲）| 'interaction'（用户碰到时，事件接管后重放）
 * 推迟期间内容已经在页面上，靠 [ ] 标记跳过这一段，不创建任何 effect
 */
export function lazy(load, options = {}) {
  let loaded;
  let pending;
  const fetchComponent = () =>
    (pending ??= load().then((module) => {
      loaded = module.default ?? module;
      return loaded;
    }));
  const Lazy = (props) => {
    forkIds();
    if (hydrating && !loaded && isMark(cursor, '[')) return deferHydration(props);
    if (loaded) return component(loaded, props);
    const ready = signal(false);
    const saved = getContext();
    fetchComponent().then(() => (ready.value = true));
    return () => (ready.value ? withContext(saved, () => component(loaded, props)) : props.fallback);
  };

  function deferHydration(props) {
    const open = cursor;
    const close = closeOf(open);
    cursor = close.nextSibling;
    const owner = getOwner();
    const saved = getContext();
    // 等待期间 prop 变了：服务端的内容已经过时，不能接管，只能重新渲染。children 读了就会创建内容，不算
    const keys = Object.keys(props).filter((key) => key !== 'children' && key !== 'fallback' && !isEventKey(key));
    const initial = untrack(() => keys.map((key) => props[key]));
    let disposed = false;
    let cancelTrigger = () => {};
    onCleanup(() => {
      disposed = true;
      cancelTrigger();
    });
    const adopt = (replay) =>
      fetchComponent().then(() => {
        if (disposed || isDisposed(owner)) return;
        const changed = untrack(() => keys.some((key, index) => props[key] !== initial[index]));
        const parent = close.parentNode;
        if (changed) {
          while (open.nextSibling !== close) parent.removeChild(open.nextSibling);
        } else {
          setHydrating(true);
        }
        try {
          runWith(owner, saved, () => insert(parent, () => component(loaded, props), close));
        } finally {
          setHydrating(false);
        }
        replay?.();
      });
    cancelTrigger = armTrigger(options.hydrate ?? 'load', open, close, adopt);
    return close;
  }
  Lazy.preload = fetchComponent;
  return Lazy;
}
/** 动态段里的元素：触发器挂在它们上面 */
function elementsIn(open, close) {
  const elements = [];
  for (let node = open.nextSibling; node !== close; node = node.nextSibling) if (node.nodeType === 1) elements.push(node);
  return elements;
}
function armTrigger(strategy, open, close, adopt) {
  if (strategy === 'load') {
    adopt();
    return () => {};
  }
  if (strategy === 'idle') {
    // Safari 没有 requestIdleCallback
    if (typeof requestIdleCallback !== 'function') {
      const id = setTimeout(adopt, 200);
      return () => clearTimeout(id);
    }
    const id = requestIdleCallback(() => adopt());
    return () => cancelIdleCallback(id);
  }
  const elements = elementsIn(open, close);
  if (strategy === 'visible') {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      adopt();
    });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }
  // interaction：第一个事件触发接管，加载期间的事件都排队，接管后按顺序在原来的目标上重放。
  // 一次点击是 pointerdown、pointerup、click 一串，只记第一个的话 click 就丢了
  const queue = [];
  const cancel = () => {
    for (const element of elements) for (const type of REPLAYED) element.removeEventListener(type, onEvent, true);
  };
  function onEvent(event) {
    event.stopImmediatePropagation();
    // click 的默认行为（提交、跳转）留给重放；按键、输入不拦，否则字符打不进去
    if (event.type === 'click') event.preventDefault();
    queue.push(event);
    if (queue.length > 1) return;
    adopt(() => {
      cancel();
      for (const { target, type, constructor: Event, ...rest } of queue.map(describe)) target.dispatchEvent(new Event(type, rest.init));
    });
  }
  for (const element of elements) for (const type of REPLAYED) element.addEventListener(type, onEvent, true);
  return cancel;
}

// ---- 服务 ----
/**
 * 服务：第一次 use 时才创建，整个应用（或 provide 的那棵子树）一份。
 * 函数体里可以用符文，effect 跟着应用走，不跟着第一个调用它的组件走。
 * 应用实例是每次 mount / hydrate / renderToString 新建的，所以服务端天然按请求隔离。
 */
const APP = Symbol('app');
function createApp(run) {
  const app = { services: new Map(), node: undefined, context: Object.create(ROOT_CONTEXT) };
  app.context[APP] = app;
  app.context[IDS] = { prefix: 'h', next: 0 };
  const node = runWith(undefined, app.context, () =>
    scope(() => {
      app.node = getOwner();
      run();
    }),
  );
  return () => dispose(node);
}
export function createService(factory) {
  const id = Symbol('service');
  return {
    use() {
      const context = getContext();
      const provided = context[id];
      if (provided !== undefined) return provided;
      const app = context[APP];
      if (!app) throw new Error('服务只能在组件或其他服务里使用');
      // 服务属于应用：context 回到根，看不到第一个调用者一路 provide 的值
      if (!app.services.has(id)) app.services.set(id, runWith(app.node, app.context, () => runSetup(factory)));
      return app.services.get(id);
    },
    /** 这棵子树用自己的一份；传了值就用传的（测试替身） */
    provide(value) {
      const instance = value !== undefined ? value : runSetup(factory);
      provideValue(id, instance);
      return instance;
    },
  };
}

// ---- 列表 ----
/** 最长递增子序列的下标：这些节点相对顺序没变，不用动 */
function longestIncreasing(values) {
  const tails = [];
  const previous = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (values[i] < 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < values[i]) low = middle + 1;
      else high = middle;
    }
    previous[i] = low > 0 ? tails[low - 1] : -1;
    tails[low] = i;
  }
  const keep = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = previous[i]) keep.add(i);
  return keep;
}
/** 把节点排成 next 的顺序，只动不在最长递增子序列里的节点：交换两行只动两个 */
function placeRows(parent, marker, before, next) {
  const indexOf = new Map();
  before.forEach((row, index) => indexOf.set(row, index));
  const keep = longestIncreasing(next.map((row) => indexOf.get(row) ?? -1));
  let anchor = marker;
  for (let i = next.length - 1; i >= 0; i--) {
    const node = liveNode(next[i].node);
    if (!keep.has(i)) parent.insertBefore(node, anchor);
    anchor = node;
  }
}

/** 列表：默认按对象身份复用行；给了 key 时同 key 的行复用，item 和下标都是读取（.value） */
export function For(props) {
  let adopting = hydrating;
  const open = adopting ? cursor : undefined;
  const marker = adopting ? closeOf(open) : document.createComment('');
  const fragment = adopting ? undefined : document.createDocumentFragment();
  fragment?.append(marker);
  let rows = new Map();
  let order = [];
  const saved = getContext();
  // 行挂在列表所在的 owner 上：列表的 effect 重跑时不能销毁行；所在的分支销毁时行要跟着销毁
  const owner = getOwner();
  renderEffect(() => {
    // 只订阅“列表变了”：深代理的 slice 一次订阅整个数组，不给每个下标建 signal；行的内容和 key 由行自己读
    const items = props.each?.slice() ?? [];
    const render = props.children;
    const keyOf = props.key;
    untrack(() => reconcile(items, render, keyOf));
  });
  function reconcile(items, render, keyOf) {
    const parent = marker.parentNode;
    const createRow = (item, index) => {
      const row = { node: undefined, scope: undefined, item: keyOf ? signal(item) : undefined, index: signal(index) };
      row.scope = runWith(owner, saved, () =>
        scope(() => {
          row.node = render(keyOf ? row.item : item, row.index);
        }),
      );
      return row;
    };
    if (adopting) {
      adopting = false;
      cursor = open.nextSibling;
      items.forEach((item, index) => rows.set(keyOf ? keyOf(item) : item, createRow(item, index)));
      order = [...rows.values()];
      cursor = marker.nextSibling;
      return;
    }
    if (!items.length && rows.size) {
      // 整个父元素只有这张列表时直接清空，快一个数量级
      const first = parent.firstChild;
      if (parent.lastChild === marker && first?.nodeType === 8 && parent.childNodes.length === rows.size + 2) {
        parent.textContent = '';
        parent.append(first, marker);
      } else {
        for (const row of rows.values()) parent.removeChild(liveNode(row.node));
      }
      for (const row of rows.values()) dispose(row.scope);
      rows = new Map();
      order = [];
      return;
    }
    const next = new Map();
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const key = keyOf ? keyOf(item) : item;
      let row = rows.get(key);
      if (row) {
        rows.delete(key);
        row.index.value = index;
        if (row.item) row.item.value = item;
      } else {
        row = createRow(item, index);
      }
      next.set(key, row);
    }
    for (const row of rows.values()) {
      parent.removeChild(liveNode(row.node));
      dispose(row.scope);
    }
    placeRows(parent, marker, order, (order = [...next.values()]));
    rows = next;
  }
  return fragment ?? marker;
}

/** 接管服务端渲染的内容：不创建节点、不写 DOM，只把 effect 和事件接上 */
export function hydrate(render, host) {
  setHydrating(true);
  cursor = host.firstChild;
  try {
    return createApp(() => claim(render()));
  } finally {
    setHydrating(false);
    cursor = null;
    flushSync();
  }
}

export function mount(render, host) {
  const stop = createApp(() => host.append(...toNodes(render())));
  flushSync();
  return stop;
}
