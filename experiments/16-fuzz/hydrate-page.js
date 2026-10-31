// 方向 4 的页面侧。页面里已经是服务端渲染好的 #app；这里负责：记录节点和改动、水合、纯客户端新挂载一份、
// 把两边的 DOM 规范化后比较。规范化：去掉所有注释（[ ] 标记、空注释分隔），合并相邻文本、去掉空文本，
// 属性排序，class 取集合，style 取解析后的声明，表单控件取 property（value / checked / selected）。
import { component, flushSync, hydrate, mount } from '@hilt/runtime';
import * as app from 'fuzz-app';

globalThis.__apis = {};
const clone = (value) => JSON.parse(JSON.stringify(value));
const XHTML = 'http://www.w3.org/1999/xhtml';

/** useId 的值（h0、h1-0…）按出现顺序改写成 #0、#1…：水合后新建的组件接着往下数，和从头挂载的编号不同，但都是唯一稳定的 */
let idMap = new Map();
const canonId = (value) => (/^h\d+(-\d+)*$/.test(value) ? (idMap.has(value) ? idMap.get(value) : idMap.set(value, `#${idMap.size}`).get(value)) : value);
function normRoot(parent) {
  idMap = new Map();
  return normChildren(parent);
}
function normChildren(parent) {
  const out = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push(buffer);
    buffer = '';
  };
  for (const child of parent.childNodes) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      buffer += child.data;
      continue;
    }
    if (child.nodeType !== 1) continue;
    flush();
    out.push(normEl(child));
  }
  flush();
  return out;
}
function normEl(el) {
  const attrs = {};
  for (const attr of el.attributes) attrs[attr.name] = attr.value;
  if (attrs.class !== undefined) {
    attrs.class = [...new Set(attrs.class.split(/\s+/).filter(Boolean))].sort().join(' ');
    if (!attrs.class) delete attrs.class;
  }
  delete attrs.style;
  for (const key of ['id', 'for']) if (attrs[key] !== undefined) attrs[key] = canonId(attrs[key]);
  const style = {};
  for (let i = 0; i < el.style.length; i++) {
    const name = el.style[i];
    const priority = el.style.getPropertyPriority(name);
    style[name] = el.style.getPropertyValue(name) + (priority ? ' !important' : '');
  }
  const tag = el.localName;
  if (tag === 'option') delete attrs.selected;
  // bugs/005：原生 _bind 只写 property，服务端和单向绑定会同步 value / checked 这两个 default attribute。默认不比（property 照比）
  if (!globalThis.__strictFormAttrs && (tag === 'input' || tag === 'textarea')) {
    delete attrs.value;
    delete attrs.checked;
  }
  const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1)));
  const node = { tag, ns: el.namespaceURI === XHTML ? '' : el.namespaceURI.split('/').pop(), attrs: sorted(attrs), style: sorted(style) };
  if (tag === 'input' || tag === 'textarea' || tag === 'select') node.value = el.value;
  if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) node.checked = el.checked;
  if (tag === 'option') node.selected = el.selected;
  node.kids = tag === 'textarea' ? [] : normChildren(el);
  return node;
}
/** 第一处不一样的路径，方便看 */
function firstDiff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: 类型不同`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const inner = firstDiff(a[key], b[key], `${path}/${key === 'kids' ? '' : key}${a.tag && key === 'kids' ? `<${a.tag}>` : ''}`);
    if (inner) return inner;
  }
  return `${path}: 不同`;
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => requestIdleCallback(() => resolve(), { timeout: 50 }));
  }
  flushSync();
}

const appEl = () => document.getElementById('app');
const state = { nodes: [], mutations: [], observer: undefined, inserted: 0, stop: undefined, serverNorm: undefined, freshId: 0 };

const allNodes = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  const out = [];
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
};

async function mountFresh(init) {
  const container = document.createElement('div');
  container.id = `fresh-${state.freshId++}`;
  document.body.append(container);
  globalThis.__init = clone(init);
  const stop = mount(() => component(app.Root, { slot: 'fresh' }), container);
  await settle();
  const norm = normRoot(container);
  stop();
  container.remove();
  return norm;
}

window.hydrateFuzz = {
  /** 服务端 HTML 刚进页面（客户端代码已注入但还没水合）：记下节点、规范化结果，装上观察器 */
  prepare() {
    const host = appEl();
    state.nodes = allNodes(host);
    state.serverNorm = normRoot(host);
    state.mutations = [];
    state.observer = new MutationObserver((records) => state.mutations.push(...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}:${r.addedNodes.length}+${r.removedNodes.length}`)));
    state.observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    state.inserted = 0;
    const original = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function (...args) {
      state.inserted++;
      return original.apply(this, args);
    };
    return { nodes: state.nodes.length };
  },
  async hydrate(init, preload) {
    globalThis.__init = clone(init);
    const result = { error: undefined };
    try {
      if (preload) await Promise.all(app.lazies.map((lazyComponent) => lazyComponent.preload()));
      state.stop = hydrate(() => component(app.Root, { slot: 'main' }), appEl());
      await settle();
    } catch (error) {
      result.error = String(error.stack ?? error).split('\n').slice(0, 4).join(' | ');
    }
    state.mutations.push(...state.observer.takeRecords().map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}:${r.addedNodes.length}+${r.removedNodes.length}`));
    const now = allNodes(appEl());
    result.mutations = state.mutations.slice(0, 8);
    result.mutationCount = state.mutations.length;
    result.inserted = state.inserted;
    result.sameNodes = now.length === state.nodes.length && now.every((node, index) => node === state.nodes[index]);
    result.nodeCounts = [state.nodes.length, now.length];
    return result;
  },
  /** 初始状态：服务端 HTML / 水合后 / 纯客户端新挂载 三者规范化后应该相同 */
  async initialCompare(init) {
    const hydrated = normRoot(appEl());
    const fresh = await mountFresh(init);
    return {
      ssrVsFresh: firstDiff(state.serverNorm, fresh),
      hydratedVsFresh: firstDiff(hydrated, fresh),
      ssrVsHydrated: firstDiff(state.serverNorm, hydrated),
    };
  },
  async round(ops) {
    const api = globalThis.__apis.main;
    const host = appEl();
    // __strictFormAttrs 同时也是“把已知缺陷算进来”的开关（--with-known-bugs）
    const known = !!globalThis.__strictFormAttrs;
    for (const op of ops) {
      if (op.t === 'set') api.apply(op.name, op.v);
      else if (op.t === 'list') api.apply(op.name, op.op);
      else if (op.t === 'click') host.querySelector(`[data-click="${op.n}"]`)?.click();
      else if (op.t === 'type') {
        const el = host.querySelector(`[data-bind="${op.n}"]`);
        if (!el) continue;
        if (el.type === 'checkbox') el.click();
        else if (el.localName === 'select') {
          // 用户只能选已有的选项；默认只选 a / b / c：选到 .map 出来的选项后状态变成 m<id>，纯客户端挂载选不中它（bugs/011）
          const options = [...el.options].filter((option) => known || /^[abc]$/.test(option.value));
          if (!options.length) continue;
          el.value = options[op.v.length % options.length].value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.value = el.type === 'number' ? (Number.isNaN(Number(op.v)) ? '' : op.v) : op.v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      // bugs/014：用户操作之后同一个 tick 里又把状态改回去，原生 _bind 会和 DOM 失去同步；默认每个用户操作单独 flush
      if ((op.t === 'click' || op.t === 'type') && !known) flushSync();
    }
    flushSync();
    await settle();
    const snapshot = api.snapshot();
    const fresh = await mountFresh(snapshot);
    const hydrated = normRoot(host);
    return { diff: firstDiff(hydrated, fresh), snapshot };
  },
};
