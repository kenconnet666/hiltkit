// 实验：在 alien-signals/system（只有依赖图算法）上自建的薄内核，补上直接用 alien-signals 缺的：
//   - 两个队列：DOM 绑定先跑，用户 effect 后跑，用户 effect 总能看到更新好的 DOM
//   - 微任务批处理，写在内核里，不用每个 signal 再包一层函数
//   - 错误隔离：一个 effect 抛错不牵连同一轮的其他 effect
//   - onCleanup、owner 链（context 不用另外维护一条）
// 节点是 class，读写走 .value：不用 bind，每个 signal 少一个函数对象；手写时也和 Vue、TC39 Signals 的习惯一致
import { createReactiveSystem, ReactiveFlags } from 'alien-signals/system';

const { Mutable, Watching, RecursedCheck, Recursed, Dirty, Pending, None } = ReactiveFlags;
const HasChild = 64;
const RENDER = 128;
// 节点种类放在原型上：不占实例内存，比 instanceof 快
const SIGNAL = 1;
const COMPUTED = 2;

let activeSub;
let activeOwner;
let cycle = 0;
let runDepth = 0;
let scheduled = false;
let flushing = false;

const renderQueue = [];
const userQueue = [];
let renderIndex = 0;
let userIndex = 0;

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
    // 绝大多数 effect 的上一层是不追踪的作用域：不用走下面的链
    if (parent === undefined || !(parent.flags & Watching)) {
      (effect.flags & RENDER ? renderQueue : userQueue).push(effect);
      schedule();
      return;
    }
    // 外层先于内层：alien 同样按这个顺序。外层重跑时内层已被销毁，不会多跑
    const chain = [];
    do {
      chain.push(effect);
      effect.flags &= ~Watching;
      effect = effect.subs?.sub;
    } while (effect !== undefined && effect.flags & Watching);
    for (let i = chain.length - 1; i >= 0; i--) {
      (chain[i].flags & RENDER ? renderQueue : userQueue).push(chain[i]);
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

function runEffect(effect) {
  try {
    run(effect);
  } catch (error) {
    report(error);
  }
}
let report = (error) => {
  if (typeof reportError === 'function') reportError(error);
  else console.error(error);
};
export const onError = (handler) => (report = handler);

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
    flushing = false;
  }
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
    return this.currentValue;
  }
  set value(next) {
    if (this.pendingValue === (this.pendingValue = next)) return;
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
    this.owner = activeOwner;
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
  activeSub = node;
  activeOwner = node;
  ++runDepth;
  try {
    ++cycle;
    const result = node.fn();
    if (typeof result === 'function') onCleanup(result);
  } finally {
    --runDepth;
    activeSub = previousSub;
    activeOwner = previousOwner;
    node.flags &= ~RecursedCheck;
    purgeDeps(node);
  }
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
    effect.flags = Watching | RecursedCheck | (flags & RENDER);
    invoke(effect);
  } else if (effect.deps !== undefined) {
    effect.flags = Watching | (flags & (HasChild | RENDER));
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

function create(fn, flags) {
  const node = new EffectNode(fn, flags);
  const parent = activeSub ?? activeOwner;
  if (parent !== undefined) {
    link(node, parent, 0);
    parent.flags |= HasChild;
  }
  // 第一次同步执行：组件挂载时就要把 DOM 写好。用户 effect 的首次执行时机留给框架决定
  invoke(node);
  return () => disposeNode(node);
}

export const signal = (value) => new SignalNode(value);
export const computed = (getter) => new ComputedNode(getter);
/** DOM 绑定：编译器生成，排在用户 effect 前面 */
export const renderEffect = (fn) => create(fn, Watching | RecursedCheck | RENDER);
/** 用户 effect：_effect */
export const effect = (fn) => create(fn, Watching | RecursedCheck);
/** 组件、列表项的作用域：不追踪，只管生命周期与 context */
export function scope(fn) {
  const node = new EffectNode(fn, Mutable);
  const parent = activeOwner;
  if (parent !== undefined) {
    link(node, parent, 0);
    parent.flags |= HasChild;
  }
  const previousSub = activeSub;
  const previousOwner = activeOwner;
  activeSub = undefined;
  activeOwner = node;
  try {
    fn();
  } finally {
    activeSub = previousSub;
    activeOwner = previousOwner;
  }
  return () => disposeNode(node);
}
export function untrack(fn) {
  const previous = activeSub;
  activeSub = undefined;
  try {
    return fn();
  } finally {
    activeSub = previous;
  }
}
export function onCleanup(fn) {
  const node = activeOwner;
  if (!node) return;
  if (!node.cleanups) node.cleanups = fn;
  else if (typeof node.cleanups === 'function') node.cleanups = [node.cleanups, fn];
  else node.cleanups.push(fn);
}
// context 只有 provider 才有：放进 WeakMap，每个 effect 少一个字段
const contexts = new WeakMap();
export function provide(key, value) {
  let map = contexts.get(activeOwner);
  if (!map) contexts.set(activeOwner, (map = new Map()));
  map.set(key, value);
}
export function inject(key, fallback) {
  for (let node = activeOwner; node; node = node.owner) {
    const map = contexts.get(node);
    if (map?.has(key)) return map.get(key);
  }
  return fallback;
}
void Recursed;
