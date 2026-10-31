// 列表方向的页面端。用 createElement 直接按用例数据构造描述对象（不经编译、不生成源码）。
// 每一步：改数据 -> flushSync -> 断言
//   order       DOM 里行的顺序与内容等于数据（含下标、行内本地状态、标签文本）
//   structure   列表前后的兄弟节点原封不动，没有多出来的节点
//   identity    同键（没给 by 时是同一个对象）的行，节点身份不变，且没有重新创建行
//   cleanup     被删掉的行 onCleanup 恰好一次，留下的行一次都没有；卸载后全部恰好一次
//   moves       移动的行数不超过“公共行数 - 最长递增子序列”（交换两行最多动 2 个）
//   binding     行内用 effect / 本地 sig 建的绑定还活着
import { For, createElement, effect, flushSync, mount, onCleanup, sig, untrack } from 'hilt';
import { collectErrors } from './dom.js';

collectErrors();
class Failure extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 最长递增子序列的长度 */
function lisLength(values) {
  const tails = [];
  for (const value of values) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
  }
  return tails.length;
}

/** 一个 For 实例的登记簿：每次创建的行一条记录 */
class Ledger {
  constructor(name) {
    this.name = name;
    this.rows = []; // { n, id, cleaned, local, seen, el }
  }
  alive(id) {
    return this.rows.filter((row) => row.id === id && row.cleaned === 0);
  }
}

function buildApp(c, state) {
  const ledgers = { a: new Ledger('a'), b: new Ledger('b') };
  const makeRow = (ledger) => (itemArg, index) => {
    const keyed = c.keyed;
    const item = itemArg;
    const id = keyed ? untrack(item).id : item.id;
    const row = { n: ledger.rows.length, id, cleaned: 0, local: sig(0), seen: -1, el: null };
    ledger.rows.push(row);
    // inline：在 For 的回调体里直接用 onCleanup / effect（不包进组件）；否则放在子组件里
    if (c.inline) {
      onCleanup(() => row.cleaned++);
      effect(() => {
        row.seen = row.local();
      });
    }
    const Probe = () => {
      onCleanup(() => row.cleaned++);
      effect(() => {
        row.seen = row.local();
      });
      return null;
    };
    const label = keyed ? () => item().label : item.label;
    const attrs = (extra) => ({ 'data-k': id, 'data-i': index, 'data-l': row.local, ref: (el) => (row.el = el), ...extra });
    if (c.shape === 'single') return createElement('li', { ...attrs(), children: [label, c.inline ? null : createElement(Probe, {})] });
    if (c.shape === 'multi') {
      return [createElement('li', { ...attrs(), children: label }), createElement('li', { 'data-sub': id, children: c.inline ? null : createElement(Probe, {}) })];
    }
    // text：整行是一个动态文本段
    const text = () => `${id}:${keyed ? item().label : item.label}:${index()}:${row.local()}`;
    return c.inline ? text : [createElement(Probe, {}), text];
  };
  const listFor = (name, each) => createElement(For, { each, by: c.keyed ? (item) => item.id : undefined, children: makeRow(ledgers[name]) });
  const eachA = c.eachFn ? () => state.list() : state.list;
  const eachB = () => state.list().slice().reverse();
  const parent = (name, content) => createElement('ul', { id: name, children: c.siblings ? [createElement('li', { class: 'head', children: 'H' }), content, createElement('li', { class: 'tail', children: 'T' })] : content });
  const view = () => createElement('div', { children: [parent('a', listFor('a', eachA)), ...(c.twin ? [parent('b', listFor('b', eachB))] : [])] });
  return { view, ledgers };
}

/** 一个 ul 里，行按顺序的描述 */
function readRows(c, host) {
  if (c.shape === 'text') {
    const out = [];
    for (const node of host.childNodes) if (node.nodeType === 3) out.push(node.data);
    return out;
  }
  const out = [];
  for (const el of host.children) {
    if (el.dataset.k !== undefined) out.push(`${el.dataset.k}|${el.dataset.i}|${el.dataset.l}|${el.textContent}`);
    else if (el.dataset.sub !== undefined) out.push(`sub${el.dataset.sub}`);
  }
  return out;
}
function wantRows(c, list, ledger) {
  const rowOf = (item, index) => {
    const row = ledger.alive(item.id)[0];
    const local = row ? row.local.peek() : '?';
    if (c.shape === 'text') return [`${item.id}:${item.label}:${index}:${local}`];
    return c.shape === 'multi' ? [`${item.id}|${index}|${local}|${item.label}`, `sub${item.id}`] : [`${item.id}|${index}|${local}|${item.label}`];
  };
  return list.flatMap(rowOf);
}

function runCase(c) {
  const objects = new Map(); // id -> 当前对象：同 id 同标签沿用同一个对象，没给 by 时靠它判断“同一行”
  const toObjects = (items) =>
    items.map((item) => {
      const old = objects.get(item.id);
      if (old && old.label === item.label) return old;
      const created = { id: item.id, label: item.label };
      objects.set(item.id, created);
      return created;
    });
  let current = toObjects(c.initial);
  const state = { list: sig(current) };
  const { view, ledgers } = buildApp(c, state);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stop = mount(view, host);
  const lists = c.twin ? ['a', 'b'] : ['a'];
  const hostOf = (name) => host.querySelector(`#${name}`);
  const orderOf = (name, items) => (name === 'b' ? items.slice().reverse() : items);

  const verify = (label, previous) => {
    for (const name of lists) {
      const ledger = ledgers[name];
      const el = hostOf(name);
      const items = orderOf(name, current);
      const want = wantRows(c, items, ledger);
      const got = readRows(c, el);
      if (!same(got, want)) throw new Failure('order', `${label} 列表 ${name}：DOM ${JSON.stringify(got)} ≠ 数据 ${JSON.stringify(want)}`);
      if (c.siblings) {
        const rest = [...el.children].filter((child) => child.dataset.k === undefined && child.dataset.sub === undefined).map((child) => child.className);
        if (!same(rest, ['head', 'tail']) || el.firstElementChild.className !== 'head' || el.lastElementChild.className !== 'tail') throw new Failure('structure', `${label} 列表 ${name}：前后兄弟节点不对 ${JSON.stringify(rest)}`);
      }
      const stray = [...el.childNodes].filter((node) => node.nodeType === 3 && c.shape !== 'text' && node.data.trim());
      if (stray.length) throw new Failure('structure', `${label} 列表 ${name}：多出文本 ${JSON.stringify(stray.map((n) => n.data))}`);
      // 每个当前行恰好一个活着的记录；绑定还活着
      for (const item of items) {
        const alive = ledger.alive(item.id);
        if (alive.length !== 1) throw new Failure('cleanup', `${label} 列表 ${name}：id=${item.id} 有 ${alive.length} 个活着的行记录`);
        if (alive[0].seen !== alive[0].local.peek()) throw new Failure('binding', `${label} 列表 ${name}：id=${item.id} 的 effect 没有跟上本地状态（看到 ${alive[0].seen}，应为 ${alive[0].local.peek()}）`);
      }
      // 应当活着的行（列表里有、且是该 id 最近创建的）一次都没清理；其余恰好一次
      const ids = new Set(items.map((item) => item.id));
      for (const row of ledger.rows) {
        const latest = Math.max(...ledger.rows.filter((other) => other.id === row.id).map((other) => other.n));
        const shouldLive = ids.has(row.id) && row.n === latest;
        if (row.cleaned !== (shouldLive ? 0 : 1)) throw new Failure('cleanup', `${label} 列表 ${name}：id=${row.id}（第 ${row.n} 次创建）${shouldLive ? '还在列表里却被清理了' : '已被删除/替换'}，清理了 ${row.cleaned} 次`);
      }
    }
  };

  verify('初始', undefined);
  c.steps.forEach((step, stepNo) => {
    const label = `第 ${stepNo + 1} 步`;
    // 本地状态：改在列表更新之前，行被复用时必须保留
    const before = {};
    for (const name of lists) {
      before[name] = {
        order: orderOf(name, current).map((item) => item.id),
        nodes: new Map(ledgers[name].rows.filter((row) => row.cleaned === 0).map((row) => [row.id, row])),
        objectsOf: new Map(orderOf(name, current).map((item) => [item.id, item])),
      };
    }
    for (const id of step.bump) for (const name of lists) ledgers[name].alive(id)[0]?.local.set(ledgers[name].alive(id)[0].local.peek() + 1);
    const observers = lists.map((name) => {
      const observer = new MutationObserver(() => {});
      observer.observe(hostOf(name), { childList: true });
      return observer;
    });
    // 同一批里的中间写入不应该有任何效果
    for (const noise of step.noise) state.list.set(toObjectsKeepCache(noise));
    const next = toObjects(step.list);
    current = next;
    state.list.set(next);
    flushSync();
    const records = observers.map((observer) => {
      const taken = observer.takeRecords();
      observer.disconnect();
      return taken;
    });
    verify(label, true);
    lists.forEach((name, listIndex) => {
      const ledger = ledgers[name];
      const items = orderOf(name, current);
      // 复用：keyed 看 id，没给 by 看对象身份
      const reusedIds = items.filter((item) => {
        const old = before[name].objectsOf.get(item.id);
        return old !== undefined && (c.keyed || old === item);
      }).map((item) => item.id);
      for (const id of reusedIds) {
        const now = ledger.alive(id)[0];
        const old = before[name].nodes.get(id);
        if (now !== old) throw new Failure('identity', `${label} 列表 ${name}：id=${id} 应当复用行，却重新创建了（${old.n} -> ${now.n}）`);
        if (old.cleaned) throw new Failure('cleanup', `${label} 列表 ${name}：复用的行 id=${id} 被清理了`);
      }
      // 移动行数 <= 公共行数 - LIS
      const oldPos = new Map(before[name].order.map((id, index) => [id, index]));
      const common = reusedIds.map((id) => oldPos.get(id));
      const optimum = common.length - lisLength(common);
      const addedNodes = new Set();
      for (const record of records[listIndex]) for (const node of record.addedNodes) addedNodes.add(node);
      const moved = reusedIds.filter((id) => {
        const row = before[name].nodes.get(id);
        return row.el && addedNodes.has(row.el);
      });
      if (c.shape !== 'text' && moved.length > optimum) throw new Failure('moves', `${label} 列表 ${name}：移动了 ${moved.length} 行（${moved}），最少只需 ${optimum} 行`);
      if (step.op === 'swap' && c.shape !== 'text' && moved.length > 2) throw new Failure('moves', `${label} 列表 ${name}：交换两行却移动了 ${moved.length} 行`);
    });
  });
  stop();
  for (const name of lists) {
    for (const row of ledgers[name].rows) {
      if (row.cleaned !== 1) throw new Failure('cleanup', `卸载后 列表 ${name}：行 id=${row.id}（第 ${row.n} 次创建）清理了 ${row.cleaned} 次`);
    }
  }
  host.remove();
  // 噪声列表只复用缓存里已有的对象，不产生新对象
  function toObjectsKeepCache(items) {
    return items.map((item) => objects.get(item.id) ?? { id: item.id, label: item.label });
  }
}

window.listFuzz = {
  run(input) {
    document.body.replaceChildren();
    try {
      runCase(input);
      return {};
    } catch (error) {
      return { kind: error.kind ?? 'exception', message: error.kind ? error.message : String(error.stack ?? error).split('\n').slice(0, 5).join(' | ') };
    }
  },
};
