// 响应式内核：在 alien-signals/system（只有依赖图算法）上自建，补上直接用 alien-signals 缺的：
//   - 两个队列：DOM 绑定先跑，用户 effect 后跑，用户 effect 总能看到更新好的 DOM
//   - 微任务批处理写在内核里，不用每个 signal 再包一层函数
//   - 错误隔离：一个 effect 抛错不牵连同一轮的其他 effect
//   - owner 链管销毁，context 是原型链上的一个指针（组件本身不占节点）
// 节点是 class，读写走 .value：不用 bind，每个 signal 少一个函数对象。
import { createReactiveSystem, ReactiveFlags } from 'alien-signals/system';

const { Mutable, Watching, RecursedCheck, Dirty, Pending, None } = ReactiveFlags;
const HasChild = 64;
const RENDER = 128;
/** 这个 DOM 绑定长在用户 effect 里面：外层要先跑，不能抢到 DOM 队列里，否则读到外层条件已经不成立的数据 */
const IN_USER_EFFECT = 256;
const KEEP = RENDER | IN_USER_EFFECT;
const insideUserEffect = (parent) => parent !== undefined && (parent.flags & IN_USER_EFFECT || (parent.flags & Watching && !(parent.flags & RENDER) && parent.kind === 0) ? IN_USER_EFFECT : 0);
const queueOf = (effect) => (effect.flags & RENDER && !(effect.flags & IN_USER_EFFECT) ? renderQueue : userQueue);
// 节点种类放在原型上：不占实例内存，比 instanceof 快
const SIGNAL = 1;
const COMPUTED = 2;

let activeSub;
let activeOwner;
let cycle = 0;
let runDepth = 0;
let scheduled = false;
let flushing = false;
/** 正在执行组件体的顶层：这里读响应式数据只拿到当前值，开发期要提醒 */
let inSetup = false;

const renderQueue = [];
const userQueue = [];
/** _effect 还没跑过的第一次：[节点, context, 节点, context ...]。挂载之后才执行 */
const firstRuns = [];
let renderIndex = 0;
let userIndex = 0;
let firstIndex = 0;

/** 计数（测试与基准用） */
export const stats = { effects: 0, released: 0 };
/** 开发期诊断 */
export const warnings = [];
/** 调试内核（hilt/devtools）登记的钩子。没装就是 undefined，每处只多一次判断 */
export let devHooks;
export const setDevHooks = (hooks) => (devHooks = hooks);

const { link, unlink, propagate, checkDirty, shallowPropagate } = createReactiveSystem({
  update(node) {
    if (node.kind === COMPUTED) return updateComputed(node);
    if (node.kind === SIGNAL) return updateSignal(node);
    node.flags = Mutable;
    return true;
  },
  notify(effect) {
    effect.flags &= ~Watching;
    const parent = effect.subs?.sub;
    // 绝大多数 effect 的上一层已经在队列里，或者是不追踪的作用域：不用走下面的链
    if (parent === undefined || !(parent.flags & Watching)) {
      queueOf(effect).push(effect);
      schedule();
      return;
    }
    // 外层先于内层：外层重跑时内层已被销毁，不会多跑，也不会读到外层条件已经不成立的数据
    const chain = [];
    do {
      chain.push(effect);
      effect.flags &= ~Watching;
      effect = effect.subs?.sub;
    } while (effect !== undefined && effect.flags & Watching);
    for (let i = chain.length - 1; i >= 0; i--) {
      queueOf(chain[i]).push(chain[i]);
    }
    schedule();
  },
  unwatched(node) {
    if (node.kind === COMPUTED) {
      if (node.depsTail !== undefined) {
        node.flags = Mutable | Dirty;
        disposeDeps(node);
      }
    } else if (node.kind !== SIGNAL) {
      disposeNode(node);
    }
  },
});

function schedule() {
  if (scheduled || flushing) return;
  scheduled = true;
  queueMicrotask(flushSync);
}

let lastResort = (error) => {
  if (typeof reportError === 'function') reportError(error);
  else console.error(error);
};
export const onError = (handler) => (lastResort = handler);
/** 错误边界：owner -> 处理函数。只有边界才占一项，普通节点不多字段 */
const boundaries = new WeakMap();
export const setBoundary = (owner, handler) => boundaries.set(owner, handler);
/** 顺着 owner 链找最近的边界；effect 挂在上一层时 subs 就是 owner */
function report(error, from) {
  devHooks?.error(error, from);
  for (let node = from; node !== undefined; node = node.subs?.sub) {
    const handler = boundaries.get(node);
    if (handler) return handler(error);
  }
  lastResort(error);
}

function runEffect(effect) {
  try {
    run(effect);
  } catch (error) {
    report(error, effect);
  }
}
function runFirst(node, saved) {
  // 还没等到第一次执行，所在的分支、组件已经销毁了
  if (!node.flags) return;
  const previous = context;
  context = saved;
  try {
    invoke(node);
  } catch (error) {
    report(error, node);
  } finally {
    context = previous;
  }
}

/** 把挂起的更新做完：DOM 绑定全部跑完，才跑用户 effect；用户 effect 又写了状态就再来一轮 */
export function flushSync() {
  if (flushing) return;
  flushing = true;
  scheduled = false;
  try {
    for (;;) {
      if (renderIndex < renderQueue.length) {
        const effect = renderQueue[renderIndex];
        renderQueue[renderIndex++] = undefined;
        runEffect(effect);
      } else if (firstIndex < firstRuns.length) {
        const node = firstRuns[firstIndex];
        const saved = firstRuns[firstIndex + 1];
        firstRuns[firstIndex] = firstRuns[firstIndex + 1] = undefined;
        firstIndex += 2;
        runFirst(node, saved);
      } else if (userIndex < userQueue.length) {
        const effect = userQueue[userIndex];
        userQueue[userIndex++] = undefined;
        runEffect(effect);
      } else {
        break;
      }
    }
  } finally {
    renderQueue.length = renderIndex = 0;
    userQueue.length = userIndex = 0;
    firstRuns.length = firstIndex = 0;
    flushing = false;
    rerenders = 0;
    devHooks?.flushed();
  }
}

/** 开发期诊断的开关：取调用栈很贵，服务端渲染和生产环境要关掉，否则每次读取都要取一次，warnings 还会一直涨 */
export const diagnostics = { setupReads: true };
function warnSetupRead() {
  if (!diagnostics.setupReads) return;
  warnings.push(new Error().stack);
  devHooks?.setupRead();
}

class SignalNode {
  constructor(value) {
    this.currentValue = value;
    this.pendingValue = value;
    this.subs = undefined;
    this.subsTail = undefined;
    this.flags = Mutable;
  }
  get value() {
    if (this.flags & Dirty && updateSignal(this)) {
      if (this.subs !== undefined) shallowPropagate(this.subs);
    }
    if (activeSub !== undefined) link(this, activeSub, cycle);
    else if (inSetup) warnSetupRead();
    return this.currentValue;
  }
  set value(next) {
    if (this.pendingValue === (this.pendingValue = next)) return;
    devHooks?.write(this, next);
    this.flags = Mutable | Dirty;
    if (this.subs !== undefined) propagate(this.subs, !!runDepth);
  }
}
function updateSignal(signal) {
  signal.flags = Mutable;
  return signal.currentValue !== (signal.currentValue = signal.pendingValue);
}

class ComputedNode {
  constructor(getter) {
    this.value_ = undefined;
    this.subs = undefined;
    this.subsTail = undefined;
    this.deps = undefined;
    this.depsTail = undefined;
    this.flags = None;
    this.getter = getter;
  }
  get value() {
    const flags = this.flags;
    if (flags & Dirty || (flags & Pending && (checkDirty(this.deps, this) || ((this.flags = flags & ~Pending), false)))) {
      if (updateComputed(this) && this.subs !== undefined) shallowPropagate(this.subs);
    } else if (!flags) {
      this.flags = Mutable | RecursedCheck;
      const previous = activeSub;
      activeSub = this;
      try {
        this.value_ = this.getter();
      } finally {
        activeSub = previous;
        this.flags &= ~RecursedCheck;
      }
    }
    if (activeSub !== undefined) link(this, activeSub, cycle);
    else if (inSetup) warnSetupRead();
    return this.value_;
  }
}
function updateComputed(computed) {
  computed.depsTail = undefined;
  computed.flags = Mutable | RecursedCheck;
  const previous = activeSub;
  activeSub = computed;
  try {
    ++cycle;
    const old = computed.value_;
    return old !== (computed.value_ = computed.getter(old));
  } finally {
    activeSub = previous;
    computed.flags &= ~RecursedCheck;
    purgeDeps(computed);
  }
}

class EffectNode {
  constructor(fn, flags) {
    this.fn = fn;
    this.cleanups = undefined;
    this.subs = undefined;
    this.subsTail = undefined;
    this.deps = undefined;
    this.depsTail = undefined;
    this.flags = flags;
  }
}

function runCleanups(node) {
  const cleanups = node.cleanups;
  node.cleanups = undefined;
  const previous = activeSub;
  activeSub = undefined;
  try {
    if (typeof cleanups === 'function') cleanups();
    else for (const cleanup of cleanups) cleanup();
  } finally {
    activeSub = previous;
  }
}

function invoke(node) {
  const previousSub = activeSub;
  const previousOwner = activeOwner;
  const previousSetup = inSetup;
  activeSub = node;
  activeOwner = node;
  inSetup = false;
  ++runDepth;
  devHooks?.runStart(node);
  try {
    ++cycle;
    const result = node.fn();
    if (typeof result === 'function') onCleanup(result);
  } finally {
    devHooks?.runEnd(node);
    --runDepth;
    activeSub = previousSub;
    activeOwner = previousOwner;
    inSetup = previousSetup;
    node.flags &= ~RecursedCheck;
    purgeDeps(node);
    // 运行期间写了自己读过的数据（子组件的设置期改了父级的条件）：DOM 绑定要再跑一轮，否则界面停在旧值。
    // 用户 effect 不重跑（同 Vue），写自己读过的数据不会自循环
    if (node.flags & RENDER && node.flags & Pending) requeue(node);
  }
}
const MAX_RERENDERS = 1000;
let rerenders = 0;
function requeue(node) {
  if (++rerenders > MAX_RERENDERS) {
    node.flags = Mutable;
    disposeNode(node);
    report(new Error('渲染循环：DOM 绑定一直在改自己读的数据'), node.subs?.sub);
    return;
  }
  node.flags &= ~Watching;
  renderQueue.push(node);
  schedule();
}

function run(effect) {
  const flags = effect.flags;
  if (!flags) return;
  if (flags & Dirty || (flags & Pending && checkDirty(effect.deps, effect))) {
    if (flags & HasChild) {
      let current = effect.depsTail;
      while (current !== undefined) {
        const previous = current.prevDep;
        const dep = current.dep;
        if (!dep.kind) unlink(current, effect);
        current = previous;
      }
    }
    if (effect.cleanups) runCleanups(effect);
    effect.depsTail = undefined;
    effect.flags = Watching | RecursedCheck | (flags & KEEP);
    invoke(effect);
  } else if (effect.deps !== undefined) {
    effect.flags = Watching | (flags & (HasChild | KEEP));
  }
}

function disposeDeps(node) {
  let current = node.depsTail;
  while (current !== undefined) {
    const previous = current.prevDep;
    unlink(current, node);
    current = previous;
  }
}
function disposeNode(node) {
  devHooks?.disposed(node);
  node.flags = None;
  disposeDeps(node);
  if (node.subs !== undefined) unlink(node.subs);
  if (node.cleanups) runCleanups(node);
}
function purgeDeps(node) {
  let dep = node.depsTail !== undefined ? node.depsTail.nextDep : node.deps;
  while (dep !== undefined) dep = unlink(dep, node);
}

SignalNode.prototype.kind = SIGNAL;
ComputedNode.prototype.kind = COMPUTED;
EffectNode.prototype.kind = 0;

function attach(node, parent) {
  link(node, parent, 0);
  parent.flags |= HasChild;
}

export const signal = (value) => new SignalNode(value);
export const computed = (getter) => new ComputedNode(getter);
export const dispose = (node) => disposeNode(node);

/**
 * DOM 绑定：编译器生成，排在用户 effect 前面，创建时同步跑一次把 DOM 写好。
 * 第一次跑完没读到任何响应式数据（也没有清理函数、子节点）就永远不会重跑：不挂到 owner，节点直接成为垃圾。
 * 返回节点（要提前停时交给 dispose），被丢弃时返回 undefined。没有闭包，一万行列表省一万个函数对象。
 */
export const renderEffect = (fn) => startEffect(fn, Watching | RecursedCheck | RENDER);
function startEffect(fn, flags) {
  const parent = activeSub ?? activeOwner;
  const node = new EffectNode(fn, flags | insideUserEffect(parent));
  stats.effects++;
  devHooks?.created(node, parent);
  try {
    invoke(node);
  } catch (error) {
    // 渲染中途抛错：这一段没法用了，沿调用栈往上抛，到最近的边界（没有边界就到 mount 的调用方）
    const handler = boundaries.get(node);
    if (!handler) {
      disposeNode(node);
      throw error;
    }
    handler(error);
  }
  if (node.deps === undefined && node.cleanups === undefined) {
    stats.released++;
    devHooks?.released(node, parent);
    return undefined;
  }
  if (parent !== undefined) attach(node, parent);
  return node;
}
/** 手写的 effect：同步跑第一次，排在 DOM 绑定后面重跑，返回停止函数 */
export function effect(fn) {
  const node = startEffect(fn, Watching | RecursedCheck);
  return node ? () => disposeNode(node) : () => {};
}
/** _effect：挂载之后才第一次执行（同 Svelte）。创建时就跑的话，它改的状态会让初始输出和服务端不一样，ref 也还没拿到 */
export function userEffect(fn) {
  const node = new EffectNode(fn, Watching | RecursedCheck);
  const parent = activeSub ?? activeOwner;
  stats.effects++;
  devHooks?.created(node, parent);
  if (parent !== undefined) attach(node, parent);
  firstRuns.push(node, context);
  schedule();
}
/** 列表行、应用根的作用域：不追踪，只管生命周期。返回节点，销毁时交给 dispose */
export function scope(fn) {
  const parent = activeOwner;
  const node = new EffectNode(undefined, Mutable | insideUserEffect(parent));
  devHooks?.created(node, parent);
  if (parent !== undefined) attach(node, parent);
  const previousSub = activeSub;
  const previousOwner = activeOwner;
  const previousSetup = inSetup;
  activeSub = undefined;
  activeOwner = node;
  inSetup = false;
  try {
    fn();
  } finally {
    activeSub = previousSub;
    activeOwner = previousOwner;
    inSetup = previousSetup;
  }
  return node;
}
/** 组件体只执行一次：断开外层追踪，不建作用域，里面的 effect 直接挂到上一层 owner。provide 只影响这棵子树 */
export function runSetup(fn, arg) {
  const previousSub = activeSub;
  const previousContext = context;
  const previousSetup = inSetup;
  activeSub = undefined;
  inSetup = true;
  try {
    return fn(arg);
  } finally {
    activeSub = previousSub;
    context = previousContext;
    inSetup = previousSetup;
  }
}
export function untrack(fn) {
  const previousSub = activeSub;
  const previousSetup = inSetup;
  activeSub = undefined;
  inSetup = false;
  try {
    return fn();
  } finally {
    activeSub = previousSub;
    inSetup = previousSetup;
  }
}
export const isTracking = () => activeSub !== undefined;
export const getOwner = () => activeOwner;
export const isDisposed = (node) => node !== undefined && !node.flags;
/** 回到创建时的 owner 和 context 再执行：之后才建的内容（列表行、懒加载、热更新）也挂在原来的位置 */
export function runWith(owner, saved, fn) {
  const previousSub = activeSub;
  const previousOwner = activeOwner;
  const previousContext = context;
  const previousSetup = inSetup;
  activeSub = undefined;
  activeOwner = owner;
  context = saved;
  inSetup = false;
  try {
    return fn();
  } finally {
    activeSub = previousSub;
    activeOwner = previousOwner;
    context = previousContext;
    inSetup = previousSetup;
  }
}
/** 所在的分支、列表行、应用销毁时执行。组件体里调用时跟着最近的 owner 走 */
export function onCleanup(fn) {
  const node = activeOwner;
  if (!node) return;
  if (!node.cleanups) node.cleanups = fn;
  else if (typeof node.cleanups === 'function') node.cleanups = [node.cleanups, fn];
  else node.cleanups.push(fn);
}

// ---- context：原型链（同 Vue 的 provides），查找不随组件深度变慢；只有 provide 才新建一层 ----
export const ROOT_CONTEXT = Object.create(null);
let context = ROOT_CONTEXT;
export const getContext = () => context;
export function withContext(saved, fn) {
  const previous = context;
  context = saved;
  try {
    return fn();
  } finally {
    context = previous;
  }
}
export const createContext = (fallback) => ({ id: Symbol('context'), fallback });
export function provideValue(id, value) {
  context = Object.create(context);
  context[id] = value;
}
export const provide = (ctx, value) => provideValue(ctx.id, value);
export function inject(ctx) {
  const value = context[ctx.id];
  return value === undefined ? ctx.fallback : value;
}
