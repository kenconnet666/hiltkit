// 属性方向的页面端：挂载 -> 和服务端输出解析回来的 DOM 比 -> 改状态 -> 增量结果和用当前值从头挂载的比 -> 销毁。
//   ssr-vs-client        客户端挂载的 DOM 与 renderToString 解析回来的不同形
//   incremental-vs-fresh 改了 sig 之后的增量结果与用当前值新挂载的不同
//   attr-oracle / class-oracle / style-oracle  与按文档语义推演的期望不一致
//   events / refs        事件执行顺序、ref 赋值与清空不对
//   update-after-dispose 销毁之后还在更新 DOM
import { flushSync, mount } from 'hilt';
import { buildView, dec, expected, expectedEvents, makeState } from './attrs-build.js';
import { collectErrors, firstDiff, normalize, styleSignature, watch } from './dom.js';

collectErrors();
class Failure extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const target = (spec, host) => (spec.svg ? host.firstElementChild.firstElementChild : host.firstElementChild);
const rawOf = (state) => Object.fromEntries(Object.entries(state).map(([name, s]) => [name, name.startsWith('r') ? null : s.peek()]));

function mountCase(spec, init, fromRaw = false) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const env = { log: [], refs: {} };
  const state = makeState(init, fromRaw);
  const stop = mount(() => buildView(spec, state, env), host);
  return { host, env, state, stop };
}
const parse = (html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

/** 两个容器同形？只差 default attribute 时返回 note */
function compare(a, b, kind, label, notes) {
  const diff = firstDiff(normalize(a), normalize(b));
  if (diff) throw new Failure(kind, `${label}  ${diff}`);
  const strict = firstDiff(normalize(a, { strict: true }), normalize(b, { strict: true }));
  if (strict) notes.push({ kind: 'default-attr', message: `${label}  ${strict}` });
}

function checkOracle(spec, ctx, label) {
  const el = target(spec, ctx.host);
  const want = expected(spec, ctx.state);
  for (const [key, value] of Object.entries(want.attrs)) {
    const got = el.getAttribute(key);
    if (got !== (value ?? null)) throw new Failure('attr-oracle', `${label} ${key}: 实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(value ?? null)}`);
  }
  const classes = new Set((el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
  if (classes.size !== want.classes.size || [...classes].some((name) => !want.classes.has(name))) {
    throw new Failure('class-oracle', `${label} 实际 [${[...classes].sort()}]，期望 [${[...want.classes].sort()}]`);
  }
  // 和被测元素同命名空间：SVG 元素的样式解析比 HTML 宽松（color:3 合法）
  const scratch = document.createElementNS(el.namespaceURI, el.localName);
  if (want.style) scratch.setAttribute('style', want.style);
  if (styleSignature(scratch) !== styleSignature(el)) throw new Failure('style-oracle', `${label} 实际 ${JSON.stringify(styleSignature(el))}，期望 ${JSON.stringify(styleSignature(scratch))}（样式文本 ${JSON.stringify(want.style)}）`);
}

function checkEvents(spec, ctx, label) {
  if (!['div', 'button'].includes(spec.tag)) return;
  ctx.env.log.length = 0;
  target(spec, ctx.host).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const want = expectedEvents(spec);
  if (JSON.stringify(ctx.env.log) !== JSON.stringify(want)) throw new Failure('events', `${label} 实际 ${JSON.stringify(ctx.env.log)}，期望 ${JSON.stringify(want)}`);
}

function checkRefs(spec, ctx, el, label, mounted) {
  for (const layer of spec.layers) {
    const v = layer.ref;
    if (!v) continue;
    const got = v.k === 'ref' ? ctx.env.refs[v.id] : ctx.state[v.ref].peek();
    const want = mounted ? el : null;
    if (got !== want) throw new Failure('refs', `${label} ref ${v.id ?? v.ref}: ${mounted ? '没有拿到元素' : '销毁后没有清成 null'}`);
  }
}

function runCase({ spec, init, rounds, ssr }) {
  const notes = [];
  const live = mountCase(spec, init);
  const el = target(spec, live.host);
  const ssrHost = parse(ssr[0]);
  compare(live.host, ssrHost, 'ssr-vs-client', '初始', notes);
  checkOracle(spec, live, '初始');
  checkEvents(spec, live, '初始');
  checkRefs(spec, live, el, '初始', true);
  const names = Object.keys(init);
  rounds.forEach((ops, round) => {
    const label = `第 ${round + 1} 轮 ${JSON.stringify(ops.map((op) => [op.ref, op.v]))}`;
    for (const op of ops) live.state[op.ref].set(dec(op.v));
    flushSync();
    if (target(spec, live.host) !== el) throw new Failure('element-replaced', `${label} 元素被重建了`);
    const fresh = mountCase(spec, rawOf(live.state), true);
    try {
      compare(live.host, fresh.host, 'incremental-vs-fresh', label, notes);
      compare(fresh.host, parse(ssr[round + 1]), 'ssr-vs-client', `${label}（用当前值新挂载）`, notes);
      checkOracle(spec, live, label);
      checkEvents(spec, live, label);
    } finally {
      fresh.stop();
      fresh.host.remove();
    }
  });
  // 销毁：ref 清空，之后改状态不再动 DOM
  live.stop();
  checkRefs(spec, live, el, '销毁后', false);
  const watcher = watch(live.host);
  for (const name of names) if (!name.startsWith('r')) live.state[name].set('after-dispose');
  flushSync();
  const records = watcher.take();
  watcher.stop();
  if (records.length) throw new Failure('update-after-dispose', `销毁之后还有 ${records.length} 条 DOM 变动：${records.slice(0, 3).map(watcher.describe).join(' ')}`);
  live.host.remove();
  return notes;
}

window.attrsFuzz = {
  run(input) {
    document.body.replaceChildren();
    try {
      return { notes: runCase(input) };
    } catch (error) {
      return { kind: error.kind ?? 'exception', message: error.kind ? error.message : String(error.stack ?? error).split('\n').slice(0, 5).join(' | ') };
    }
  },
};
