// 实验：不要编译插件。标准 TS JSX（jsxImportSource）产出描述对象，运行时建 DOM；响应式全靠函数：
//   传函数（sig 或箭头函数）= 活的；传值 = 只取这一次。可写靠 Sig 的方法，类型上看得见。
// 内核、属性写入、规则表直接用合并版运行时，这里只有“描述对象 → DOM / 字符串”这一层。
import {
  computed as rawComputed, createContext, devHooks, dispose, flushSync, getContext, getOwner, inject, onCleanup, onError, provide, provideValue, renderEffect, runSetup, runWith, scope, setBoundary, signal, untrack, userEffect, warnings, withContext,
} from '@hilt/reactive';
import { attrValue, bindInput, setAttr, setHydrating, setSx, spread, hydrating } from '@hilt/attrs';
import { LATE, TABLE, config, eventOf, isEventKey, merge as rulesMerge } from '@hilt/rules';
import { raw, snapshot, state as deepState } from '@hilt/state';

export { createContext, flushSync, inject, onCleanup, onError, provide, raw, snapshot, untrack, warnings };

// ---- 壳 ----
import type { Child } from './jsx-runtime';
export type { Child };
declare const WRITE: unique symbol;
export type ReadSig<T> = () => T;
/** 只读来源：普通函数、derived。Sig 不算，否则 Sig<string> 能混进 Model<string | null> */
export type ReadOnly<T> = (() => T) & { set?: undefined };
export interface Sig<T> {
  (): T;
  peek(): T;
  set(value: T): void;
  update(change: (value: T) => T): void;
  /** 写入端逆变，读取端协变，合起来不变 */
  readonly [WRITE]: (value: T) => void;
  inc(this: Sig<number>, by?: number): void;
  dec(this: Sig<number>, by?: number): void;
  toggle(this: Sig<boolean>): void;
  trim(this: Sig<string>): Sig<string>;
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

const proto: any = Object.create(Function.prototype);
const methods: Record<string, (...args: any[]) => unknown> = {
  peek(this: any) {
    return untrack(this);
  },
  set(this: any, value: unknown) {
    this.$.value = this.$raw ? value : deepState(value);
  },
  update(this: any, change: (value: unknown) => unknown) {
    const next = change(untrack(this));
    this.$.value = this.$raw ? next : deepState(next);
  },
  inc(this: any, by = 1) {
    this.$.value = untrack<any>(this) + by;
  },
  dec(this: any, by = 1) {
    this.$.value = untrack<any>(this) - by;
  },
  toggle(this: any) {
    this.$.value = !untrack(this);
  },
  trim(this: any) {
    const source = this;
    return make(new Lens(() => source(), (next: string) => source.set(next.trim())));
  },
  has(this: any, item: unknown) {
    const source = this;
    return make(
      new Lens(
        () => source().includes(item),
        (on: boolean) => source.set(on ? [...untrack<any>(source), item] : (untrack(source) as unknown[]).filter((other) => other !== item)),
      ),
    );
  },
  at(this: any, path: (value: unknown) => unknown) {
    const keys = recordPath(path);
    return keys.length ? fieldOf(this, keys) : this;
  },
  fields(this: any) {
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
      if (typeof key === 'symbol') throw new TypeError('at 只能写字段路径，比如 (f) => f.address.city');
      keys.push(key);
      return recorder;
    },
    apply() {
      throw new TypeError('at 只能写字段路径，不能调用方法');
    },
  });
  if (path(recorder) !== recorder) throw new TypeError('at 只能写字段路径，比如 (f) => f.address.city');
  return keys;
}
function fieldOf(source: any, keys: string[]) {
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
        if (source.$raw) throw new TypeError('sig.raw 不代理，字段改了也不会更新：要用 set 整体替换');
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
class Lens {
  constructor(
    private readonly read: () => any,
    private readonly write: (value: any) => void,
  ) {}
  get value() {
    return this.read();
  }
  set value(next) {
    this.write(next);
  }
}
function make(cell: any): any {
  const read: any = () => cell.value;
  read.$ = cell;
  devHooks?.shell(read, cell);
  Object.setPrototypeOf(read, proto);
  return read;
}
export const isSig = (value: unknown): value is Sig<unknown> => typeof value === 'function' && (value as any).$ !== undefined;
export const sig: SigFactory = Object.assign(<T>(initial: T): Sig<T> => make(signal(deepState(initial))), {
  raw<T>(initial: T): Sig<T> {
    const shell = make(signal(initial));
    shell.$raw = true;
    return shell;
  },
});
export function derived<T>(read: () => T): ReadOnly<T>;
export function derived<T>(read: () => T, write: (value: T) => void): Sig<T>;
export function derived(read: () => any, write?: (value: any) => void): any {
  if (write) return make(new Lens(read, write));
  const cell = rawComputed(read);
  devHooks?.named(cell, 'derived');
  return () => cell.value;
}
let serverMode = false;
export const setServerMode = (value: boolean) => (serverMode = value);
/** 挂载之后才第一次执行；服务端不执行 */
export const effect = (fn: () => void | (() => void)): void => {
  if (!serverMode) userEffect(fn);
};
/** 读 Prop：值原样，函数调用 */
export const read = <T>(value: Prop<T>): T => (typeof value === 'function' ? (value as ReadSig<T>)() : value);

/** 一次归一化：组件内部永远拿到 Sig。传 Sig 就是它本身；传值或只读函数：跟着变，写入留在本地，有 onChange 又没采纳就退回 */
export function model<T>(source: Model<T> | undefined, fallback: T, onChange?: (value: T) => void): Sig<T> {
  if (isSig(source)) return source as Sig<T>;
  const current = () => (typeof source === 'function' ? (source as ReadSig<T>)() : source);
  const first = untrack(current);
  const local = signal(deepState(first !== undefined ? first : fallback));
  devHooks?.named(local, 'model');
  if (typeof source === 'function') {
    // 来源变回 undefined 就回到默认值：Model<string | undefined> 里 undefined 也是合法的值
    renderEffect(() => {
      const incoming = current();
      local.value = deepState(incoming !== undefined ? incoming : fallback);
    });
  }
  return make(
    new Lens(
      () => local.value,
      (next: T) => {
        local.value = deepState(next);
        if (!onChange) return;
        onChange(next);
        queueMicrotask(() => {
          const incoming = untrack(current);
          if (incoming !== undefined && incoming !== untrack(() => local.value)) local.value = incoming;
        });
      },
    ),
  );
}

// ---- 属性合并：显式方法。对象展开只会覆盖，class 拼接、事件都执行这些要靠它 ----
const isEventName = (key: string) => isEventKey(key);
type Intersect<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Tail] ? Head & Intersect<Tail> : unknown;
export function merge<const T extends readonly (object | null | undefined | false)[]>(...sources: T): Intersect<{ [K in keyof T]: Exclude<T[K], null | undefined | false> }>;
export function merge(...sources: any[]): any {
  const out: any = {};
  for (const source of sources) {
    if (!source) continue;
    // 动态键层跟着合并走：组件转发 rest 时不能丢
    for (const symbol of Object.getOwnPropertySymbols(source)) out[symbol] = source[symbol];
    for (const key of Object.keys(source)) {
      const value = source[key];
      if (value === undefined) continue;
      const previous = out[key];
      if (previous === undefined) out[key] = value;
      else if (key === 'class') out.class = [previous, value];
      else if (key === 'sx') out.sx = [previous, value];
      // 保留各层，落到元素上时由规则表按属性合并：字符串切分、大小写、undefined 落回都只有一份实现
      else if (key === 'style') out.style = [previous, value];
      else if (key === 'ref') out.ref = (el: unknown) => (applyRef(previous, el), applyRef(value, el));
      else if (isEventName(key)) {
        // 靠后的先执行，preventDefault 之后下层跳过
        out[key] = (event: Event) => {
          value(event);
          if (!event.defaultPrevented) previous(event);
        };
      } else if (typeof value === 'function' && !isSig(value)) {
        out[key] = () => {
          const top = value();
          return top === undefined ? read(previous) : top;
        };
      } else out[key] = value;
    }
  }
  devHooks?.merged(out);
  return out;
}
const applyRef = (ref: any, el: unknown) => (isSig(ref) ? ref.set(el) : ref?.(el));

// ---- 描述对象 ----
export class VNode {
  constructor(
    readonly type: any,
    readonly props: any,
  ) {}
}
/** 不是元素、不是组件，自己决定怎么渲染（列表） */
export class Custom {
  constructor(
    readonly dom: (parent: Node, before: Node | null, svg: boolean) => void,
    readonly html: (toHtml: (value: unknown) => string) => string,
  ) {}
}
export const createElement = (type: any, props: any): VNode => new VNode(type, props ?? {});

// ---- 水合游标 ----
let cursor: Node | null = null;
const isMark = (node: Node | null, data: string) => node?.nodeType === 8 && (node as Comment).data === data;
function closeOf(open: Node): Node {
  let depth = 0;
  for (let node = open.nextSibling; node; node = node.nextSibling) {
    if (isMark(node, '[')) depth++;
    else if (isMark(node, ']') && depth-- === 0) return node;
  }
  throw new Error('水合：动态段没有结束标记');
}

// ---- 属性 ----
const TWO_WAY = new Set(['value', 'checked']);
const isFormTag = (tag: string) => tag === 'input' || tag === 'textarea' || tag === 'select';
const hyphenate = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, '');
let prepareSx: (value: unknown) => unknown = (value) => value;
/** 样式模块登记：把 sx 里的函数换成引擎认识的绑定 */
let onHydrate = () => {};
/** 样式入口（hilt/css）登记自己：不用样式时这边不引用引擎，摇得掉 */
export const registerStyles = (hooks: { prepare: (value: unknown) => unknown; onHydrate: () => void }) => {
  prepareSx = hooks.prepare;
  onHydrate = hooks.onHydrate;
};

function twoWay(el: any, key: string, shell: Sig<any>) {
  const align = () => {
    const current = untrack(shell);
    if (key === 'checked') el.checked = !!current;
    else if (el.value !== String(current ?? '') && Number(el.value) !== current) el.value = current ?? '';
  };
  bindInput(el, key, shell, (next: unknown) => {
    shell.set(next);
    if (key === 'checked') queueMicrotask(align);
  }, []);
  if (key === 'value') el.addEventListener('change', align);
  // 选项后来才出现或被换掉时，选中项要按壳重新对齐
  if (key === 'value' && el.localName === 'select') renderEffect(() => attrValue(el, shell()));
}
const hasFunction = (value: unknown): boolean => {
  if (typeof value === 'function') return true;
  if (Array.isArray(value)) return value.some(hasFunction);
  if (value && typeof value === 'object') return Object.values(value).some(hasFunction);
  return false;
};
/** class、style 里嵌的函数：读出来再交给属性规则 */
export const settle = (value: unknown): unknown => {
  if (typeof value === 'function') return settle(value());
  if (Array.isArray(value)) return value.map(settle);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, settle(item)]));
  return value;
};
function applyProp(el: any, key: string, value: any, tag: string) {
  if (key === 'children' || key === 'key' || value === undefined) return;
  if (key === 'ref') {
    if (isSig(value)) {
      value.set(el);
      onCleanup(() => value.set(null));
    } else {
      value(el);
      onCleanup(() => value(null));
    }
    return;
  }
  if (isEventKey(key)) {
    const info = eventOf(key);
    const type = info.exact ?? (tag.includes('-') && !(info.idl in el) ? hyphenate(info.name) : info.lower);
    el.addEventListener(type, value, info.options);
    return;
  }
  if (key === 'sx') {
    setSx(el, prepareSx(value));
    return;
  }
  if ((key === 'class' || key === 'style') && hasFunction(value)) {
    devHooks?.label('attr', el, key);
    renderEffect(() => setAttr(el, key, settle(value)));
    return;
  }
  if (typeof value === 'function') {
    devHooks?.label(isSig(value) && TWO_WAY.has(key) && isFormTag(tag) ? 'model' : 'attr', el, key);
    if (isSig(value) && TWO_WAY.has(key) && isFormTag(tag)) twoWay(el, key, value);
    else renderEffect(() => setAttr(el, key, value()));
    return;
  }
  setAttr(el, key, value);
}
/** 动态键层：把写法换成运行时分层能认的形状。函数值在元素的 effect 里读，所以响应式还在 */
function toLayer(props: any): any {
  const layer: any = {};
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === 'children' || key === 'key' || value === undefined) continue;
    if (key === 'sx') layer.sx = prepareSx(value);
    else if (key === 'ref') layer.ref = isSig(value) ? (el: unknown) => value.set(el) : value;
    else if (isEventKey(key)) layer[key] = value;
    else if ((key === 'class' || key === 'style') && hasFunction(value)) Object.defineProperty(layer, key, { enumerable: true, get: () => settle(value) });
    else if (typeof value === 'function') Object.defineProperty(layer, key, { enumerable: true, get: value });
    else layer[key] = value;
  }
  return layer;
}
export const dynamicSources = (props: any): (() => object | null | undefined)[] | undefined => {
  const symbols = Object.getOwnPropertySymbols(props);
  if (!symbols.length) return undefined;
  const found = symbols.map((symbol) => props[symbol]).filter((value) => value?.$$dynamic);
  return found.length ? found : undefined;
};
function applyDynamic(el: any, props: any, sources: (() => object | null | undefined)[], tag: string) {
  // 传 Sig 的双向绑定不进分层，单独接
  const own: any = {};
  for (const key of Object.keys(props)) {
    if (isSig(props[key]) && TWO_WAY.has(key) && isFormTag(tag)) applyProp(el, key, props[key], tag);
    else own[key] = props[key];
  }
  const layers = sources.map((source) => () => {
    const value = source();
    return value ? toLayer(value) : value;
  });
  spread(el, rulesMerge(toLayer(own), ...layers));
}
function applyProps(el: any, props: any, tag: string) {
  const sources = dynamicSources(props);
  if (sources) return applyDynamic(el, props, sources, tag);
  let later: string[] | undefined;
  for (const key in props) {
    const kind = TABLE[key];
    if (typeof kind === 'number' && kind & LATE) (later ??= []).push(key);
    else applyProp(el, key, props[key], tag);
  }
  if (later) for (const key of later) applyProp(el, key, props[key], tag);
}

// ---- 渲染到 DOM（新建或水合共用一条路）----
const SVG = 'http://www.w3.org/2000/svg';
function renderElement(node: VNode, parent: Node, before: Node | null, svg: boolean) {
  const tag = node.type as string;
  const inSvg = (svg || tag === 'svg') && tag !== 'foreignObject';
  let el: any;
  if (hydrating) {
    el = cursor;
    if (devHooks && el?.localName !== tag) devHooks.mismatch(tag, el);
    cursor = el.nextSibling;
  } else {
    el = inSvg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  }
  const { props } = node;
  devHooks?.element(el, node);
  const children = props.children;
  if (children !== undefined) {
    // 唯一的子节点是文字：一次 textContent，不用建文本节点再插入
    if (!hydrating && (typeof children === 'string' || typeof children === 'number')) el.textContent = children;
    else if (hydrating) {
      const resume = cursor;
      cursor = el.firstChild;
      renderValue(children, el, null, inSvg);
      cursor = resume;
    } else {
      renderValue(children, el, null, inSvg);
    }
  }
  // 子节点先于属性：select 的 value 要 option 在
  applyProps(el, props, tag);
  if (!hydrating) parent.insertBefore(el, before);
}
function renderComponent(node: VNode, parent: Node, before: Node | null, svg: boolean) {
  if (devHooks) devHooks.component(node, () => mountComponent(node, parent, before, svg));
  else mountComponent(node, parent, before, svg);
}
function mountComponent(node: VNode, parent: Node, before: Node | null, svg: boolean) {
  const record = node.type.$$hot;
  if (record) {
    // 开发期：每个实例单独一段，改了组件只重建这一段
    renderRegion(
      () => {
        void record.version.value;
        return new Custom(
          (p, b, s) => void runSetup((props: unknown) => renderValue(record.current(props), p, b, s), node.props),
          () => '',
        );
      },
      parent,
      before,
      svg,
    );
    return;
  }
  // 在组件体的作用域里渲染结果：provide 出来的 context 对内容有效，组件直接返回 children 也一样
  runSetup((props: unknown) => renderValue(node.type(props), parent, before, svg), node.props);
}
function renderRegion(source: () => unknown, parent: Node, before: Node | null, svg: boolean) {
  let start: Node | undefined;
  let end: Node | undefined;
  let adopting = hydrating;
  if (adopting) {
    start = cursor!;
    end = closeOf(start);
  }
  const saved = getContext();
  let text: Text | undefined;
  let rangeText: Text | undefined;
  const openRange = (target: Node, at: Node | null) => {
    start = document.createComment('[');
    end = document.createComment(']');
    target.insertBefore(start, at);
    target.insertBefore(end, at);
  };
  devHooks?.label('region', parent);
  renderEffect(() => {
    let value = withContext(saved, source);
    while (typeof value === 'function') value = withContext(saved, value as () => unknown);
    if (!start) {
      const primitive = typeof value === 'string' || typeof value === 'number';
      if (text) {
        if (primitive) {
          text.data = String(value);
          return;
        }
        // 文字变成别的内容：这时才放起止标记，把文字节点换掉
        const host = text.parentNode!;
        openRange(host, text);
        host.removeChild(text);
        text = undefined;
      } else if (primitive && parent.nodeType === 1) {
        // 绝大多数动态段只是一段文字：一个文本节点就够了，不放标记。列表行的片段里要放，行靠它们记范围
        text = document.createTextNode(String(value));
        parent.insertBefore(text, before);
        return;
      } else {
        openRange(parent, before);
      }
    }
    const target = end!.parentNode!;
    if (adopting) {
      adopting = false;
      cursor = start!.nextSibling;
      untrack(() => withContext(saved, () => renderValue(value, target, end!, svg)));
      cursor = end!.nextSibling;
      const only = start!.nextSibling;
      if (only !== end && only!.nextSibling === end && only!.nodeType === 3) rangeText = only as Text;
      return;
    }
    if (rangeText && (typeof value === 'string' || typeof value === 'number')) {
      rangeText.data = String(value);
      return;
    }
    rangeText = undefined;
    for (let node = start!.nextSibling; node !== end; node = start!.nextSibling) target.removeChild(node!);
    untrack(() => withContext(saved, () => renderValue(value, target, end!, svg)));
    if (typeof value === 'string' || typeof value === 'number') rangeText = start!.nextSibling as Text;
  });
}
export function renderValue(value: unknown, parent: Node, before: Node | null, svg = false): void {
  if (value == null || value === true || value === false) return;
  if (Array.isArray(value)) {
    for (const item of value) renderValue(item, parent, before, svg);
    return;
  }
  if (typeof value === 'function') return renderRegion(value as () => unknown, parent, before, svg);
  if (value instanceof VNode) return typeof value.type === 'function' ? renderComponent(value, parent, before, svg) : renderElement(value, parent, before, svg);
  if (value instanceof Custom) return value.dom(parent, before, svg);
  if (typeof Node !== 'undefined' && value instanceof Node) {
    parent.insertBefore(value, before);
    return;
  }
  const textValue = String(value);
  if (hydrating) {
    if (devHooks && textValue !== '' && cursor?.nodeType === 3 && (cursor as Text).data !== textValue) devHooks.mismatch(textValue, cursor);
    if (isMark(cursor, '')) cursor = cursor!.nextSibling;
    if (textValue !== '' && cursor?.nodeType === 3) cursor = cursor.nextSibling;
    return;
  }
  parent.insertBefore(document.createTextNode(textValue), before);
}

// ---- 列表 ----
function longestIncreasing(values: number[]) {
  const tails: number[] = [];
  const previous = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    if (values[i]! < 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < values[i]!) low = middle + 1;
      else high = middle;
    }
    previous[i] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = previous[i]!) keep.add(i);
  return keep;
}
/** 同键出现多次（没给 by 时重复的值）：后面的各算一行，不能互相覆盖 */
const duplicateKeys = new Map<unknown, object[]>();
function rowKey(key: unknown, seen: Map<unknown, number>): unknown {
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  if (!count) return key;
  let list = duplicateKeys.get(key);
  if (!list) duplicateKeys.set(key, (list = []));
  return (list[count - 1] ??= {});
}
function rowNodes(row: { first: Node; last: Node }): Node[] {
  const nodes: Node[] = [];
  for (let node: Node | null = row.first; node; node = node === row.last ? null : node.nextSibling) nodes.push(node);
  return nodes;
}
interface ListProps<T> {
  each: Prop<readonly T[]>;
  children: (item: T, index: ReadSig<number>) => unknown;
}
interface KeyedProps<T> {
  each: Prop<readonly T[]>;
  /** 标准 JSX 把 key 拿走给框架用，到不了 props，所以这里叫 by */
  by: (item: T) => unknown;
  children: (item: ReadSig<T>, index: ReadSig<number>) => unknown;
}
/** 列表：没给 by 按身份复用，item 是值；给了 by 同键复用，item 和下标都是读取函数 */
export function For<T>(props: KeyedProps<T>): unknown;
export function For<T>(props: ListProps<T>): unknown;
export function For(props: any): unknown {
  const keyOf = props.by;
  const render = props.children;
  return new Custom(
    (parent, before, svg) => {
      let start: Node;
      let end: Node;
      const adopting = hydrating;
      if (adopting) {
        start = cursor!;
        end = closeOf(start);
      } else {
        start = document.createComment('[');
        end = document.createComment(']');
        parent.insertBefore(start, before);
        parent.insertBefore(end, before);
      }
      let rows = new Map<unknown, any>();
      let order: any[] = [];
      const owner = getOwner();
      const saved = getContext();
      let first = adopting;
      const createRow = (item: unknown, index: number, target: Node, anchor: Node) => {
        const row: any = { first: undefined, last: undefined, scope: undefined, item: keyOf ? signal(item) : undefined, index: signal(index) };
        // 行函数在行的作用域里执行，当组件体对待：onCleanup、effect 属于这一行，直接读 count() 也有开发期提示
        const renderRow = (host: Node, at: Node | null) =>
          runSetup(() => renderValue(render(keyOf ? () => row.item.value : item, () => row.index.value), host, at, svg), undefined);
        // 行记首尾两个节点：行内的动态段会增减节点，但有自己的起止标记，范围不变
        if (first) {
          const from = cursor;
          row.scope = runWith(owner, saved, () => scope(() => void renderRow(target, anchor)));
          // 行什么都没渲染：服务端放了一个空注释占位
          if (cursor === from && isMark(cursor, '')) cursor = cursor!.nextSibling;
          row.first = from;
          row.last = cursor!.previousSibling;
        } else {
          const previous = anchor.previousSibling;
          row.scope = runWith(owner, saved, () => scope(() => void renderRow(target, anchor)));
          if (anchor.previousSibling === previous) target.insertBefore(document.createComment(''), anchor);
          row.first = previous ? previous.nextSibling : target.firstChild;
          row.last = anchor.previousSibling;
        }
        return row;
      };
      devHooks?.label('list', parent);
      renderEffect(() => {
        const items: readonly unknown[] = [...read<readonly unknown[]>(props.each)];
        untrack(() => {
          const target = end.parentNode!;
          if (first) {
            cursor = start.nextSibling;
            const seen = new Map<unknown, number>();
            items.forEach((item, index) => rows.set(rowKey(keyOf ? keyOf(item) : item, seen), createRow(item, index, target, end)));
            order = [...rows.values()];
            first = false;
            cursor = end.nextSibling;
            return;
          }
          let reused = 0;
          const next = new Map<unknown, any>();
          const seen = new Map<unknown, number>();
          items.forEach((item, index) => {
            const key = rowKey(keyOf ? keyOf(item) : item, seen);
            let row = rows.get(key);
            if (row) {
              reused++;
              rows.delete(key);
              row.index.value = index;
              if (row.item) row.item.value = item;
            } else {
              row = createRow(item, index, target, end);
            }
            next.set(key, row);
          });
          for (const row of rows.values()) {
            for (const node of rowNodes(row)) target.removeChild(node);
            dispose(row.scope);
          }
          // 新行已经按顺序插在 end 前面。一行都没复用（首次建、整体替换）就不用算移动，否则每行都要再插一遍
          if (!reused) {
            order = [...next.values()];
            rows = next;
            return;
          }
          const before2 = new Map<any, number>();
          order.forEach((row, index) => before2.set(row, index));
          const list = [...next.values()];
          const keep = longestIncreasing(list.map((row) => before2.get(row) ?? -1));
          let anchor: Node = end;
          for (let i = list.length - 1; i >= 0; i--) {
            const row = list[i];
            if (!keep.has(i)) for (const node of rowNodes(row)) target.insertBefore(node, anchor);
            anchor = row.first;
          }
          order = list;
          rows = next;
        });
      });
      if (adopting && first) cursor = end.nextSibling;
    },
    (toHtml) => {
      const items: readonly unknown[] = read<readonly unknown[]>(props.each);
      let out = '';
      let lastWasText = false;
      items.forEach((item, index) => {
        const position = () => index;
        const value = render(keyOf ? () => item : item, position);
        const html = toHtml(value);
        const isText = typeof value === 'string' || typeof value === 'number';
        // 相邻行的文字解析时会合成一个节点，空行也要占位，否则水合认领不出每一行
        if (html === '' || (isText && lastWasText)) out += '<!---->';
        out += html;
        lastWasText = isText && html !== '';
      });
      return `<!--[-->${out}<!--]-->`;
    },
  );
}

/**
 * 条件：真假不变时分支不重建。判空后类型收窄：u 是非空的读取函数。
 * 普通的 () => on() ? <A /> : <B /> 也能用，只是依赖一变分支就重建。
 */
export function when<T>(source: Prop<T>, then: (value: ReadSig<NonNullable<T>>) => Child, otherwise?: () => Child): () => Child {
  const truthy = rawComputed(() => !!read(source));
  return () => (truthy.value ? then(() => read(source) as NonNullable<T>) : otherwise?.());
}

// ---- 错误边界、传送、懒加载、服务、动态键 ----
const VNodeOf = (type: any, props: any) => new VNode(type, props);
/**
 * 错误边界：子树渲染或更新时抛错，显示 fallback(错误, 重试)。
 * 边界就是一段动态内容：出错时这一段重跑，换成 fallback；重试时再换回来，children 是描述对象，可以再建一次
 */
export function Boundary(props: { fallback: (error: Error, retry: () => void) => Child; children?: Child }): unknown {
  return new Custom(
    (parent, before, svg) => {
      const failure = signal<{ error: Error } | undefined>(undefined);
      renderRegion(
        () => {
          const current = failure.value;
          if (current) return untrack(() => props.fallback(current.error, () => (failure.value = undefined)));
          setBoundary(getOwner(), (error: Error) => (failure.value = { error }));
          return props.children;
        },
        parent,
        before,
        svg,
      );
    },
    (toHtml) => {
      let inner: string;
      try {
        inner = toHtml(props.children);
      } catch (error) {
        inner = toHtml(props.fallback(error as Error, () => {}));
      }
      return `<!--[-->${inner}<!--]-->`;
    },
  );
}
/** 传送：内容渲染到别的容器，context 和销毁都跟着所在位置。服务端不输出，挂载之后才创建，所以不参与水合 */
export function Portal(props: { to?: Prop<Element | undefined>; children?: Child }): unknown {
  return new Custom(
    () => {
      effect(() => {
        const target: Element = read(props.to) ?? document.body;
        const start = document.createComment('[');
        const end = document.createComment(']');
        target.append(start, end);
        untrack(() => renderValue(props.children, target, end));
        return () => {
          for (let node = start.nextSibling; node !== end; node = start.nextSibling) target.removeChild(node!);
          target.removeChild(start);
          target.removeChild(end);
        };
      });
    },
    () => '',
  );
}
const APP = Symbol('app');
/** 服务：第一次 use 时才创建，整个应用（或 provide 的那棵子树）一份，effect 跟着应用走；服务端按请求隔离 */
export function createService<T>(factory: () => T) {
  const id = Symbol('service');
  return {
    use(): T {
      const context = getContext() as any;
      if (context[id] !== undefined) return context[id];
      const app = context[APP];
      if (!app) throw new Error('服务只能在组件或其他服务里使用');
      if (!app.services.has(id)) app.services.set(id, runWith(app.node, app.context, () => runSetup(factory, undefined)));
      return app.services.get(id);
    },
    /** 这棵子树用自己的一份；传了值就用传的（测试替身） */
    provide(value?: T): T {
      const instance = value !== undefined ? value : (runSetup(factory, undefined) as T);
      provideValue(id, instance);
      return instance;
    },
  };
}
const lazyEntries: (() => Promise<unknown>)[] = [];
export const preloadLazy = () => Promise.all(lazyEntries.map((entry) => entry()));
const REPLAYED = ['pointerdown', 'pointerup', 'click', 'focusin', 'input', 'keydown'];
/** 懒加载：代码第一次要渲染时才加载；服务端渲染过的内容可以推迟接管，推迟期间不建 effect */
export function lazy<P>(load: () => Promise<{ default: (props: P) => unknown }>, options: { hydrate?: 'load' | 'visible' | 'idle' | 'interaction' } = {}) {
  let loaded: ((props: P) => unknown) | undefined;
  let pending: Promise<unknown> | undefined;
  const fetchModule = () =>
    (pending ??= load().then((module) => {
      loaded = module.default;
    }));
  lazyEntries.push(fetchModule);
  const Lazy = (props: P & { fallback?: Child }): unknown => {
    const ids = (getContext() as any)[IDS];
    if (ids) provideValue(IDS, { prefix: `${ids.prefix}${ids.next++}-`, next: 0 });
    return new Custom(
      (parent, before, svg) => {
        if (hydrating && !loaded) return deferHydration(props);
        if (loaded) return renderRegion(() => VNodeOf(loaded, props), parent, before, svg);
        const ready = signal(false);
        void fetchModule().then(() => (ready.value = true));
        renderRegion(() => (ready.value ? VNodeOf(loaded, props) : props.fallback), parent, before, svg);
      },
      (toHtml) => `<!--[-->${loaded ? toHtml(VNodeOf(loaded, props)) : toHtml(props.fallback)}<!--]-->`,
    );
  };
  function deferHydration(props: P) {
    const start = cursor!;
    const end = closeOf(start);
    cursor = end.nextSibling;
    const owner = getOwner();
    const saved = getContext();
    let disposed = false;
    let cancelTrigger = () => {};
    onCleanup(() => {
      disposed = true;
      cancelTrigger();
    });
    const adopt = (replay?: () => void) =>
      fetchModule().then(() => {
        if (disposed) return;
        setHydrating(true);
        cursor = start;
        try {
          runWith(owner, saved, () => renderRegion(() => VNodeOf(loaded, props), end.parentNode!, end, false));
        } finally {
          setHydrating(false);
          cursor = null;
        }
        flushSync();
        replay?.();
      });
    const strategy = options.hydrate ?? 'load';
    if (strategy === 'load') void adopt();
    else if (strategy === 'idle') {
      const id = typeof requestIdleCallback === 'function' ? requestIdleCallback(() => void adopt()) : (setTimeout(() => void adopt(), 200) as unknown as number);
      cancelTrigger = () => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id));
    } else {
      const elements: Element[] = [];
      for (let node = start.nextSibling; node !== end; node = node!.nextSibling) if (node!.nodeType === 1) elements.push(node as Element);
      if (strategy === 'visible') {
        const observer = new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          void adopt();
        });
        for (const element of elements) observer.observe(element);
        cancelTrigger = () => observer.disconnect();
      } else {
        // 第一个事件触发接管，加载期间的事件都排队，接管后按顺序重放
        const queue: Event[] = [];
        const cancel = () => {
          for (const element of elements) for (const type of REPLAYED) element.removeEventListener(type, onEvent, true);
        };
        function onEvent(event: Event) {
          event.stopImmediatePropagation();
          if (event.type === 'click') event.preventDefault();
          queue.push(event);
          if (queue.length > 1) return;
          void adopt(() => {
            cancel();
            for (const item of queue) item.target!.dispatchEvent(new (item.constructor as typeof Event)(item.type, item));
          });
        }
        for (const element of elements) for (const type of REPLAYED) element.addEventListener(type, onEvent, true);
        cancelTrigger = cancel;
      }
    }
  }
  return Object.assign(Lazy, { preload: fetchModule });
}
/**
 * 动态键：键集合本身会变时用。{...dynamic(() => (cond() ? a : b))}、{...dynamic(propsIcon)}；普通写法没有这个成本。
 * 和同一元素上写的属性分层：class 拼接，事件都执行，撤掉时只清它自己写的。每次调用一个键，同一元素可以有多个
 */
export const dynamic = (source: Prop<object | null | undefined>): object => {
  const read2: any = () => read(source);
  read2.$$dynamic = true;
  return { [Symbol('hilt.dynamic')]: read2 };
};

// ---- 开发期热更新：没有编译魔法，开发插件只在文件末尾登记导出的组件 ----
const hotRecords = new Map<string, { current: any; version: { value: number } }>();
/** 开发插件生成：hotRegister('文件#组件名', 组件)。第一次记下，之后换函数并让所有实例重建；上层和兄弟不动 */
export function hotRegister(id: string, fn: any): void {
  const existing = hotRecords.get(id);
  if (!existing) {
    const record = { current: fn, version: signal(0) };
    hotRecords.set(id, record);
    fn.$$hot = record;
    return;
  }
  existing.current = fn;
  fn.$$hot = existing;
  existing.version.value++;
}

// ---- 入口 ----
const IDS = Symbol('ids');
export function useId(): string {
  const ids = (getContext() as any)[IDS];
  return `${ids.prefix}${ids.next++}`;
}
export function inApp<T>(run: () => T): { node: unknown; result: T } {
  let result!: T;
  const node = runWith(undefined, Object.create(getContext()), () =>
    scope(() => {
      provideValue(IDS, { prefix: 'h', next: 0 });
      provideValue(APP, { services: new Map(), node: getOwner(), context: getContext() });
      result = run();
    }),
  );
  return { node, result };
}
export function mount(view: () => unknown, host: Element): () => void {
  const { node } = inApp(() => (devHooks ? devHooks.app(host, () => renderValue(view(), host, null)) : renderValue(view(), host, null)));
  flushSync();
  return () => dispose(node);
}
export function hydrate(view: () => unknown, host: Element): () => void {
  onHydrate();
  setHydrating(true);
  cursor = host.firstChild;
  try {
    const { node } = inApp(() => (devHooks ? devHooks.app(host, () => renderValue(view(), host, null)) : renderValue(view(), host, null)));
    return () => dispose(node);
  } finally {
    setHydrating(false);
    cursor = null;
    flushSync();
  }
}
export { renderToString } from './server';
void config;
