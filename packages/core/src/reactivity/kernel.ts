/**
 * 响应式内核：整个框架唯一知道“依赖怎么追踪、更新怎么调度”的地方。
 *
 * 依赖图算法来自 alien-signals/system（只有算法，不含调度）。这里在它上面补了直接用 alien-signals 缺的部分：
 *   - 两个队列：DOM 绑定先跑，用户 effect 后跑，所以用户 effect 总能看到更新好的 DOM
 *   - 微任务批处理写在内核里，不用给每个 signal 再包一层函数
 *   - 错误隔离：一个 effect 抛错不牵连同一轮的其他 effect
 *   - owner 链管销毁；context 只是原型链上的一个指针，组件本身不占节点
 *
 * 上层关系：`sig.ts` 把节点包成用户看到的 `count()`、`count.set()`；`render/` 用 `renderEffect` 建 DOM 绑定。
 * 节点是 class，读写走 `.value`：不用 bind，每个 signal 少一个函数对象。
 */
import { createReactiveSystem, type Link, type ReactiveNode } from 'alien-signals/system';

// alien-signals 的 ReactiveFlags 是 const enum，单文件转换拿不到，这里按它公开的数值写一份
const None = 0;
const Mutable = 1;
const Watching = 2;
const RecursedCheck = 4;
const Dirty = 16;
const Pending = 32;
// 下面三个是内核自己加的标志位，紧接在 alien-signals 用的位后面
const HasChild = 64;
const RENDER = 128;
/** 这个 DOM 绑定长在用户 effect 里面：外层要先跑，不能抢到 DOM 队列里，否则读到外层条件已经不成立的数据 */
const IN_USER_EFFECT = 256;
const KEEP = RENDER | IN_USER_EFFECT;

/** 节点种类放在原型上：不占实例内存，比 instanceof 快。0 是 effect 或作用域 */
export const KIND_EFFECT = 0;
export const KIND_SIGNAL = 1;
export const KIND_COMPUTED = 2;

/** 内核里的任何节点 */
export interface KernelNode extends ReactiveNode {
  kind: number;
}
/** 可读可写的单元：SignalNode、以及 `sig.ts` 里的 Lens 都长这样 */
export interface Cell<T> {
  value: T;
}
type Cleanup = () => void;
/** effect 函数：可以返回一个清理函数，下次重跑或销毁时执行 */
export type EffectFn = () => void | (() => void);

const insideUserEffect = (parent: EffectNode | undefined): number =>
  parent !== undefined &&
  (parent.flags & IN_USER_EFFECT ||
    (parent.flags & Watching && !(parent.flags & RENDER) && parent.kind === KIND_EFFECT))
    ? IN_USER_EFFECT
    : 0;
const queueOf = (effect: EffectNode): EffectNode[] =>
  effect.flags & RENDER && !(effect.flags & IN_USER_EFFECT) ? renderQueue : userQueue;

let activeSub: KernelNode | undefined;
let activeOwner: EffectNode | undefined;
let cycle = 0;
let runDepth = 0;
let scheduled = false;
let flushing = false;
/** 正在执行组件体的顶层：这里读响应式数据只拿到当前值，开发期要提醒 */
let inSetup = false;

const renderQueue: EffectNode[] = [];
const userQueue: EffectNode[] = [];
/** effect 还没跑过的第一次：[节点, context, 节点, context ...]。挂载之后才执行 */
const firstRuns: unknown[] = [];
let renderIndex = 0;
let userIndex = 0;
let firstIndex = 0;

/** 计数（测试与基准用） */
export const stats = { effects: 0, released: 0 };
/** 开发期诊断：组件体里直接读响应式数据时记下调用栈 */
export const warnings: unknown[] = [];

/** 调试内核要的钩子，由 `hiltkit/devtools` 登记。内核和渲染层只在这些点通知它，自己不知道调试工具长什么样 */
export interface DevHooks {
  /** 接下来创建的 effect 是什么：属性绑定、动态段、列表 */
  label(kind: string, el?: unknown, key?: string): void;
  created(node: EffectNode, parent: EffectNode | undefined): void;
  /** 第一次跑完没读到数据的绑定不会再跑，节点被丢弃 */
  released(node: EffectNode, parent: EffectNode | undefined): void;
  runStart(node: EffectNode): void;
  runEnd(node: EffectNode): void;
  disposed(node: EffectNode): void;
  write(node: SignalNode<any>, next: unknown): void;
  flushed(): void;
  error(error: unknown, from: unknown): void;
  setupRead(): void;
  issue(code: string, message: string, fix: string): void;
  mismatch(expected: string, actual: unknown): void;
  field(node: SignalNode<any>, key: unknown): void;
  shell(shell: unknown, cell: unknown): void;
  named(cell: unknown, name: string): void;
  merged(out: unknown): void;
  element(el: unknown, node: unknown): void;
  component(node: unknown, mount: () => void): void;
  app<T>(host: Element, render: () => T): T;
}
/** 没装调试内核时是 undefined：每处只多一次判断，实测对生产产物没有可见影响 */
export let devHooks: DevHooks | undefined;
export const setDevHooks = (hooks: DevHooks | undefined): void => {
  devHooks = hooks;
};

const { link, unlink, propagate, checkDirty, shallowPropagate } = createReactiveSystem({
  update(node) {
    const { kind } = node as KernelNode;
    if (kind === KIND_COMPUTED) return updateComputed(node as ComputedNode<unknown>);
    if (kind === KIND_SIGNAL) return updateSignal(node as SignalNode<unknown>);
    node.flags = Mutable;
    return true;
  },
  notify(node) {
    let effect = node as EffectNode;
    effect.flags &= ~Watching;
    const parent = effect.subs?.sub;
    // 绝大多数 effect 的上一层已经在队列里，或者是不追踪的作用域：不用走下面的链
    if (parent === undefined || !(parent.flags & Watching)) {
      queueOf(effect).push(effect);
      schedule();
      return;
    }
    // 外层先于内层：外层重跑时内层已被销毁，不会多跑，也不会读到外层条件已经不成立的数据
    const chain: EffectNode[] = [];
    let current: EffectNode | undefined = effect;
    do {
      chain.push(current);
      current.flags &= ~Watching;
      current = current.subs?.sub as EffectNode | undefined;
    } while (current !== undefined && current.flags & Watching);
    for (let i = chain.length - 1; i >= 0; i--) {
      const item = chain[i]!;
      queueOf(item).push(item);
    }
    schedule();
  },
  unwatched(node) {
    const { kind } = node as KernelNode;
    if (kind === KIND_COMPUTED) {
      if (node.depsTail !== undefined) {
        node.flags = Mutable | Dirty;
        disposeDeps(node);
      }
    } else if (kind !== KIND_SIGNAL) {
      disposeNode(node as EffectNode);
    }
  },
});

function schedule(): void {
  if (scheduled || flushing) return;
  scheduled = true;
  queueMicrotask(flushSync);
}

let lastResort = (error: unknown): void => {
  if (typeof reportError === 'function') reportError(error);
  else console.error(error);
};
/** 没有错误边界接住的错误交给谁。默认走浏览器的 reportError */
export const onError = (handler: (error: unknown) => void): void => {
  lastResort = handler;
};
/** 错误边界：owner -> 处理函数。只有边界才占一项，普通节点不多字段 */
const boundaries = new WeakMap<object, (error: Error) => void>();
export const setBoundary = (owner: object, handler: (error: Error) => void): void => {
  boundaries.set(owner, handler);
};
/** 顺着 owner 链找最近的边界；effect 挂在上一层时 subs 就是 owner */
function report(error: unknown, from: ReactiveNode | undefined): void {
  devHooks?.error(error, from);
  for (let node = from; node !== undefined; node = node.subs?.sub) {
    const handler = boundaries.get(node);
    if (handler) return handler(error as Error);
  }
  lastResort(error);
}

function runEffect(effect: EffectNode): void {
  try {
    run(effect);
  } catch (error) {
    report(error, effect);
  }
}
function runFirst(node: EffectNode, saved: Context): void {
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
export function flushSync(): void {
  if (flushing) return;
  flushing = true;
  scheduled = false;
  try {
    for (;;) {
      if (renderIndex < renderQueue.length) {
        const effect = renderQueue[renderIndex]!;
        // 跑之前就清掉引用：effect 可能在跑的时候把自己销毁，队列不能继续持有
        renderQueue[renderIndex++] = undefined as never;
        runEffect(effect);
      } else if (firstIndex < firstRuns.length) {
        const node = firstRuns[firstIndex] as EffectNode;
        const saved = firstRuns[firstIndex + 1] as Context;
        firstRuns[firstIndex] = firstRuns[firstIndex + 1] = undefined;
        firstIndex += 2;
        runFirst(node, saved);
      } else if (userIndex < userQueue.length) {
        const effect = userQueue[userIndex]!;
        userQueue[userIndex++] = undefined as never;
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
function warnSetupRead(): void {
  if (!diagnostics.setupReads) return;
  warnings.push(new Error().stack);
  devHooks?.setupRead();
}

/**
 * 上报一个使用问题：控制台警告一次，装了调试内核时进问题清单。给组件库用：
 * 比如语言标签写错了，页面照常显示（回退到上一层），但开发者要看得到。
 */
export function reportIssue(code: string, message: string, fix: string): void {
  console.warn(`[${code}] ${message} ${fix}`);
  devHooks?.issue(code, message, fix);
}

/** 可写的信号。写入先记到 pendingValue，真正生效要等依赖它的节点来读，这样同一轮多次写入只算一次 */
export class SignalNode<T> implements KernelNode, Cell<T> {
  declare kind: number;
  currentValue: T;
  pendingValue: T;
  subs: Link | undefined = undefined;
  subsTail: Link | undefined = undefined;
  flags = Mutable;
  constructor(value: T) {
    this.currentValue = value;
    this.pendingValue = value;
  }
  get value(): T {
    if (this.flags & Dirty && updateSignal(this)) {
      if (this.subs !== undefined) shallowPropagate(this.subs);
    }
    if (activeSub !== undefined) link(this, activeSub, cycle);
    else if (inSetup) warnSetupRead();
    return this.currentValue;
  }
  set value(next: T) {
    if (this.pendingValue === (this.pendingValue = next)) return;
    devHooks?.write(this, next);
    this.flags = Mutable | Dirty;
    if (this.subs !== undefined) propagate(this.subs, !!runDepth);
  }
}
function updateSignal(signal: SignalNode<unknown>): boolean {
  signal.flags = Mutable;
  return signal.currentValue !== (signal.currentValue = signal.pendingValue);
}

/** 派生值：第一次读才计算，依赖变了才重算；没人订阅时释放依赖，不挡回收 */
export class ComputedNode<T> implements KernelNode {
  declare kind: number;
  value_: T | undefined = undefined;
  subs: Link | undefined = undefined;
  subsTail: Link | undefined = undefined;
  deps: Link | undefined = undefined;
  depsTail: Link | undefined = undefined;
  flags = None;
  getter: (previous?: T) => T;
  constructor(getter: (previous?: T) => T) {
    this.getter = getter;
  }
  get value(): T {
    const flags = this.flags;
    if (
      flags & Dirty ||
      (flags & Pending &&
        (checkDirty(this.deps!, this) || ((this.flags = flags & ~Pending), false)))
    ) {
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
    return this.value_ as T;
  }
}
function updateComputed<T>(computed: ComputedNode<T>): boolean {
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

/** effect、DOM 绑定、作用域共用的节点。fn 是 undefined 的就是作用域：不追踪，只管生命周期 */
export class EffectNode implements KernelNode {
  declare kind: number;
  fn: EffectFn | undefined;
  cleanups: Cleanup | Cleanup[] | undefined = undefined;
  subs: Link | undefined = undefined;
  subsTail: Link | undefined = undefined;
  deps: Link | undefined = undefined;
  depsTail: Link | undefined = undefined;
  flags: number;
  constructor(fn: EffectFn | undefined, flags: number) {
    this.fn = fn;
    this.flags = flags;
  }
}

function runCleanups(node: EffectNode): void {
  const cleanups = node.cleanups!;
  node.cleanups = undefined;
  const previous = activeSub;
  // 清理函数里读数据不算依赖
  activeSub = undefined;
  try {
    if (typeof cleanups === 'function') cleanups();
    else for (const cleanup of cleanups) cleanup();
  } finally {
    activeSub = previous;
  }
}

function invoke(node: EffectNode): void {
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
    const result = node.fn!();
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
function requeue(node: EffectNode): void {
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

function run(effect: EffectNode): void {
  const flags = effect.flags;
  if (!flags) return;
  if (flags & Dirty || (flags & Pending && checkDirty(effect.deps!, effect))) {
    if (flags & HasChild) {
      // 子节点也挂在 deps 链上（kind 是 0）：重跑前销毁，这一轮会重新建
      let current = effect.depsTail;
      while (current !== undefined) {
        const previous: Link | undefined = current.prevDep;
        const dep = current.dep as KernelNode;
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

function disposeDeps(node: ReactiveNode): void {
  let current = node.depsTail;
  while (current !== undefined) {
    const previous: Link | undefined = current.prevDep;
    unlink(current, node);
    current = previous;
  }
}
function disposeNode(node: EffectNode): void {
  devHooks?.disposed(node);
  node.flags = None;
  disposeDeps(node);
  if (node.subs !== undefined) unlink(node.subs);
  if (node.cleanups) runCleanups(node);
}
function purgeDeps(node: ReactiveNode): void {
  let dep = node.depsTail !== undefined ? node.depsTail.nextDep : node.deps;
  while (dep !== undefined) dep = unlink(dep, node);
}

SignalNode.prototype.kind = KIND_SIGNAL;
ComputedNode.prototype.kind = KIND_COMPUTED;
EffectNode.prototype.kind = KIND_EFFECT;

/** 子节点挂到 owner：子节点是 owner 的“依赖”，owner 重跑或销毁时它跟着没 */
function attach(node: EffectNode, parent: EffectNode): void {
  link(node, parent, 0);
  parent.flags |= HasChild;
}

export const signal = <T>(value: T): SignalNode<T> => new SignalNode(value);
export const computed = <T>(getter: (previous?: T) => T): ComputedNode<T> =>
  new ComputedNode(getter);
export const dispose = (node: EffectNode): void => disposeNode(node);

/**
 * DOM 绑定：排在用户 effect 前面，创建时同步跑一次把 DOM 写好。
 * 第一次跑完没读到任何响应式数据（也没有清理函数、子节点）就永远不会重跑：不挂到 owner，节点直接成为垃圾。
 * 返回节点（要提前停时交给 dispose），被丢弃时返回 undefined。
 */
export const renderEffect = (fn: EffectFn): EffectNode | undefined =>
  startEffect(fn, Watching | RecursedCheck | RENDER);
function startEffect(fn: EffectFn, flags: number): EffectNode | undefined {
  const parent = (activeSub ?? activeOwner) as EffectNode | undefined;
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
    handler(error as Error);
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
export function effect(fn: EffectFn): () => void {
  const node = startEffect(fn, Watching | RecursedCheck);
  return node ? () => disposeNode(node) : () => {};
}
/** 挂载之后才第一次执行（同 Svelte）。创建时就跑的话，它改的状态会让初始输出和服务端不一样，ref 也还没拿到 */
export function userEffect(fn: EffectFn): void {
  const node = new EffectNode(fn, Watching | RecursedCheck);
  const parent = (activeSub ?? activeOwner) as EffectNode | undefined;
  stats.effects++;
  devHooks?.created(node, parent);
  if (parent !== undefined) attach(node, parent);
  firstRuns.push(node, context);
  schedule();
}
/** 列表行、应用根的作用域：不追踪，只管生命周期。返回节点，销毁时交给 dispose */
export function scope(fn: () => void): EffectNode {
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
export function runSetup<A, R>(fn: (arg: A) => R, arg: A): R {
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
/** 读数据但不建立依赖 */
export function untrack<T>(fn: () => T): T {
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
export const isTracking = (): boolean => activeSub !== undefined;
export const getOwner = (): EffectNode | undefined => activeOwner;
/** 回到创建时的 owner 和 context 再执行：之后才建的内容（列表行、懒加载、热更新）也挂在原来的位置 */
export function runWith<T>(owner: EffectNode | undefined, saved: Context, fn: () => T): T {
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
export function onCleanup(fn: Cleanup): void {
  const node = activeOwner;
  if (!node) return;
  if (!node.cleanups) node.cleanups = fn;
  else if (typeof node.cleanups === 'function') node.cleanups = [node.cleanups, fn];
  else node.cleanups.push(fn);
}

// ---- context：原型链（同 Vue 的 provides），查找不随组件深度变慢；只有 provide 才新建一层 ----
/** 一层 context。键是 symbol，读的时候顺着原型链往上找 */
export type Context = Record<symbol, unknown>;
export const ROOT_CONTEXT: Context = Object.create(null);
let context = ROOT_CONTEXT;
export const getContext = (): Context => context;
export function withContext<T>(saved: Context, fn: () => T): T {
  const previous = context;
  context = saved;
  try {
    return fn();
  } finally {
    context = previous;
  }
}
/** createContext 的返回值：传给 provide 和 inject */
export interface ContextKey<T> {
  readonly id: symbol;
  readonly fallback: T;
}
/** 建一个上下文。fallback 是没有 provide 时 inject 拿到的值 */
export const createContext = <T>(fallback: T): ContextKey<T> => ({
  id: Symbol('context'),
  fallback,
});
export function provideValue(id: symbol, value: unknown): void {
  context = Object.create(context) as Context;
  context[id] = value;
}
/** 给当前组件的子树提供值 */
export const provide = <T>(ctx: ContextKey<T>, value: T): void => provideValue(ctx.id, value);
/** 读最近一层 provide 的值，没有就是 createContext 的 fallback */
export function inject<T>(ctx: ContextKey<T>): T {
  const value = context[ctx.id];
  return value === undefined ? ctx.fallback : (value as T);
}
