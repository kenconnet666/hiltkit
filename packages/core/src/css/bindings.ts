/**
 * 元素上的响应式绑定（bind、select 交给 attrs 之后）：元素挂上时起一个 effect，参数变化时只改元素上的
 * CSS 变量；选中的样式或动态样式的形状变了（多出、少了属性）时按换过的那组样式重新组合，就地换类。
 * 引擎不碰 DOM：类与变量的写入经运行时交来的 StyleHost（保证只动引擎自己的类和变量）。
 */
import { dispose, renderEffect, untrack } from '../reactivity/kernel';
import { compose } from './compose';
import { CLASS, EVALUATE, FRAGMENT, type Binding, type StylePart } from './fragment';

/** 运行时给引擎的写入口：一个元素上引擎自己的类与行内变量 */
export interface StyleHost {
  /** 换成这一组类（空格分隔）：只动引擎之前给过的，元素上别的类不碰 */
  setClass(next: string): void;
  /** 设一个行内变量 */
  setVar(name: string, value: string): void;
  /** 去掉一个行内变量 */
  removeVar(name: string): void;
}

/** 一次渲染里的一个绑定：渲染时读到的参数与算出的结果（effect 只管这些，同一元素上别的动态样式的变量不碰） */
export interface BindingEntry {
  binding: Binding;
  /** 这个绑定在 slots 里的位置（换类时替换这一位） */
  index: number;
  /** 渲染时读到的参数：effect 读到同样的就不再求值 */
  args: readonly unknown[];
  /** 渲染时算出、已经写进行内样式的变量 */
  inline: Readonly<Record<string, string>>;
}

export { untrack };

/** 引擎内部计数（测试与基准用：证明“没用到的部件不重算”） */
export const stats = { evaluations: 0, reshapes: 0, fragmentBuilds: 0, watchers: 0 };

/** 读绑定的参数（effect 借此收集依赖）；参数没变的不再求值，变了的只改元素上变了的变量 */
function apply(host: StyleHost, entries: BindingEntry[], slots: StylePart[][]) {
  let reshaped = false;
  for (const entry of entries) {
    const args = entry.binding.args();
    if (sameArgs(args, entry.args)) continue;
    stats.evaluations++;
    const { parts, inline } = entry.binding.style[EVALUATE](args);
    entry.args = args;
    if (!sameParts(parts, slots[entry.index]!)) {
      slots[entry.index] = parts as StylePart[];
      reshaped = true;
    }
    const previous = entry.inline;
    entry.inline = inline;
    for (const name in inline)
      if (previous[name] !== inline[name]) host.setVar(name, inline[name]!);
    for (const name in previous) {
      if (!(name in inline) && !ownedByOthers(entries, entry, name)) host.removeVar(name);
    }
  }
  if (reshaped) {
    stats.reshapes++;
    host.setClass(compose(slots.flat()).class ?? '');
  }
}

const sameParts = (a: readonly StylePart[], b: readonly StylePart[]) =>
  a.length === b.length && a.every((part, index) => part === b[index]);

/** 同一元素上别的绑定也写着这个变量（同一个动态样式绑了两次）：不删 */
const ownedByOthers = (entries: BindingEntry[], self: BindingEntry, name: string) =>
  entries.some((entry) => entry !== self && name in entry.inline);

/**
 * 参数没变：每一项相同，并且都是原始值或样式本身。对象参数（动态样式读它的属性）即使是同一个也要重新求值，
 * 读它属性的那些依赖是求值时收集的
 */
function sameArgs(next: readonly unknown[], previous: readonly unknown[]) {
  if (next.length !== previous.length) return false;
  for (let index = 0; index < next.length; index++) {
    const value = next[index];
    if (!Object.is(value, previous[index])) return false;
    if (typeof value === 'object' && value !== null && !(FRAGMENT in value) && !(CLASS in value))
      return false;
    if (typeof value === 'function') return false;
  }
  return true;
}

const NOOP = () => {};
/**
 * attrs 的 watch：元素创建后调用，起一个 effect 并返回停止函数（随所在的 owner 一起销毁）；读的全是常量时内核直接丢弃节点。
 * 第一次运行只为收集依赖：读到的参数与渲染时相同，就不再求值、不碰 DOM
 */
export function watchBindings(entries: BindingEntry[], slots: StylePart[][]) {
  return (host: StyleHost) => {
    const node = renderEffect(() => apply(host, entries, slots));
    if (!node) return NOOP;
    stats.watchers++;
    return () => dispose(node);
  };
}
