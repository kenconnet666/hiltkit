// 实验运行时：03-publish/packages/runtime 的 merge / omit / spread / component / template 换到 07 的内核上，
// 每个优化是 cfg 里的一个开关。cfg 全关时就是原型的写法（Proxy 视图、逐键 effect、逐元素监听、组件各自一个作用域）。
import { cfg, counters } from './config.js';
import { objectLayers, flatLayers, LAYERS, isEvent, keysOfSource, getterKey } from './layers.js';
import * as core from './core.mjs';

export { core };
export const { renderEffect, effect, signal, computed, onCleanup, provide, inject, flushSync } = core;

let ly = objectLayers;
/** 应用开关；每个页面只在开头调一次 */
export function configure(patch) {
  Object.assign(cfg, patch);
  ly = cfg.flat ? flatLayers : objectLayers;
  core.options.release = cfg.release;
  core.options.noDisposer = cfg.noDisposer;
  core.options.ownerArray = cfg.ownerArray;
  core.setBindingRunner(runBinding);
}

// ---------------- 视图：Proxy 或轻量对象 ----------------
class Layers {
  constructor(layers) {
    this[LAYERS] = layers;
  }
}
const readKeyOf = (layers, key) => (key === 'class' ? ly.readClass(layers) : ly.read(layers, key));
function hasAny(layers, key) {
  for (let i = 0, n = ly.count(layers); i < n; i++) if (ly.has(layers, i, key)) return true;
  return false;
}
const traps = {
  get: (view, key) => (key === LAYERS ? view.layers : readKeyOf(view.layers, key)),
  has: (view, key) => key === LAYERS || hasAny(view.layers, key),
  ownKeys: (view) => [...ly.keys(view.layers)],
  getOwnPropertyDescriptor: (view, key) =>
    hasAny(view.layers, key)
      ? { configurable: true, enumerable: true, get: () => readKeyOf(view.layers, key) }
      : undefined,
};
function proxyOf(layers) {
  counters.proxies++;
  return new Proxy({ layers }, traps);
}
function wrap(layers) {
  if (cfg.light) {
    counters.layerObjs++;
    return new Layers(layers);
  }
  return proxyOf(layers);
}
/** JSX 里属性的书写顺序就是合并层次：靠后的层优先；class 拼接，事件都执行，ref 都给 */
export const merge = (...sources) => wrap(ly.flatten(sources));
/** keys：hoistSet 时是模块级的 Set，否则是每次新建的数组 */
export const omit = (props, keys) => wrap(ly.omit(props, keys));
/** 被调用方要读 props.x 时的入口：轻量对象在这里才懒建 Proxy，普通对象与 Proxy 原样返回 */
export function viewOf(props) {
  return props instanceof Layers ? proxyOf(props[LAYERS]) : props;
}
const layersOf = (props) => props[LAYERS] ?? ly.single(props);

// ---------------- 组件 ----------------
/** 组件体只执行一次。scope 开：自己一个作用域节点；关：只断开追踪，effect 挂到上一层 */
export function component(Comp, props) {
  if (!cfg.scope) return core.untracked(Comp, props);
  let result;
  counters.closures += 2;
  core.scope(() => {
    result = Comp(props);
  });
  return result;
}
export function root(fn) {
  return core.scope(fn);
}

export function template(html) {
  let node;
  return () => {
    if (!node) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      node = tpl.content.firstChild;
    }
    return node.cloneNode(true);
  };
}

export function insert(parent, read) {
  const text = document.createTextNode('');
  parent.appendChild(text);
  counters.closures += 1;
  core.renderEffect(() => {
    const value = read();
    text.data = value == null ? '' : String(value);
  });
}

// ---------------- DOM 写入 ----------------
export function setAttr(el, key, value) {
  if (cfg.ablate === 'attrs') return;
  counters.setAttrs++;
  if (key === 'class') el.className = value ?? '';
  else if (key === 'value' || key === 'checked') el[key] = value;
  else if (value == null || value === false) el.removeAttribute(key);
  else el.setAttribute(key, value === true ? '' : value);
}

// ---------------- 事件 ----------------
const DELEGATED = new Set(['click', 'input', 'keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']);
const delegatedTypes = new Set();
const eventInfo = new Map();
function infoOf(key) {
  let info = eventInfo.get(key);
  if (!info) eventInfo.set(key, (info = { type: key.slice(2).toLowerCase(), prop: `$$${key.slice(2).toLowerCase()}`, key }));
  return info;
}
/** 从上往下找处理函数；preventDefault 后下层不再执行 */
function runLayers(layers, key, event) {
  for (let i = ly.count(layers) - 1; i >= 0; i--) {
    if (!ly.has(layers, i, key)) continue;
    const handler = ly.source(layers, i)[key];
    if (typeof handler !== 'function') continue;
    handler(event);
    if (event.defaultPrevented) return;
  }
}
const keyOfType = new Map();
function dispatch(event) {
  const prop = `$$${event.type}`;
  const key = keyOfType.get(event.type);
  for (let node = event.target; node; node = node.parentNode) {
    const layers = node[prop];
    if (layers !== undefined) {
      // 委托下 currentTarget 是 document；补成元素，和逐元素监听一致
      Object.defineProperty(event, 'currentTarget', { configurable: true, get: () => node });
      runLayers(layers, key, event);
    }
    if (event.cancelBubble) return;
  }
}
function listenLayers(el, layers, key) {
  if (cfg.ablate === 'events') return;
  const info = cfg.lean || cfg.delegate ? infoOf(key) : undefined;
  const type = info ? info.type : key.slice(2).toLowerCase();
  if (cfg.delegate && DELEGATED.has(type)) {
    if (!delegatedTypes.has(type)) {
      delegatedTypes.add(type);
      keyOfType.set(type, key);
      document.addEventListener(type, dispatch);
    }
    el[info.prop] = layers;
    return;
  }
  counters.listeners++;
  counters.closures++;
  el.addEventListener(type, (event) => runLayers(layers, key, event));
}

// ---------------- spread ----------------
function runRefs(el, layers) {
  for (let i = 0, n = ly.count(layers); i < n; i++) {
    if (ly.has(layers, i, 'ref')) ly.source(layers, i).ref?.(el);
  }
}
function runBinding(node) {
  const value = readKeyOf(node.layers, node.key);
  if (value === node.last) return;
  node.last = value;
  setAttr(node.el, node.key, value);
}
function bindReactive(el, layers, key) {
  if (cfg.ablate === 'effects') return setAttr(el, key, readKeyOf(layers, key));
  if (cfg.bindingNode) return core.renderBinding(el, layers, key);
  let last;
  counters.closures += 1;
  return core.renderEffect(() => {
    const value = readKeyOf(layers, key);
    if (value === last) return;
    last = value;
    setAttr(el, key, value);
  });
}
function bindClass(el, layers) {
  if (!ly.isReactive(layers, 'class') || cfg.ablate === 'effects') return setAttr(el, 'class', ly.readClass(layers));
  let last;
  counters.closures += 1;
  return core.renderEffect(() => {
    const next = ly.readClass(layers) ?? '';
    if (next !== last) setAttr(el, 'class', (last = next));
  });
}

/** 原型写法：每个键 isReactive 扫一遍所有层，静态键 setAttr，响应式键一个 effect，active Map 记着每个键的清理函数 */
function spreadProto(el, layers) {
  const active = new Map();
  const bind = (key) => {
    if (key === 'ref' || key === 'children') return;
    if (key === 'class') {
      active.set(key, bindClass(el, layers));
      return;
    }
    if (isEvent(key)) {
      listenLayers(el, layers, key);
      active.set(key, undefined);
      return;
    }
    if (!ly.isReactive(layers, key)) return setAttr(el, key, readKeyOf(layers, key));
    active.set(key, bindReactive(el, layers, key));
  };
  counters.closures += 1;
  for (const key of ly.keys(layers)) bind(key);
  runRefs(el, layers);
}

/**
 * 一趟解析：从上往下扫每层的每个键，第一个定下来的赢；getter 键收集起来之后起 effect，静态键直接写，
 * 事件键收集后挂监听。不建 keys Set、不建 active Map，每个键只看一次来源。
 * hoisted：这一层已经写在模板里，没有更高层覆盖的键不用再写
 */
function spreadLean(el, layers, hoisted) {
  let seen;
  let reactive;
  let events;
  let classLayers = 0;
  let classOnlyHoisted = false;
  for (let i = ly.count(layers) - 1; i >= 0; i--) {
    const source = ly.source(layers, i);
    if (source == null) continue;
    const hidden = ly.hidden(layers, i);
    const baked = hoisted !== undefined && ly.rawSource(layers, i) === hoisted;
    for (const key of keysOfSource(source)) {
      if (hidden?.has(key) || key === 'ref' || key === 'children') continue;
      if (key === 'class') {
        classLayers++;
        classOnlyHoisted = baked;
        continue;
      }
      if (isEvent(key)) {
        if (events === undefined) events = [key];
        else if (!events.includes(key)) events.push(key);
        continue;
      }
      if (seen !== undefined && seen.includes(key)) continue;
      if (getterKey(source, key)) {
        (reactive ??= []).push(key);
      } else {
        const value = source[key];
        if (value === undefined) continue;
        if (!baked) setAttr(el, key, value);
      }
      (seen ??= []).push(key);
    }
  }
  if (classLayers > 0 && !(classLayers === 1 && classOnlyHoisted)) bindClass(el, layers);
  if (reactive !== undefined) for (let i = 0; i < reactive.length; i++) bindReactive(el, layers, reactive[i]);
  if (events !== undefined) for (let i = 0; i < events.length; i++) listenLayers(el, layers, events[i]);
  runRefs(el, layers);
}

export function spread(el, props, hoisted) {
  if (cfg.ablate === 'spread') return;
  const layers = layersOf(props);
  if (cfg.lean) spreadLean(el, layers, cfg.hoist ? hoisted : undefined);
  else spreadProto(el, layers);
}
