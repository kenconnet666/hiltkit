// 水合方向的页面端。流程：
//   服务端 HTML（Node 里 renderToString）-> 页面解析 -> hydrate
//   ssr-vs-client        水合之前：服务端输出解析出来的 DOM 与客户端从头挂载的不同形（水合不可能对得上）
//   hydrate-throws       hydrate 抛错
//   hydrate-mutations    水合期间有 DOM 改动（MutationObserver，含属性、文本、子节点）
//   hydrate-identity     水合之后节点不是服务端那些（数量或身份变了）
//   hydrated-vs-fresh    水合之后与同样状态下从头挂载的不同形
//   round-mismatch       之后每一轮改状态（或模拟用户输入），页面 DOM 与同样状态下新挂载的不同形
//   page-error           pageerror / console.error / 内核上报的错误 / 开发期警告
//   update-after-dispose 卸载之后改状态还在动 DOM
import { flushSync, hydrate, mount, onError, warnings } from 'hilt';
import { build, makeState } from './hydrate-build.tsx';
import { allNodes, collectErrors, firstDiff, normalize, watch } from './dom.js';

const errors = collectErrors();
onError((error) => errors.push(`onError: ${error?.stack ?? error}`));
class Failure extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// 这个页面从头到尾都在接管服务端输出，“水合前”的对照挂载也要和水合用同样的样式模式（真实页面靠 renderStyleTag 的表判断）
hydrate(() => null, document.createElement('div'));

function mountFresh(spec, raw) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stop = mount(() => build(spec, makeState(raw)), host);
  return { host, stop };
}
const rawOf = (state) => Object.fromEntries(Object.entries(state).map(([name, s]) => [name, s.peek()]));

function checkErrors(label) {
  if (errors.length || warnings.length) throw new Failure('page-error', `${label}：${[...errors, ...warnings.map((w) => `warning: ${String(w).split('\n').slice(0, 3).join(' ')}`)].join(' | ').slice(0, 800)}`);
}

/** 两个容器同形？只差 default attribute 时记 note */
function compare(live, fresh, kind, label, notes) {
  const diff = firstDiff(normalize(live), normalize(fresh));
  if (diff) throw new Failure(kind, `${label}  ${diff}
     页面 ${live.innerHTML.slice(0, 400)}
     新挂载 ${fresh.innerHTML.slice(0, 400)}`);
  const strict = firstDiff(normalize(live, { strict: true }), normalize(fresh, { strict: true }));
  if (strict) notes.push({ kind: 'default-attr', message: `${label}  ${strict}` });
}

/** 模拟用户操作：在双向绑定的控件上输入 */
function userInput(app, op) {
  const controls = [...app.querySelectorAll('[data-fz]')];
  if (!controls.length) return;
  const el = controls[op.pick % controls.length];
  if (el.localName === 'select') {
    const options = [...el.options];
    if (!options.length) return;
    el.value = options[op.pick % options.length].value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.type === 'checkbox') {
    el.click();
  } else {
    el.value = op.v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

async function runCase({ spec, init, rounds, html, skipSsrCompare }) {
  const notes = [];
  errors.length = 0;
  warnings.length = 0;
  document.body.replaceChildren();
  const app = document.createElement('div');
  app.id = 'app';
  app.innerHTML = html;
  document.body.appendChild(app);

  // 1. 服务端输出 vs 客户端从头挂载
  const fresh0 = mountFresh(spec, init);
  if (!skipSsrCompare) compare(app, fresh0.host, 'ssr-vs-client', '水合前', notes);
  fresh0.stop();
  fresh0.host.remove();

  // 2. 水合：0 次改动、节点身份不变、不报错
  const before = allNodes(app);
  const watcher = watch(app);
  const state = makeState(init);
  let stop;
  try {
    stop = hydrate(() => build(spec, state), app);
  } catch (error) {
    throw new Failure('hydrate-throws', String(error?.stack ?? error).split('\n').slice(0, 4).join(' | '));
  }
  const records = watcher.take();
  if (records.length) throw new Failure('hydrate-mutations', `水合期间 ${records.length} 次 DOM 改动：${records.slice(0, 4).map(watcher.describe).join(' ')}`);
  const after = allNodes(app);
  if (before.length !== after.length || before.some((node, i) => node !== after[i])) throw new Failure('hydrate-identity', `节点数 ${before.length} -> ${after.length}，身份不同`);
  await tick();
  flushSync();
  const late = watcher.take();
  if (late.length) throw new Failure('hydrate-mutations', `水合之后的第一轮调度里 ${late.length} 次 DOM 改动：${late.slice(0, 4).map(watcher.describe).join(' ')}`);
  checkErrors('水合');
  const fresh1 = mountFresh(spec, init);
  try {
    compare(app, fresh1.host, 'hydrated-vs-fresh', '水合后', notes);
  } finally {
    fresh1.stop();
    fresh1.host.remove();
  }

  // 3. 改状态若干轮
  for (let round = 0; round < rounds.length; round++) {
    const ops = rounds[round];
    const label = `第 ${round + 1} 轮 ${JSON.stringify(ops)}`;
    for (const op of ops) {
      if (op.op === 'set' || op.op === 'list') state[op.ref].set(op.v);
      else if (op.op === 'toggle') state[op.ref].set(!state[op.ref].peek());
      else userInput(app, op);
    }
    flushSync();
    await tick();
    flushSync();
    checkErrors(label);
    const fresh = mountFresh(spec, rawOf(state));
    try {
      compare(app, fresh.host, 'round-mismatch', label, notes);
    } finally {
      fresh.stop();
      fresh.host.remove();
    }
  }

  // 4. 卸载之后不再更新
  stop();
  watcher.take();
  for (const [name, s] of Object.entries(state)) {
    const value = s.peek();
    if (typeof value === 'boolean') s.set(!value);
    else if (typeof value === 'string') s.set(`${value}!`);
    else if (Array.isArray(value)) s.set([]);
  }
  flushSync();
  await tick();
  const dead = watcher.take();
  watcher.stop();
  if (dead.length) throw new Failure('update-after-dispose', `卸载之后还有 ${dead.length} 次 DOM 改动：${dead.slice(0, 4).map(watcher.describe).join(' ')}`);
  return notes;
}

window.hydrateFuzz = {
  async run(input) {
    try {
      return { notes: await runCase(input) };
    } catch (error) {
      return { kind: error.kind ?? 'exception', message: error.kind ? error.message : String(error.stack ?? error).split('\n').slice(0, 5).join(' | ') };
    }
  },
};
