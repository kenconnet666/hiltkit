// 原型运行时。编译产物只依赖这里导出的函数，这张导出表就是“预编译组件库”要稳定的 ABI。
import * as alien from 'alien-signals';
import { hasKey, isEvent, keysOf, layersOf, merge, omit, readClass, readKey, readSx, sourceOf } from './props.js';

export { merge, omit };

// ---- 响应式：alien-signals + 微任务批处理 ----
export const warnings = [];
let setupScope;
export function untrack(read) {
  const previous = alien.setActiveSub(undefined);
  try {
    return read();
  } finally {
    alien.setActiveSub(previous);
  }
}
let batching = false;
function closeBatch() {
  // flushSync 已经关过这一批：排好的微任务再来时不能再 endBatch，否则批次深度变负，之后 effect 全都不跑
  if (!batching) return;
  batching = false;
  alien.endBatch();
}
/** 同一轮里多次写只更新一次 DOM；读派生值总是新的（alien 是拉取式） */
export function signal(initial) {
  const cell = alien.signal(initial);
  return function (...next) {
    if (!next.length) {
      // 开发期诊断：组件体顶层读响应式数据只拿到当前值。跨文件也查得到，这是编译器做不到的
      // 也不能真的追踪：alien 的作用域会把读到的 signal 传给外层 effect，整个组件就被重建了
      if (setupScope !== undefined && alien.getActiveSub() === setupScope) {
        warnings.push(new Error().stack);
        return untrack(cell);
      }
      return cell();
    }
    if (!batching) {
      batching = true;
      alien.startBatch();
      queueMicrotask(closeBatch);
    }
    cell(next[0]);
  };
}
/** 立刻把挂起的更新做完（测试与基准用） */
export function flushSync() {
  runPendingEffects();
  if (batching) closeBatch();
  runPendingEffects();
}
export function computed(read) {
  const cell = alien.computed(read);
  return () => (setupScope !== undefined && alien.getActiveSub() === setupScope ? untrack(cell) : cell());
}
/**
 * effect 的返回值被 alien 当清理函数，这里只放行函数。
 * 错误就地报告不往外抛：alien 的 flush 遇到异常会丢掉同一轮排在后面的 effect
 */
export function effect(fn) {
  return alien.effect(() => {
    try {
      const cleanup = fn();
      return typeof cleanup === 'function' ? cleanup : undefined;
    } catch (error) {
      reportError(error);
    }
  });
}
export const scope = alien.effectScope;
/**
 * _effect：挂载之后才第一次执行（同 Svelte）。创建时就跑的话，它改的状态会让初始输出和服务端不一样，
 * 水合就对不上；ref 也还没拿到。DOM 绑定（effect）不走这里，它们要在创建时把 DOM 写好。
 */
const pendingEffects = [];
export function userEffect(fn) {
  if (!pendingEffects.length) queueMicrotask(runPendingEffects);
  pendingEffects.push({ fn, owner: alien.getActiveSub(), saved: contexts });
}
function runPendingEffects() {
  const batch = pendingEffects.splice(0);
  const previous = alien.setActiveSub(undefined);
  for (const { fn, owner, saved } of batch) {
    // 还没等到第一次执行，所在的分支、组件已经销毁了
    if (owner && !owner.flags) continue;
    alien.setActiveSub(owner);
    withOwner(saved, () => effect(fn));
  }
  alien.setActiveSub(previous);
}
/** 所在组件（或分支、列表行）销毁时执行。设置期的动作（向父组件注册等）配它，不要放进 effect：服务端不跑 effect，effect 里读写同一状态还会自触发 */
export function onCleanup(fn) {
  alien.effect(() => fn);
}
/** let x = _derived(expr)：可以临时覆盖（乐观更新），依赖变化后重新跟随 */
export function overridable(read) {
  const source = computed(read);
  const override = signal(undefined);
  return function (...next) {
    if (next.length) {
      override({ value: next[0], base: untrack(source) });
      return;
    }
    const current = source();
    const held = override();
    return held && held.base === current ? held.value : current;
  };
}

const PROXIES = new WeakMap();
const KNOWN_PROXIES = new WeakSet();
const isPlain = (value) => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === Array.prototype || proto === null;
};
/** const x = _state({...})：深层代理，属性第一次被读时才建 signal */
export function deep(target) {
  // 已经是代理：不再包一层，否则同一行的身份变了，列表认不出来
  if (!isPlain(target) || KNOWN_PROXIES.has(target)) return target;
  const existing = PROXIES.get(target);
  if (existing) return existing;
  const cells = new Map();
  const version = alien.signal(0);
  const cell = (key) => {
    let s = cells.get(key);
    if (!s) cells.set(key, (s = signal(target[key])));
    return s;
  };
  const proxy = new Proxy(target, {
    get(_, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver);
      if (!(key in target)) {
        version();
        return undefined;
      }
      const value = target[key];
      if (typeof value === 'function') return value;
      return deep(cell(key)());
    },
    set(_, key, value) {
      const had = key in target;
      target[key] = value;
      if (typeof key === 'symbol') return true;
      if (cells.has(key)) cells.get(key)(value);
      if (!had) version(version() + 1);
      return true;
    },
    ownKeys() {
      version();
      return Reflect.ownKeys(target);
    },
  });
  PROXIES.set(target, proxy);
  KNOWN_PROXIES.add(proxy);
  return proxy;
}

// ---- 属性放到元素上（合并本身在 props.js，和服务端共用） ----
function isReactiveKey(layers, key) {
  for (const layer of layers) {
    if (typeof layer.source === 'function') return true;
    if (layer.hidden?.has(key)) continue;
    // Proxy 视图没有 getter 描述符，但这里的层都已经拍平，来源只会是普通对象
    if (Object.getOwnPropertyDescriptor(layer.source, key)?.get) return true;
  }
  return false;
}

export function setAttr(el, key, value) {
  // 水合时服务端已经写好了，不碰 DOM
  if (hydrating) return;
  if (key === 'class') el.className = value ?? '';
  else if (key === 'value' || key === 'checked') el[key] = value;
  else if (key === 'style' && typeof value === 'object' && value) {
    for (const name in value) el.style.setProperty(name, value[name]);
  } else if (value == null || value === false) el.removeAttribute(key);
  else el.setAttribute(key, value === true ? '' : value);
}

// ---- _bind ----
const BOUND = Symbol('hilt.bound');
const changeHandler = (key) => `on${key[0].toUpperCase()}${key.slice(1)}Change`;
/** 编译器生成的回写函数：记下它绑的是哪个 prop，好查出“绑到了只读 prop 上”。这件事类型层拦不住 */
const pendingBinds = new Set();
export function bound(write, key) {
  write[BOUND] = key;
  if (!pendingBinds.size) queueMicrotask(reportUnusedBinds);
  pendingBinds.add(write);
  return write;
}
function reportUnusedBinds() {
  for (const write of pendingBinds) warnings.push(`_bind 绑到了只读 prop：${write[BOUND]}。子组件要声明成 ${write[BOUND]} = _bindable(默认值)`);
  pendingBinds.clear();
}
function markBindingUsed(props, handler) {
  for (const layer of layersOf(props)) {
    if (!hasKey(layer, handler)) continue;
    const write = sourceOf(layer)[handler];
    if (write?.[BOUND]) pendingBinds.delete(write);
  }
}

/**
 * 原生元素的双向绑定。属性还是原生属性，这里只是多接一个事件，并处理几个手写容易错的地方：
 * 中文输入法组合期间不写回；number、range 按数字读回；多选组按元素的 value 增删数组。
 */
export function bindInput(el, key, read, write, mods = [], listenOnly = false) {
  const group = mods.includes('group');
  if (!listenOnly) {
    effect(() => {
      const value = read();
      if (hydrating) return;
      if (group) el.checked = value.includes(el.value);
      else if (key === 'files') return;
      else if (key === 'value') {
        const text = value == null ? '' : String(value);
        if (el.value !== text) el.value = text;
      } else if (el[key] !== value) el[key] = value;
    });
  }
  const eventName =
    key === 'open' ? 'toggle' : key === 'value' && !mods.includes('lazy') && el.tagName !== 'SELECT' ? 'input' : 'change';
  const numeric = mods.includes('number') || el.type === 'number' || el.type === 'range';
  const readBack = () => {
    if (group) {
      const list = untrack(read);
      return el.checked ? [...list, el.value] : list.filter((item) => item !== el.value);
    }
    if (key !== 'value') return el[key];
    let value = el.value;
    if (mods.includes('trim')) value = value.trim();
    if (numeric && value !== '') value = Number(value);
    return value;
  };
  el.addEventListener(eventName, (event) => {
    if (event.isComposing) return;
    write(readBack());
  });
  if (eventName === 'input') el.addEventListener('compositionend', () => write(readBack()));
}

function listenLayers(el, layers, key) {
  el.addEventListener(key.slice(2).toLowerCase(), (event) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      if (!hasKey(layers[i], key)) continue;
      const handler = sourceOf(layers[i])[key];
      if (typeof handler !== 'function') continue;
      handler(event);
      if (event.defaultPrevented) return;
    }
  });
}

// 样式引擎由使用它的包挂上来：运行时本身不依赖样式
let styleEngine;
export const useStyleEngine = (attrs) => (styleEngine = attrs);

/** class 与 sx 一起算：各层的 sx 按层序交给引擎合成一个类，再和各层的 class 拼起来；动态值进行内变量 */
function bindClassAndSx(el, layers) {
  let lastClass;
  let lastInline = {};
  const apply = () => {
    const sx = readSx(layers);
    const composed = sx.length ? styleEngine(...sx) : {};
    const own = readClass(layers);
    const next = own && composed.class ? `${own} ${composed.class}` : own || composed.class || '';
    const inline = composed.style ?? {};
    if (hydrating) {
      lastClass = next;
      lastInline = inline;
      return;
    }
    if (next !== lastClass) el.className = lastClass = next;
    for (const name in inline) if (lastInline[name] !== inline[name]) el.style.setProperty(name, inline[name]);
    for (const name in lastInline) if (!(name in inline)) el.style.removeProperty(name);
    lastInline = inline;
  };
  if (isReactiveKey(layers, 'class') || isReactiveKey(layers, 'sx')) return effect(apply);
  apply();
}

export function spread(el, props) {
  const layers = layersOf(props);
  const owner = alien.getActiveSub();
  const active = new Map();
  let styled = false;
  const bind = (key) => {
    if (key === 'ref' || key === 'children') return;
    if (key === 'class' || key === 'sx') {
      if (styled) return;
      styled = true;
      active.set(key, bindClassAndSx(el, layers));
      return;
    }
    if (isEvent(key)) {
      // 绑定经 ...rest 转交到了原生元素：在这里接上事件，属性本身走下面普通的路
      const forwarded = layers.map((layer) => (hasKey(layer, key) ? sourceOf(layer)[key] : undefined)).find((fn) => fn?.[BOUND]);
      if (forwarded) {
        pendingBinds.delete(forwarded);
        const target = forwarded[BOUND];
        bindInput(el, target, () => readKey(layers, target), (next) => readKey(layers, key)(next), [], true);
        active.set(key, undefined);
        return;
      }
      listenLayers(el, layers, key);
      active.set(key, undefined);
      return;
    }
    if (!isReactiveKey(layers, key)) return setAttr(el, key, readKey(layers, key));
    let last;
    active.set(
      key,
      effect(() => {
        const value = readKey(layers, key);
        if (value === last) return;
        last = value;
        setAttr(el, key, value);
      }),
    );
  };
  if (layers.some((layer) => typeof layer.source === 'function')) {
    effect(() => {
      const keys = keysOf(layers);
      const previous = alien.setActiveSub(owner);
      for (const key of keys) if (!active.has(key)) bind(key);
      alien.setActiveSub(previous);
      for (const [key, stop] of active) {
        if (keys.has(key)) continue;
        stop?.();
        active.delete(key);
        if (!isEvent(key)) setAttr(el, key, undefined);
      }
    });
  } else {
    for (const key of keysOf(layers)) bind(key);
  }
  for (const layer of layers) if (hasKey(layer, 'ref')) setRef(el, sourceOf(layer).ref);
}

/** ref 拿到元素；元素卸载时拿到 null，不留指向已移除节点的引用 */
export function setRef(el, ref) {
  if (!ref) return;
  ref(el);
  alien.effect(() => () => ref(null));
}

// ---- DOM ----
// 水合：hydrating 期间不创建节点，按文档顺序认领服务端的节点。cursor 指向下一个要认领的节点
let hydrating = false;
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

export function template(html) {
  let node;
  return () => {
    if (hydrating) {
      const claimed = cursor;
      cursor = claimed.nextSibling;
      return claimed;
    }
    if (!node) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      node = tpl.content.firstChild;
    }
    return node.cloneNode(true);
  };
}
// 常见的冒泡事件委托到 document：几千行列表不用几千个监听（同 Solid）
const DELEGATED = new Set(['click', 'input', 'keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']);
const delegated = new Set();
function dispatch(event) {
  const key = `$$${event.type}`;
  for (let node = event.target; node; node = node.parentNode) {
    node[key]?.(event);
    if (event.cancelBubble) return;
  }
}
export function on(el, name, handler) {
  if (!DELEGATED.has(name)) return el.addEventListener(name, handler);
  if (!delegated.has(name)) {
    delegated.add(name);
    document.addEventListener(name, dispatch);
  }
  el[`$$${name}`] = handler;
}
/** 选中态：n 行都在问“是不是我”时，只通知变了的那两行（同 Solid 的 createSelector） */
export function selector(read) {
  const subscribers = new Map();
  let current;
  alien.effect(() => {
    const next = read();
    subscribers.get(current)?.(false);
    subscribers.get(next)?.(true);
    current = next;
  });
  return (key) => {
    let cell = subscribers.get(key);
    if (!cell) subscribers.set(key, (cell = alien.signal(key === current)));
    return cell();
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
  const saved = contexts;
  effect(() => {
    if (adopting) {
      adopting = false;
      const resume = cursor;
      if (marker) {
        start = openOf(marker);
        cursor = start.nextSibling;
      } else {
        cursor = parent.firstChild;
      }
      claim(withOwner(saved, () => unwrap(read())));
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
    const value = withOwner(saved, () => unwrap(read()));
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

// ---- 依赖注入：context 用原型链（同 Vue 的 provides），查找不随组件深度变慢 ----
// 组件本身不占内存：只有 provide 才新建一层。“当前 context”是个指针，之后才创建内容的 insert、For 记下它
const ROOT = Object.create(null);
let contexts = ROOT;
/** 回到创建时的 context 再执行：分支、列表项是之后才建的，也要看得到外层提供的值 */
function withOwner(saved, fn) {
  const previous = contexts;
  contexts = saved;
  try {
    return fn();
  } finally {
    contexts = previous;
  }
}
/** 组件体只执行一次；放进自己的作用域，里面的读不被外层 effect 追踪 */
export function component(Comp, props) {
  let result;
  const previous = contexts;
  try {
    alien.effectScope(() => {
      const outerSetup = setupScope;
      setupScope = alien.getActiveSub();
      try {
        result = Comp(props);
      } finally {
        setupScope = outerSetup;
      }
    });
  } finally {
    contexts = previous;
  }
  return result;
}
// ---- 开发期热更新：编译器只在开发服务器上生成这些调用，生产构建摇掉 ----
const hotRecords = new Map();
const hotModules = new Map();
const hotValues = new Map();
/** 元素被热更新替换后，手里还拿着旧节点的地方（列表行、insert）顺着它找到新节点 */
const liveNode = (node) => {
  while (node?.$$hotNext) node = node.$$hotNext;
  return node;
};
function renderHotInstance(record, instance) {
  let value;
  instance.dispose = alien.effectScope(() => {
    const outerSetup = setupScope;
    setupScope = alien.getActiveSub();
    try {
      value = record.fn(instance.props);
    } finally {
      setupScope = outerSetup;
    }
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
    const instance = { props, owner: alien.getActiveSub(), saved: contexts, node: undefined, dispose: undefined };
    const value = renderHotInstance(record, instance);
    instance.node = value;
    record.instances.add(instance);
    alien.effect(() => () => record.instances.delete(instance));
    return value;
  };
  hotRecords.set(id, record);
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
  const records = [...hotRecords.values()].filter((record) => record.id.startsWith(`${id}#`));
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
      instance.dispose();
      const previousSub = alien.setActiveSub(instance.owner);
      const value = withOwner(instance.saved, () => renderHotInstance(record, instance));
      alien.setActiveSub(previousSub);
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
  runPendingEffects();
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
    if (hydrating && !loaded && isMark(cursor, '[')) return deferHydration(props);
    if (loaded) return component(loaded, props);
    const ready = signal(false);
    fetchComponent().then(() => ready(true));
    return () => (ready() ? component(loaded, props) : props.fallback);
  };

  function deferHydration(props) {
    const open = cursor;
    const close = closeOf(open);
    cursor = close.nextSibling;
    const owner = alien.getActiveSub();
    const saved = contexts;
    // 等待期间 prop 变了：服务端的内容已经过时，不能接管，只能重新渲染。children 读了就会创建内容，不算
    const keys = Object.keys(props).filter((key) => key !== 'children' && key !== 'fallback' && !isEvent(key));
    const initial = untrack(() => keys.map((key) => props[key]));
    let disposed = false;
    let cancelTrigger = () => {};
    alien.effect(() => () => {
      disposed = true;
      cancelTrigger();
    });
    const adopt = (replay) =>
      fetchComponent().then(() => {
        if (disposed) return;
        const changed = untrack(() => keys.some((key, index) => props[key] !== initial[index]));
        const parent = close.parentNode;
        const previous = alien.setActiveSub(owner);
        if (changed) {
          while (open.nextSibling !== close) parent.removeChild(open.nextSibling);
        } else {
          hydrating = true;
        }
        try {
          withOwner(saved, () => insert(parent, () => component(loaded, props), close));
        } finally {
          hydrating = false;
          alien.setActiveSub(previous);
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

export function createContext(fallback) {
  return { id: Symbol('context'), fallback };
}
export function provide(context, value) {
  contexts = Object.create(contexts);
  contexts[context.id] = value;
}
export function inject(context) {
  const value = contexts[context.id];
  return value === undefined ? context.fallback : value;
}

/**
 * 服务：第一次 use 时才创建，整个应用（或 provide 的那棵子树）一份。
 * 函数体里可以用符文，effect 跟着应用走，不跟着第一个调用它的组件走。
 * 应用实例是每次 mount / hydrate / renderToString 新建的，所以服务端天然按请求隔离。
 */
const APP = Symbol('app');
function createApp(run) {
  const app = { services: new Map(), scope: undefined };
  const previous = contexts;
  contexts = Object.create(ROOT);
  contexts[APP] = app;
  try {
    return alien.effectScope(() => {
      app.scope = alien.getActiveSub();
      run();
    });
  } finally {
    contexts = previous;
  }
}
export function createService(factory) {
  const id = Symbol('service');
  const instantiate = (owner) => {
    let instance;
    const outerSetup = setupScope;
    setupScope = undefined;
    const previous = alien.setActiveSub(owner);
    try {
      alien.effectScope(() => {
        instance = factory();
      });
    } finally {
      alien.setActiveSub(previous);
      setupScope = outerSetup;
    }
    return instance;
  };
  return {
    use() {
      const provided = contexts[id];
      if (provided !== undefined) return provided;
      const app = contexts[APP];
      if (!app) throw new Error('服务只能在组件或其他服务里使用');
      if (!app.services.has(id)) {
        // 服务属于应用：context 回到根，看不到第一个调用者一路 provide 的值
        const saved = contexts;
        contexts = Object.getPrototypeOf(saved) === null ? saved : rootOf(saved);
        try {
          app.services.set(id, instantiate(app.scope));
        } finally {
          contexts = saved;
        }
      }
      return app.services.get(id);
    },
    /** 这棵子树用自己的一份；传了值就用传的（测试替身） */
    provide(value) {
      contexts = Object.create(contexts);
      contexts[id] = value !== undefined ? value : instantiate(alien.getActiveSub());
      return contexts[id];
    },
  };
}
function rootOf(context) {
  let node = context;
  while (!Object.prototype.hasOwnProperty.call(node, APP)) node = Object.getPrototypeOf(node);
  return node;
}

/**
 * 可双向绑定的 prop：写入时通知 onXxxChange。父级给了值就以父级为准：
 * 回调没有采纳新值（比如要等接口返回）时退回父级的值，不用每个组件自己补偿
 */
export function bindable(props, key, initial, raw = false) {
  const first = untrack(() => props[key]);
  const local = signal(first !== undefined ? first : initial);
  // 和 _state 一样：整体替换后新对象也是深代理，.raw 不代理
  const wrap = raw ? (value) => value : deep;
  effect(() => {
    const incoming = props[key];
    if (incoming !== undefined) local(incoming);
  });
  const handler = changeHandler(key);
  markBindingUsed(props, handler);
  return function (...next) {
    if (!next.length) return local();
    const value = wrap(next[0]);
    local(value);
    untrack(() => props[handler])?.(value);
    queueMicrotask(() => {
      const incoming = untrack(() => props[key]);
      if (incoming !== undefined && incoming !== untrack(local)) local(incoming);
    });
  };
}

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

/** 列表：默认按对象身份复用行；给了 key 时同 key 的行复用，item 和下标都是读取函数 */
export function For(props) {
  let adopting = hydrating;
  const open = adopting ? cursor : undefined;
  const marker = adopting ? closeOf(open) : document.createComment('');
  const fragment = adopting ? undefined : document.createDocumentFragment();
  fragment?.append(marker);
  let rows = new Map();
  let order = [];
  const saved = contexts;
  effect(() => {
    const items = props.each ?? [];
    const parent = marker.parentNode;
    const render = props.children;
    const keyOf = props.key;
    const createRow = (item, index) => {
      const previous = alien.setActiveSub(undefined);
      const row = { node: undefined, dispose: undefined, item: keyOf ? signal(item) : undefined, index: signal(index) };
      row.dispose = alien.effectScope(() => {
        row.node = withOwner(saved, () => render(keyOf ? row.item : item, row.index));
      });
      alien.setActiveSub(previous);
      return row;
    };
    if (adopting) {
      adopting = false;
      cursor = open.nextSibling;
      untrack(() => items.forEach((item, index) => rows.set(keyOf ? keyOf(item) : item, createRow(item, index))));
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
      for (const row of rows.values()) row.dispose();
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
        row.index(index);
        row.item?.(item);
      } else {
        // 行的作用域不能挂在这个 effect 下面（createRow 里断开了）：它重跑时会销毁子 effect
        row = createRow(item, index);
      }
      next.set(key, row);
    }
    for (const row of rows.values()) {
      parent.removeChild(liveNode(row.node));
      row.dispose();
    }
    placeRows(parent, marker, order, (order = [...next.values()]));
    rows = next;
  });
  return fragment ?? marker;
}

/** 接管服务端渲染的内容：不创建节点、不写 DOM，只把 effect 和事件接上 */
export function hydrate(render, host) {
  hydrating = true;
  cursor = host.firstChild;
  try {
    return createApp(() => claim(render()));
  } finally {
    hydrating = false;
    cursor = null;
    runPendingEffects();
  }
}

export function mount(render, host) {
  const dispose = createApp(() => host.append(...toNodes(render())));
  runPendingEffects();
  return dispose;
}
