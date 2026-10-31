// 实验：不用符文时的响应式层，全部建在现有运行时上。壳就是内核的节点，读写走 .value。
//   ReadRef<T>  只读（computed）；Ref<T> 可写。靠写入端的幻影类型区分，TS 的 readonly 不影响赋值兼容，拦不住
//   this: 限定方法（同 easy-query 的 Expr<T>）：trim 只有 Ref<string> 能调，has 只有数组能调
import { bindInput, computed as rawComputed, onCleanup, renderEffect, setterOf, signal, spread, state as rawState, untrack, userEffect, attrValue, attrState, attrBool, omit, propsView } from '@hilt/runtime';

export { computed as rawComputed } from '@hilt/runtime';
declare const WRITE: unique symbol;
const IS_REF = Symbol.for('hilt.ref');

export interface ReadRef<T> {
  readonly value: T;
}
export interface Ref<T> extends ReadRef<T> {
  value: T;
  /** 写入端逆变、读取端协变，合起来不变：Ref<string> 不能传给 Ref<string | null>，否则子组件能写进 null */
  readonly [WRITE]: (value: T) => void;
}

/** 可写壳的公共实现：get / set 决定来源，派生的壳（换算、去空格、字段）都是它 */
class Lens<T> {
  constructor(
    private readonly read: () => T,
    private readonly write: (value: T) => void,
  ) {}
  get value(): T {
    return this.read();
  }
  set value(next: T) {
    this.write(next);
  }
}
(Lens.prototype as any)[IS_REF] = true;
const SignalProto = Object.getPrototypeOf(signal(0));
SignalProto[IS_REF] = true;

export const isRef = (value: unknown): value is Ref<unknown> => typeof value === 'object' && value !== null && (value as any)[IS_REF] === true;
export const ref = <T>(initial: T): Ref<T> => signal(initial) as unknown as Ref<T>;
export const computed = <T>(read: () => T): ReadRef<T> => rawComputed(read) as ReadRef<T>;
/** 可写的派生：读和写都由你定。受控拦截、单位换算都用它，不需要 onXxxChange */
export const writable = <T>(read: () => T, write: (value: T) => void): Ref<T> => new Lens(read, write) as unknown as Ref<T>;
export const effect = userEffect;

// ---- this 限定的派生壳：只有类型对得上才能调 ----
export const trimmed = (source: Ref<string>): Ref<string> => writable(() => source.value, (next) => (source.value = next.trim()));
export const member = <T>(list: Ref<readonly T[]> | Ref<T[]>, item: T): Ref<boolean> =>
  writable(
    () => (list as ReadRef<readonly T[]>).value.includes(item),
    (on) => {
      const current = untrack(() => (list as ReadRef<T[]>).value);
      (list as Ref<T[]>).value = on ? [...current, item] : current.filter((other) => other !== item);
    },
  );

/** 转交：中间层写 value={value}，写入继续往上走；上一层没给写入就是只读，开发期提示 */
export function setProp(props: any, key: string, value: unknown): void {
  const set = setterOf(props, key);
  if (set) set(value);
  else console.warn(`[bind] ${key} 的来源不能写回`);
}
/** 服务端取当前值：壳读 .value，函数信号调用，其余原样 */
export const unref = (value: any): unknown => (isRef(value) ? value.value : typeof value === 'function' && value[IS_REF] ? value() : value);
/** _ref(o.a) 的编译结果：对象字段的壳 */
export const fieldRef = (target: any, key: string): Ref<any> => writable(() => target[key], (next) => (target[key] = next));

// ---- 路径代理：form 的任意字段都是壳，可空路径的类型跟着传播（同 easy-query 的 u.company.name → string | null）----
type Nullish = null | undefined;
type Leaf = readonly unknown[] | Date | Map<any, any> | Set<any> | ((...args: any[]) => any);
/** N：路径上已经遇到的 null / undefined，往下传给每个子字段 */
export type Fields<T, N = never> = Ref<T | N> &
  ([NonNullable<T>] extends [Leaf]
    ? unknown
    : [NonNullable<T>] extends [object]
      ? { readonly [K in keyof NonNullable<T>]-?: Fields<NonNullable<T>[K], N | Extract<T, Nullish>> }
      : unknown);
/** fields(form).address.city：写入时一路读到父对象再赋值；父对象是 null 时写入报错，不悄悄丢 */
export function fields<T extends object>(target: T): Fields<T> {
  const make = (read: () => any, write: (value: any) => void): any =>
    new Proxy(new Lens(read, write), {
      get(lens, key, receiver) {
        if (key === 'value' || key === IS_REF || typeof key === 'symbol') return Reflect.get(lens, key, lens);
        void receiver;
        return make(
          () => read()?.[key],
          (value) => {
            const parent = untrack(read);
            if (parent == null) throw new TypeError(`不能写 ${String(key)}：上一层是 ${parent}`);
            parent[key] = value;
          },
        );
      },
      set(lens, key, value) {
        if (key === 'value') {
          lens.value = value;
          return true;
        }
        return false;
      },
    });
  return make(
    () => target,
    () => {
      throw new TypeError('fields 的根不能整体替换');
    },
  );
}

// ---- 组件可绑定的 prop：一次归一化，组件内部永远拿到壳，不用看父级传了什么 ----
/** 调用方可以传值（只给初值 / 受控）或壳（双向）；不传时组件自己持有 */
export type Model<T> = T | Ref<T>;
/**
 * 传了壳：直接用它，读写都到父级。
 * 传了值：值变了跟上；组件写入时先通知 onChange；有 onChange 又没采纳就退回父级的值（受控）；没有 onChange 就留在本地。
 */
export function model<T>(props: any, key: string, fallback: T, onChange = `on${key[0]!.toUpperCase()}${key.slice(1)}Change`): Ref<T> {
  const first = untrack(() => props[key]);
  if (isRef(first)) return first as Ref<T>;
  // 方案五：父级传的是能写回的变量，prop 上就有 setter
  const set = setterOf(props, key);
  if (set) {
    return writable(() => {
      const value = props[key];
      return value === undefined ? fallback : value;
    }, set);
  }
  const local = signal(first !== undefined ? first : fallback);
  renderEffect(() => {
    const incoming = props[key];
    if (incoming !== undefined) local.value = incoming;
  });
  return writable(
    () => local.value,
    (next) => {
      local.value = next;
      const handler = untrack(() => props[onChange]);
      if (!handler) return;
      handler(next);
      queueMicrotask(() => {
        const incoming = untrack(() => props[key]);
        if (incoming !== undefined && incoming !== untrack(() => local.value)) local.value = incoming;
      });
    },
  ) as Ref<T>;
}

// ---- 原生元素：传壳就双向，传值就单向。编译器只在 value、checked 这几个键上调它 ----
export function twoWay(el: any, key: string, value: unknown): void {
  const read = isRef(value) ? () => value.value : typeof value === 'function' && (value as any)[IS_REF] ? (value as () => unknown) : undefined;
  if (read) {
    const write = isRef(value) ? (next: unknown) => (value.value = next) : (next: unknown) => (value as any).set(next);
    // 壳没采纳这次写入时值没变，effect 不会重跑，原生元素就和状态对不上了：写完对齐一次（同 React 的受控输入）。
    // 文本框不在输入途中对齐，否则“a ”经过去空格之后打不出空格，换算的小数也会跳；提交（change）时再对齐
    const align = () => {
      const current = untrack(read);
      if (key === 'checked') el.checked = !!current;
      else if (el.value !== String(current ?? '') && Number(el.value) !== current) el.value = current ?? '';
    };
    bindInput(el, key, read, (next: unknown) => {
      write(next);
      if (key === 'checked') queueMicrotask(align);
    }, []);
    if (key === 'value') el.addEventListener('change', align);
    return;
  }
  if (key === 'value') attrValue(el, value);
  else if (key === 'checked') attrState(el, key, value);
  else attrBool(el, key, value);
}

// ---- schema：同一份声明给运行时（默认值、rest 的键、可绑定的键）和类型（调用方的输入、组件内部的形状）----
// 同 easy-query 的 entity：Row 和 Insert 从一份 col 定义推出来，这里是 Inner 和 Input
export interface PropDef<In, Out, Optional extends boolean> {
  readonly kind: 'prop' | 'model' | 'content';
  readonly fallback?: unknown;
  /** 只存在于类型层：调用方给什么、组件读到什么。写成函数才能原样推回来，可选属性会混进 undefined */
  readonly _types?: () => [In, Out, Optional];
}
export function prop<T>(): PropDef<T, T | undefined, true>;
export function prop<const T>(fallback: T): PropDef<T extends boolean ? boolean : T extends string ? string : T extends number ? number : T, T extends boolean ? boolean : T extends string ? string : T extends number ? number : T, true>;
export function prop(fallback?: unknown): PropDef<any, any, true> {
  return { kind: 'prop', fallback };
}
/** 取值范围由泛型定：prop.of<'sm' | 'md'>('md') */
prop.of = <T>(fallback: T): PropDef<T, T, true> => ({ kind: 'prop', fallback });
prop.required = <T>(): PropDef<T, T, false> => ({ kind: 'prop' });
export const bound = <T>(fallback: T): PropDef<Model<T>, Ref<T>, true> => ({ kind: 'model', fallback });
type Schema = Readonly<Record<string, PropDef<any, any, boolean>>>;
type InOf<D> = D extends PropDef<infer In, any, any> ? In : never;
type OutOf<D> = D extends PropDef<any, infer Out, any> ? Out : never;
type OptionalKeys<S extends Schema> = { [K in keyof S]: S[K] extends PropDef<any, any, true> ? K : never }[keyof S];
/** 组件内部读到的形状 */
export type Inner<S extends Schema> = { readonly [K in keyof S]: OutOf<S[K]> };
/** 调用方写的形状：有默认值的可省略 */
export type Input<S extends Schema> = { [K in Exclude<keyof S, OptionalKeys<S>>]: InOf<S[K]> } & { [K in OptionalKeys<S>]?: InOf<S[K]> };

/** 定义组件。默认值、rest 的键都来自 schema，函数体拿到 (props, rest)，不需要解构改写 */
export function component<const S extends Schema, Extra = {}>(schema: S, setup: (props: Inner<S>, rest: any) => unknown) {
  const keys = new Set<string>();
  for (const key of Object.keys(schema)) {
    keys.add(key);
    if (schema[key]!.kind === 'model') keys.add(`on${key[0]!.toUpperCase()}${key.slice(1)}Change`);
  }
  // 普通 prop 的读取放原型上，一个组件一份，不随实例增长
  class View {
    constructor(public readonly $raw: any) {}
  }
  const modelKeys: string[] = [];
  for (const key of Object.keys(schema)) {
    const def = schema[key]!;
    if (def.kind === 'model') {
      modelKeys.push(key);
      continue;
    }
    const fallback = def.fallback;
    Object.defineProperty(View.prototype, key, {
      get(this: View) {
        const value = this.$raw[key];
        return value === undefined ? fallback : value;
      },
    });
  }
  return ((raw: any) => {
    const view: any = new View(raw);
    for (const key of modelKeys) view[key] = model(raw, key, schema[key]!.fallback);
    return setup(view, omit(raw, keys));
  }) as unknown as (props: Input<S> & Extra & { [other: string]: unknown }) => JSX.Element;
}
export { spread, onCleanup, propsView };

// ---- 函数形态的信号（Angular 的写法）：count() 读，count.set(1) 写 ----
export interface Signal<T> extends ReadSignal<T> {
  set(value: T): void;
  update(change: (value: T) => T): void;
  readonly [WRITE]: (value: T) => void;
}
export interface ReadSignal<T> {
  (): T;
}
export function sig<T>(initial: T): Signal<T> {
  const cell = signal(initial);
  const read = (() => cell.value) as any;
  read.set = (next: T) => (cell.value = next);
  read.update = (change: (value: T) => T) => (cell.value = change(untrack(() => cell.value)));
  read[IS_REF] = true;
  return read;
}
export const derived = <T>(read: () => T): ReadSignal<T> => {
  const cell = rawComputed(read);
  return () => cell.value;
};
/** 函数形态的 model */
export function sigModel<T>(props: any, key: string, fallback: T): Signal<T> {
  const first = untrack(() => props[key]);
  if (typeof first === 'function' && first[IS_REF]) return first;
  const inner = model<T>(props, key, fallback);
  const read = (() => inner.value) as any;
  read.set = (next: T) => (inner.value = next);
  read.update = (change: (value: T) => T) => (inner.value = change(untrack(() => inner.value)));
  read[IS_REF] = true;
  return read;
}
/** 深代理的对象状态 */
export const state = rawState;
