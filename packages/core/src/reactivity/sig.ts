/**
 * 用户看到的响应式 API：`sig`、`derived`、`effect`、`model`、`read`。
 *
 * 三条规则都在这里落地：带 `()` 读；写用方法；传有 `set` 的 `Sig` 才能写回。
 * 一个 `Sig` 就是一个函数（壳），里面的 `$` 指向真正存值的单元：
 * 内核的 SignalNode，或者 Lens（字段、trim、has 这类“读写都转发给别处”的视图）。
 */
import {
  computed as rawComputed,
  devHooks,
  renderEffect,
  signal,
  untrack,
  userEffect,
  type Cell,
  type EffectFn,
} from './kernel';
import { state as deepState } from './state';

declare const WRITE: unique symbol;
/** 只读的读取函数 */
export type ReadSig<T> = () => T;
/** 只读来源：普通函数、derived。Sig 不算，否则 Sig<string> 能混进 Model<string | null> */
export type ReadOnly<T> = (() => T) & { set?: undefined };
/** 可读可写的响应式值。`count()` 读，`count.set(1)` 写 */
export interface Sig<T> {
  (): T;
  /** 读当前值，不建立依赖 */
  peek(): T;
  set(value: T): void;
  update(change: (value: T) => T): void;
  /** 写入端逆变，读取端协变，合起来不变 */
  readonly [WRITE]: (value: T) => void;
  inc(this: Sig<number>, by?: number): void;
  dec(this: Sig<number>, by?: number): void;
  toggle(this: Sig<boolean>): void;
  /** 读原样，写入时去掉首尾空白 */
  trim(this: Sig<string>): Sig<string>;
  /** 把数组里“有没有这一项”变成布尔壳，多选框直接绑它 */
  has<I>(this: Sig<I[]>, item: I): Sig<boolean>;
  /** 取一个字段的壳：form.at((f) => f.address.city)。只能写字段路径，可空路径写 f.address?.city */
  at<R>(path: (value: T) => R): Sig<R>;
  /** 第一层每个字段一个壳，解构出来还是活的：const { name, age } = form.fields() */
  fields(): { readonly [K in keyof NonNullable<T>]-?: Sig<NonNullable<T>[K]> };
}
/** sig(value) 默认深代理；sig.raw(value) 不代理，只能整体替换，大列表用它 */
export interface SigFactory {
  <T>(initial: T): Sig<T>;
  raw<T>(initial: T): Sig<T>;
}
/** 只读 prop：值或读取函数 */
export type Prop<T> = T | ReadSig<T>;
/** 可绑定的 prop：传 Sig 双向，传值或只读函数单向，不传组件自己持有 */
export type Model<T> = T | ReadOnly<T> | Sig<T>;

/** 所有壳共用的原型：方法只有一份，一万个 sig 不多一万组函数 */
const proto: any = Object.create(Function.prototype);
const methods: Record<string, (this: any, ...args: any[]) => unknown> = {
  peek() {
    return untrack(this);
  },
  set(value: unknown) {
    this.$.value = this.$raw ? value : deepState(value);
  },
  update(change: (value: unknown) => unknown) {
    const next = change(untrack(this));
    this.$.value = this.$raw ? next : deepState(next);
  },
  inc(by = 1) {
    this.$.value = untrack<any>(this) + by;
  },
  dec(by = 1) {
    this.$.value = untrack<any>(this) - by;
  },
  toggle() {
    this.$.value = !untrack(this);
  },
  trim() {
    const source = this;
    return make(
      new Lens(
        () => source(),
        (next: string) => source.set(next.trim()),
      ),
    );
  },
  has(item: unknown) {
    const source = this;
    return make(
      new Lens(
        () => source().includes(item),
        (on: boolean) =>
          source.set(
            on
              ? [...untrack<any>(source), item]
              : (untrack(source) as unknown[]).filter((other) => other !== item),
          ),
      ),
    );
  },
  at(path: (value: unknown) => unknown) {
    const keys = recordPath(path);
    return keys.length ? fieldOf(this, keys) : this;
  },
  fields() {
    const source = this;
    const made = new Map<string, unknown>();
    return new Proxy(Object.create(null), {
      get(_, key) {
        if (typeof key === 'symbol') return undefined;
        let field = made.get(key);
        if (!field) made.set(key, (field = fieldOf(source, [key])));
        return field;
      },
      ownKeys: () => Reflect.ownKeys(untrack<any>(source) ?? {}),
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
    });
  },
};
/** 用一个只会记录的代理跑一遍 lambda，拿到字段路径（同 easy-query 的 u.company.name）。运算、调用方法都不是路径 */
function recordPath(path: (value: any) => unknown): string[] {
  const keys: string[] = [];
  const recorder: any = new Proxy(function () {}, {
    get(_, key) {
      if (typeof key === 'symbol')
        throw new TypeError('at 只能写字段路径，比如 (f) => f.address.city');
      keys.push(key);
      return recorder;
    },
    apply() {
      throw new TypeError('at 只能写字段路径，不能调用方法');
    },
  });
  if (path(recorder) !== recorder)
    throw new TypeError('at 只能写字段路径，比如 (f) => f.address.city');
  return keys;
}
function fieldOf(source: any, keys: string[]): any {
  const field = make(
    new Lens(
      () => {
        let value = source();
        for (const key of keys) {
          if (value == null) return undefined;
          value = value[key];
        }
        return value;
      },
      (next: unknown) => {
        if (source.$raw)
          throw new TypeError('sig.raw 不代理，字段改了也不会更新：要用 set 整体替换');
        let parent = untrack<any>(source);
        for (const key of keys.slice(0, -1)) parent = parent?.[key];
        if (parent == null) throw new TypeError(`不能写 ${keys.join('.')}：上一层是 ${parent}`);
        parent[keys[keys.length - 1]!] = next;
      },
    ),
  );
  // 字段的字段（raw.at(...).at(...)）也要知道根是 raw，否则写入没人通知、静默失效
  if (source.$raw) field.$raw = true;
  return field;
}
// 方法第一次被取用时绑定到这个壳上：onClick={on.toggle}、onChange={on.set} 摘下来也能用，没用到的方法不占内存
for (const name of Object.keys(methods)) {
  Object.defineProperty(proto, name, {
    configurable: true,
    get(this: any) {
      const bound = methods[name]!.bind(this);
      Object.defineProperty(this, name, { value: bound });
      return bound;
    },
  });
}
/** 不存值的单元：读写都转发给别处，外表和 SignalNode 一样有 `.value` */
class Lens<T> implements Cell<T> {
  private readonly read: () => T;
  private readonly write: (value: T) => void;
  constructor(read: () => T, write: (value: T) => void) {
    this.read = read;
    this.write = write;
  }
  get value(): T {
    return this.read();
  }
  set value(next: T) {
    this.write(next);
  }
}
function make(cell: Cell<any>): any {
  const read: any = () => cell.value;
  read.$ = cell;
  Object.setPrototypeOf(read, proto);
  devHooks?.shell(read, cell);
  return read;
}
/** 是不是 Sig：有没有 `$`。普通函数、derived 都不是 */
export const isSig = (value: unknown): value is Sig<unknown> =>
  typeof value === 'function' && (value as any).$ !== undefined;
/** 建响应式值。对象默认深代理，改字段也会更新 */
export const sig: SigFactory = Object.assign(
  <T>(initial: T): Sig<T> => make(signal(deepState(initial))),
  {
    raw<T>(initial: T): Sig<T> {
      const shell = make(signal(initial));
      shell.$raw = true;
      return shell;
    },
  },
);
/** 派生值。只给 read 是只读的，依赖没变不重算；再给 write 就是可写的 Sig，读写都转发 */
export function derived<T>(read: () => T): ReadOnly<T>;
export function derived<T>(read: () => T, write: (value: T) => void): Sig<T>;
export function derived(read: () => any, write?: (value: any) => void): any {
  if (write) return make(new Lens(read, write));
  const cell = rawComputed(read);
  devHooks?.named(cell, 'derived');
  return () => cell.value;
}
let serverMode = false;
/** 正在服务端渲染：组件库据此避开只有浏览器才知道的东西（时区、窗口大小） */
export const isServerRendering = (): boolean => serverMode;
/** 服务端渲染期间打开：effect 不执行 */
export const setServerMode = (value: boolean): void => {
  serverMode = value;
};
/** 挂载之后才第一次执行；服务端不执行。可以返回清理函数 */
export const effect = (fn: EffectFn): void => {
  if (!serverMode) userEffect(fn);
};
/** 读 Prop：值原样，函数调用 */
export const read = <T>(value: Prop<T>): T =>
  typeof value === 'function' ? (value as ReadSig<T>)() : value;

/**
 * 一次归一化：组件内部永远拿到 Sig。传 Sig 就是它本身；传值或只读函数：跟着变，写入留在本地，
 * 有 onChange 又没采纳就退回（受控组件的写法）
 */
export function model<T>(
  source: Model<T> | undefined,
  fallback: T,
  onChange?: (value: T) => void,
): Sig<T> {
  if (isSig(source)) return source as Sig<T>;
  const current = () => (typeof source === 'function' ? (source as ReadSig<T>)() : source);
  const first = untrack(current);
  const local = signal(deepState(first !== undefined ? first : fallback));
  devHooks?.named(local, 'model');
  if (typeof source === 'function') {
    // 来源变回 undefined 就回到默认值：Model<string | undefined> 里 undefined 也是合法的值
    renderEffect(() => {
      const incoming = current();
      local.value = deepState((incoming !== undefined ? incoming : fallback) as T);
    });
  }
  return make(
    new Lens<T>(
      () => local.value as T,
      (next: T) => {
        local.value = deepState(next);
        if (!onChange) return;
        onChange(next);
        queueMicrotask(() => {
          const incoming = untrack(current);
          if (incoming !== undefined && incoming !== untrack(() => local.value))
            local.value = incoming as T;
        });
      },
    ),
  );
}
