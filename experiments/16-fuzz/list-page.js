// 方向 2 的页面侧：挂一个列表变体，按用例的步骤改数据，每步 flush 后和参考模型比 DOM、节点身份、清理次数、DOM 改动量。
import { component, flushSync, mount } from '@hilt/runtime';
import * as app from 'fuzz-app';

const log = (globalThis.__log = { cleanups: [] });
const clone = (value) => JSON.parse(JSON.stringify(value));
const show = (value) => JSON.stringify(value);

/** 最长递增子序列的长度：留下的行里这些节点理论上不用动 */
function lisLength(sequence) {
  const tails = [];
  for (const value of sequence) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
  }
  return tails.length;
}

/** 在参考数组上执行同一个操作（和 list.mjs 生成的 TSX 里的 apply 逐条对应） */
function applyModel(model, op) {
  switch (op.t) {
    case 'push': model.push(...clone(op.rows)); break;
    case 'unshift': model.unshift(...clone(op.rows)); break;
    case 'pop': model.pop(); break;
    case 'shift': model.shift(); break;
    case 'splice': model.splice(op.at, op.del, ...clone(op.rows)); break;
    case 'sortN': model.sort((a, b) => op.dir * (a.n - b.n)); break;
    case 'sortLabel': model.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)); break;
    case 'reverse': model.reverse(); break;
    case 'set': model[op.at] = clone(op.row); break;
    case 'swap': [model[op.a], model[op.b]] = [model[op.b], model[op.a]]; break;
    case 'move': { const [row] = model.splice(op.from, 1); model.splice(op.to, 0, row); break; }
    case 'truncate': model.length = op.len; break;
    case 'label': model[op.at].label = op.label; break;
    case 'clear': model.length = 0; break;
    case 'replace': {
      const old = [...model];
      model.length = 0;
      for (const entry of op.rows) {
        if (entry.keep !== undefined) {
          const row = old[entry.keep];
          if (entry.label !== undefined) row.label = entry.label;
          model.push(row);
        } else model.push(clone(entry));
      }
      break;
    }
  }
}

function readDom(ul) {
  return [...ul.children]
    .filter((node) => node.classList?.contains('row'))
    .map((li) => ({
      node: li,
      id: Number(li.dataset.id),
      uid: Number(li.dataset.uid),
      label: li.querySelector('.t')?.textContent,
      index: li.querySelector('.i')?.textContent,
    }));
}

export async function runList(spec) {
  const failures = [];
  const fail = (kind, detail) => failures.push({ kind, detail });
  log.cleanups.length = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const errors = [];
  const onError = (event) => errors.push(event.message);
  window.addEventListener('error', onError);
  const stop = mount(() => component(app[spec.variant], {}), host);
  const api = globalThis.__list;
  const ul = host.querySelector('#list');
  const model = [];
  const keyed = spec.variant.includes('_keyed_');
  const tokenOf = (row) => (keyed ? row.id : row.uid);
  const observer = new MutationObserver(() => {});
  observer.observe(ul, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, characterDataOldValue: true });

  const verify = (stage, before) => {
    const dom = readDom(ul);
    const want = model.map((row, i) => ({ id: row.id, uid: row.uid, label: row.label, index: String(i) }));
    const got = dom.map(({ id, uid, label, index }) => ({ id, uid, label, index }));
    if (show(got) !== show(want)) {
      fail(`${stage}:dom-order-or-content`, { got, want });
      return undefined;
    }
    // 同一个身份的行，节点不能换；新身份的行不能拿旧节点
    if (before) {
      const nodes = new Map(dom.map((entry, i) => [tokenOf(model[i]), entry.node]));
      for (const [token, node] of before.nodes) {
        if (nodes.has(token) && nodes.get(token) !== node) fail(`${stage}:identity-lost`, { token });
      }
      const old = new Set(before.nodes.values());
      for (const [token, node] of nodes) if (!before.nodes.has(token) && old.has(node)) fail(`${stage}:node-reused-for-new-row`, { token });
    }
    if (ul.querySelectorAll('.row').length !== model.length) fail(`${stage}:row-count`, ul.querySelectorAll('.row').length);
    return dom;
  };

  try {
    let step = 0;
    for (const { ops, flush } of spec.steps) {
      step++;
      const beforeDom = readDom(ul);
      const before = { tokens: model.map(tokenOf), nodes: new Map(beforeDom.map((entry, i) => [tokenOf(model[i]), entry.node])), rows: clone(model) };
      observer.takeRecords();
      log.cleanups.length = 0;
      for (const op of ops) {
        api.apply(op);
        applyModel(model, op);
      }
      if (flush === 'microtask') {
        await Promise.resolve();
        await Promise.resolve();
      } else flushSync();
      const records = observer.takeRecords();
      const dom = verify(`step${step}`, before);
      if (!dom) continue;
      // 清理：只有这一步里消失的身份，各恰好一次
      const after = new Set(model.map(tokenOf));
      const gone = before.tokens.filter((token) => !after.has(token)).map(String).sort();
      const cleaned = [...log.cleanups].sort();
      if (show(cleaned) !== show(gone)) fail(`step${step}:cleanup`, { cleaned, gone });
      // DOM 改动量：被动的行节点数不超过 删除 + 新增 + (留下的 - 最长递增子序列)
      const survivors = before.tokens.filter((token) => after.has(token));
      const order = new Map(model.map((row, i) => [tokenOf(row), i]));
      const kept = lisLength(survivors.map((token) => order.get(token)));
      const bound = gone.length + (model.length - survivors.length) + (survivors.length - kept);
      const rowNodes = new Set();
      let others = 0;
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of [...record.addedNodes, ...record.removedNodes]) if (node.classList?.contains('row')) rowNodes.add(node);
        } else others++;
      }
      if (rowNodes.size > bound) fail(`step${step}:too-many-moves`, { touched: rowNodes.size, bound, ops: ops.map((op) => op.t), before: before.tokens, after: model.map(tokenOf) });
      // 文本和属性：只有真的变了的才该有记录
      let textBound = 0;
      const beforeByToken = new Map(before.tokens.map((token, i) => [token, { row: before.rows[i], index: i }]));
      for (const row of model) {
        const old = beforeByToken.get(tokenOf(row));
        if (!old) continue;
        const i = order.get(tokenOf(row));
        // keyed 行的 item 对象被换掉（同 key 的新对象）：读了 item 的三个绑定（data-id、data-uid、文字）都会重写，不比较旧值，
        // 同值写 attribute 也会产生一条记录（语义差异，不算缺陷）。其余只有真的变了的才有记录
        textBound += (old.row.uid !== row.uid ? 3 : old.row.label !== row.label ? 1 : 0) + (old.index !== i);
      }
      // 同一批里先改了某行的文字、后来这一行被删 / 换了 item：行内的文字绑定先于列表的 effect 跑，多出的中间写入不可避免
      // （行的 effect 不挂在列表的 effect 下面，行才能在列表重算时活下来）
      textBound += ops.filter((op) => op.t === 'label' || op.t === 'replace').length;
      if (others > textBound) fail(`step${step}:redundant-updates`, { others, textBound, ops: ops.map((op) => op.t), records: records.filter((r) => r.type !== 'childList').map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}:${r.oldValue}->${r.type === 'characterData' ? r.target.data : r.target.getAttribute?.(r.attributeName)}`) });
    }
    // 卸载：剩下的行各清理一次，之后改数据不再碰 DOM
    log.cleanups.length = 0;
    const tokens = model.map((row) => String(tokenOf(row))).sort();
    stop();
    if (show([...log.cleanups].sort()) !== show(tokens)) fail('dispose:cleanup', { cleaned: [...log.cleanups].sort(), tokens });
    observer.takeRecords();
    api.apply({ t: 'push', rows: [{ uid: 9999, id: 9999, label: 'late', n: 0 }] });
    flushSync();
    const late = observer.takeRecords().length;
    if (late) fail('dispose:dom-touched-after-stop', late);
  } catch (error) {
    fail('exception', String(error.stack ?? error).split('\n').slice(0, 5).join(' | '));
  } finally {
    observer.disconnect();
    window.removeEventListener('error', onError);
    host.remove();
  }
  if (errors.length) fail('page-error', errors[0]);
  return failures;
}

window.listFuzz = { runList };
