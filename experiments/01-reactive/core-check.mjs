// 对比直接用 alien-signals 和自建薄内核的语义。node 01-reactive/core-check.mjs
import * as alien from 'alien-signals';
import { computed, dispose, effect, flushSync, onCleanup, onError, renderEffect, scope as rawScope, signal, untrack } from '../03-publish/packages/runtime/reactive.js';

const scope = (fn) => {
  const node = rawScope(fn);
  return () => dispose(node);
};

const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);

// ---- 时序：用户 effect 写在模板前面（组件函数体里就是这个顺序），它要读到更新好的 DOM ----
{
  const dom = { text: '' };
  const count = alien.signal(0);
  let seen;
  alien.effect(() => {
    count();
    seen = dom.text;
  });
  alien.effect(() => {
    dom.text = `n=${count()}`;
  });
  count(1);
  console.log(`info 直接用 alien-signals：用户 effect 写在前面时，改完状态读到 DOM=${seen}（期望 n=1）`);
}
{
  const dom = { text: '' };
  const count = signal(0);
  let seen;
  effect(() => {
    count.value;
    seen = dom.text;
  });
  renderEffect(() => {
    dom.text = `n=${count.value}`;
  });
  count.value = 1;
  flushSync();
  check('薄内核：用户 effect 写在模板前面，也读到更新好的 DOM', seen === 'n=1', seen);
}

// ---- 批处理 ----
{
  const a = signal(1);
  const b = signal(2);
  const sum = computed(() => a.value + b.value);
  let runs = 0;
  renderEffect(() => {
    sum.value;
    runs++;
  });
  runs = 0;
  a.value = 10;
  b.value = 20;
  check('写的时候不立刻跑 effect', runs === 0, runs);
  check('同一轮读派生值是新的', sum.value === 30, sum.value);
  await Promise.resolve();
  check('微任务里合并成一次', runs === 1, runs);
}

// ---- 错误隔离 ----
{
  const errors = [];
  onError((error) => errors.push(error.message));
  const s = signal(0);
  let after = 0;
  effect(() => {
    if (s.value === 1) throw new Error('boom');
  });
  effect(() => {
    s.value;
    after++;
  });
  after = 0;
  s.value = 1;
  flushSync();
  check('抛错不牵连同一轮排在后面的 effect', after === 1 && errors[0] === 'boom', { after, errors });
  s.value = 2;
  flushSync();
  check('抛错的 effect 之后还能再跑', after === 2, after);
}

// ---- 嵌套与清理 ----
{
  const outer = signal(0);
  const inner = signal(0);
  const log = [];
  effect(() => {
    const o = outer.value;
    onCleanup(() => log.push(`clean-outer-${o}`));
    effect(() => {
      const i = inner.value;
      log.push(`inner-${o}-${i}`);
      onCleanup(() => log.push(`clean-inner-${o}-${i}`));
    });
  });
  log.length = 0;
  inner.value = 1;
  flushSync();
  check('内层单独重跑', log.join() === 'clean-inner-0-0,inner-0-1', log);
  log.length = 0;
  outer.value = 1;
  flushSync();
  check('外层重跑先销毁内层（同一轮内层不会多跑）', log.includes('clean-inner-0-1') && log.includes('clean-outer-0') && log.includes('inner-1-1') && log.filter((x) => x.startsWith('inner-')).length === 1, log);
  log.length = 0;
  outer.value = 2;
  inner.value = 2;
  flushSync();
  check('内外都变：内层只按新外层跑一次', log.filter((x) => x.startsWith('inner-')).join() === 'inner-2-2', log);
}

// ---- 作用域与 context ----
{
  const s = signal(0);
  let runs = 0;
  let readInBody = 0;
  let cleaned = 0;
  const stop = scope(() => {
    readInBody = s.value; // 组件体里的读不追踪
    onCleanup(() => cleaned++);
    renderEffect(() => {
      s.value;
      runs++;
    });
  });
  runs = 0;
  s.value = 1;
  flushSync();
  check('作用域里的 effect 正常跑', runs === 1, runs);
  stop();
  s.value = 2;
  flushSync();
  check('作用域销毁后 effect 停了、清理跑了', runs === 1 && cleaned === 1, { runs, cleaned });
  void readInBody;

  // context 改成原型链指针后由 03-publish/di、flow 覆盖
}

// ---- 动态依赖、untrack ----
{
  const flag = signal(true);
  const a = signal(1);
  const b = signal(2);
  let runs = 0;
  renderEffect(() => {
    flag.value ? a.value : b.value;
    runs++;
  });
  runs = 0;
  b.value = 3;
  flushSync();
  check('没读到的分支不触发', runs === 0, runs);
  flag.value = false;
  flushSync();
  a.value = 9;
  flushSync();
  check('切换后旧依赖不再触发', runs === 1, runs);
  const c = signal(1);
  let ran = 0;
  renderEffect(() => {
    untrack(() => c.value);
    ran++;
  });
  ran = 0;
  c.value = 2;
  flushSync();
  check('untrack 不建立依赖', ran === 0, ran);
}
