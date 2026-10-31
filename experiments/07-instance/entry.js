// 浏览器里跑的部分：基准、计数、语义检查。run.mjs 把它打成 IIFE 后在无头 Chromium 里执行。
import { cfg, counters } from './config.js';
import { configure, component, core, flushSync, inject, merge, omit, onCleanup, provide, renderEffect, root, signal, spread, viewOf } from './runtime.js';
import { Button, SCENARIOS } from './apps.js';

const now = () => performance.now();
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const collect = () => globalThis.gc?.();

window.setup = (patch) => configure(patch);

/** 一轮计时：挂载、单个更新 x1000、全部更新（共享 signal，取 5 次中位数）、卸载 */
window.bench = (scenario, count) => {
  const S = SCENARIOS[scenario];
  const n = count ?? S.count;
  collect();
  const t0 = now();
  const app = S.mount(n);
  const mount = now() - t0;

  const t1 = now();
  for (let i = 0; i < 1000; i++) {
    app.updateOne((i * 7919) % n, i);
    flushSync();
  }
  const updateOne = now() - t1;

  const rounds = [];
  let flag = false;
  for (let i = 0; i < 5; i++) {
    flag = !flag;
    const t = now();
    app.updateAll(flag);
    flushSync();
    rounds.push(now() - t);
  }
  const updateAll = median(rounds);

  const t3 = now();
  for (let i = 0; i < 1000; i++) app.fire((i * 7919) % n);
  const fire = now() - t3;

  collect();
  const t2 = now();
  app.dispose();
  app.host.remove();
  const dispose = now() - t2;
  return { mount, updateOne, updateAll, fire, dispose };
};

/** 挂住不卸，给外面量堆 */
window.keep = (scenario, count) => {
  window.__keep = SCENARIOS[scenario].mount(count ?? SCENARIOS[scenario].count);
};

/** 每实例的对象计数（小规模挂载，和计时分开跑） */
window.counts = (scenario, n = 500) => {
  const S = SCENARIOS[scenario];
  for (const key in counters) counters[key] = 0;
  for (const key in core.stats) core.stats[key] = 0;
  const app = S.mount(n);
  const per = (value) => +(value / n).toFixed(2);
  const first = app.host.firstElementChild;
  const result = {
    effects: per(core.stats.effects),
    'effects released': per(core.stats.released),
    'effects live': per(core.stats.effects - core.stats.released),
    scopes: per(core.stats.scopes),
    proxies: per(counters.proxies),
    'Set 分配': per(counters.sets),
    '层对象/数组': per(counters.layerObjs),
    listeners: per(counters.listeners),
    setAttr: per(counters.setAttrs),
    '闭包(估)': per(counters.closures + core.stats.closures),
    elements: first ? first.querySelectorAll('*').length + 1 : 0,
    attrs: first ? first.attributes.length : 0,
  };
  app.dispose();
  app.host.remove();
  return result;
};

// ---------------- 语义检查 ----------------
const K = (keys) => (cfg.hoistSet ? new Set(keys) : keys);
window.semantics = () => {
  const results = {};
  const check = (label, fn) => {
    try {
      const value = fn();
      results[label] = value === true ? 'ok' : `fail: ${JSON.stringify(value)}`;
    } catch (error) {
      results[label] = `error: ${error.message}`;
    }
  };
  const mk = (props, tag = 'button') => {
    const el = document.createElement(tag);
    spread(el, props);
    return el;
  };

  check('class 按层拼接', () => mk(merge({ class: 'a' }, { class: 'b' }, { class: 'c' })).className === 'a b c' || 'x');
  check('上层 undefined 不盖掉下层，恢复后再次生效', () => {
    const v = signal(undefined);
    const el = mk(merge({ title: 'default' }, { get title() { return v.value; } }));
    const a = el.getAttribute('title');
    v.value = 'user';
    flushSync();
    const b = el.getAttribute('title');
    v.value = undefined;
    flushSync();
    const c = el.getAttribute('title');
    return (a === 'default' && b === 'user' && c === 'default') || [a, b, c];
  });
  check('事件：上层先执行，preventDefault 跳过下层', () => {
    const calls = [];
    let prevent = false;
    const el = mk(
      merge(
        { onClick: () => calls.push('internal') },
        { onClick: (event) => { calls.push('user'); if (prevent) event.preventDefault(); } },
      ),
    );
    document.body.append(el);
    el.click();
    prevent = true;
    el.click();
    el.remove();
    const got = calls.join(',');
    return got === 'user,internal,user' || got;
  });
  check('事件：使用方写 undefined 不盖掉内部的', () => {
    const calls = [];
    const el = mk(merge({ onClick: () => calls.push('internal') }, { onClick: undefined }));
    document.body.append(el);
    el.click();
    el.remove();
    return calls.join() === 'internal' || calls;
  });
  check('受管层盖过使用方', () => mk(merge({ role: 'a' }, { role: 'user' }, { role: 'managed' })).getAttribute('role') === 'managed' || 'x');
  check('被盖住的 getter 不求值', () => {
    let evaluated = 0;
    const el = mk(merge({ get role() { evaluated++; return 'hidden'; } }, { role: 'managed' }));
    return (evaluated === 0 && el.getAttribute('role') === 'managed') || { evaluated };
  });
  check('改一个键不重算其他键', () => {
    const v = signal('a');
    let other = 0;
    mk({ get title() { return v.value; }, get 'data-other'() { other++; return 'o'; } });
    const before = other;
    v.value = 'b';
    flushSync();
    return other === before || { reEvaluated: other - before };
  });
  check('两层 omit 叠加：隐藏的键不出现', () => {
    const rest1 = omit({ a: '1', b: '2', c: '3' }, K(['a']));
    const el = mk(omit(merge({ d: '4' }, rest1), K(['b'])));
    return (!el.hasAttribute('a') && !el.hasAttribute('b') && el.getAttribute('c') === '3' && el.getAttribute('d') === '4') || el.outerHTML;
  });
  check('ref 每层都拿到元素', () => {
    const got = [];
    const el = mk(merge({ ref: (e) => got.push(e) }, { ref: (e) => got.push(e) }));
    return (got.length === 2 && got[0] === el) || got.length;
  });
  check('组件读合并后 props 的键（编译过的被调用方）', () => {
    let seen;
    component((props) => { seen = viewOf(props).title; }, merge({ title: 'a' }, { x: 1 }));
    return seen === 'a' || seen;
  });
  check('组件直接读合并后 props 的键（没经过 viewOf）', () => {
    let seen;
    component((props) => { seen = props.title; }, merge({ title: 'a' }, { x: 1 }));
    return seen === 'a' || String(seen);
  });
  check('无依赖 effect 之后，有依赖的 effect 照常重跑', () => {
    const v = signal(0);
    let runs = 0;
    renderEffect(() => { void 1; });
    renderEffect(() => { v.value; runs++; });
    v.value = 1;
    flushSync();
    return runs === 2 || runs;
  });
  check('无依赖但注册了清理的 effect，卸载时清理照常执行', () => {
    let cleaned = 0;
    const dispose = root(() => {
      renderEffect(() => { onCleanup(() => cleaned++); });
    });
    dispose();
    return cleaned === 1 || cleaned;
  });
  check('无依赖的父 effect 里有带依赖的子 effect：子照常重跑、卸载后停', () => {
    const v = signal(0);
    let runs = 0;
    const dispose = root(() => {
      renderEffect(() => { renderEffect(() => { v.value; runs++; }); });
    });
    v.value = 1;
    flushSync();
    const afterUpdate = runs;
    dispose();
    v.value = 2;
    flushSync();
    return (afterUpdate === 2 && runs === 2) || [afterUpdate, runs];
  });
  check('卸载后写 signal 不再写 DOM', () => {
    const v = signal('a');
    let el;
    const dispose = root(() => { el = mk({ get title() { return v.value; } }); });
    dispose();
    v.value = 'b';
    flushSync();
    return el.getAttribute('title') === 'a' || el.getAttribute('title');
  });
  check('宿主 effect 重跑时，里面组件的 onCleanup 执行', () => {
    const show = signal(true);
    let cleaned = 0;
    const host = document.createElement('div');
    const dispose = root(() => {
      renderEffect(() => {
        if (show.value) component(() => { onCleanup(() => cleaned++); return 1; });
      });
    });
    show.value = false;
    flushSync();
    dispose();
    host.remove();
    return cleaned === 1 || cleaned;
  });
  check('组件里 provide 不泄漏给后面的兄弟组件', () => {
    const KEY = Symbol('k');
    let seen;
    root(() => {
      component(() => { provide(KEY, 'A'); });
      component(() => { seen = inject(KEY, 'fallback'); });
    });
    return seen === 'fallback' || seen;
  });
  check('委托/监听：祖先原生监听被子元素 stopPropagation 挡住', () => {
    const parent = document.createElement('div');
    let parentCalls = 0;
    parent.addEventListener('click', () => parentCalls++);
    const el = mk(merge({ onClick: (event) => event.stopPropagation() }, {}));
    parent.append(el);
    document.body.append(parent);
    el.click();
    parent.remove();
    return parentCalls === 0 || { parentCalls };
  });
  check('事件：currentTarget 是元素本身', () => {
    let target;
    const el = mk(merge({ onClick: (event) => (target = event.currentTarget) }, {}));
    document.body.append(el);
    el.click();
    el.remove();
    return target === el || 'x';
  });
  check('不冒泡的事件（focus）照常触发', () => {
    let called = 0;
    const el = mk(merge({ onFocus: () => called++ }, {}));
    document.body.append(el);
    el.focus();
    el.remove();
    return called === 1 || called;
  });
  check('元素从文档移走后仍可触发（detached click）', () => {
    let called = 0;
    const el = mk({ onClick: () => called++ });
    el.click(); // 没挂进文档：委托收不到
    return called === 1 || called;
  });
  check('三层按钮：用户覆盖模板里已有的静态键', () => {
    const el = component(Button, { 'data-part': 'custom', tabindex: '3', class: 'u', onClick() {}, internalClick() {} });
    return (el.getAttribute('data-part') === 'custom' && el.getAttribute('tabindex') === '3' && el.className === 'base btn u') || el.outerHTML;
  });
  check('三层按钮：用户写 undefined 不盖掉模板里的静态键', () => {
    const el = component(Button, { 'data-part': undefined, class: 'u', internalClick() {} });
    return (el.getAttribute('data-part') === 'root' && el.getAttribute('tabindex') === '0') || el.outerHTML;
  });
  return results;
};

// ---------------- 层数的影响（优化 5 的补充）----------------
// 同样 12 个键（8 静态 + 4 getter）平均分到 L 层，层的来源对象提前建好，只计时 merge + spread
let prepared;
window.layerPrepare = (layerCount, count) => {
  const shared = signal(0);
  const el0 = document.createElement('button');
  void el0;
  prepared = { layerCount, items: [], shared };
  for (let i = 0; i < count; i++) {
    const sources = Array.from({ length: layerCount }, () => ({}));
    for (let k = 0; k < 12; k++) {
      const target = sources[k % layerCount];
      if (k % 3 === 0) Object.defineProperty(target, `data-k${k}`, { enumerable: true, configurable: true, get: () => shared.value });
      else target[`data-k${k}`] = `v${k}`;
    }
    prepared.items.push({ el: document.createElement('button'), sources });
  }
};
window.layerRun = () => {
  const { items } = prepared;
  collect();
  const t0 = now();
  const dispose = root(() => {
    for (let i = 0; i < items.length; i++) spread(items[i].el, merge(...items[i].sources));
  });
  const ms = now() - t0;
  window.__layers = { prepared, dispose };
  return ms;
};
