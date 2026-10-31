/**
 * 元素上的响应式绑定（css.bind、css.select 交给 attrs 之后）：元素挂上时起一个 effect，参数变化时只改元素上的
 * CSS 变量；选中的样式或动态样式的形状变了时就地换组合类。
 *
 * 细粒度框架版（alien-signals）：元素的 effect 本来就是更新单位，没有“组件重新渲染”，所以原来为 Vue 存在的
 * 这些都不需要了：按元素复用 effect 的 WeakMap、重新渲染时换读取函数（sameSources、stable）、
 * 排进 post 队列的调度（dirty、flush）、devtools 时间线。
 */
import { effect, setActiveSub } from 'alien-signals';
import { compose } from './compose';
import { CLASS, EVALUATE, FRAGMENT, type Binding, type StylePart } from './fragment';

/** 一次渲染里的一个绑定：渲染时读到的参数与算出的结果（effect 只管这些，同一元素上别的动态样式的变量不碰） */
export interface BindingEntry {
  /** 绑定本身：动态样式（或选择）与读参数的函数 */
  binding: Binding;
  /** 在这次 attrs 的样式里排第几（换类时替换这一段） */
  index: number;
  /** 渲染时读到的参数：effect 读到同样的就不再求值 */
  args: readonly unknown[];
  /** 渲染时算出、已经写进行内样式的变量 */
  inline: Readonly<Record<string, string>>;
}

/** 一个元素上的绑定状态：args、inline 随 effect 更新成元素上现在的 */
interface BoundElement {
  bindings: BindingEntry[];
  /** 这次 attrs 参与组合的全部样式（绑定的那几段随 effect 更新） */
  parts: StylePart[];
  /** 元素上现在由引擎给的类（组合类与主题、标记的类），空格分隔 */
  className: string;
}

/** 读取但不追踪：attrs 渲染时只取一次值算类名，参数变化交给元素上的 effect */
export function untrack<T>(read: () => T): T {
  const previous = setActiveSub(undefined);
  try {
    return read();
  } finally {
    setActiveSub(previous);
  }
}

/**
 * 读绑定的参数（effect 借此收集依赖）；参数没变的不再求值，变了的只改元素上变了的变量。
 * 选中的样式或形状变了（多出、少了属性）时按换过的那组样式重新组合，就地换掉元素上的类
 */
function apply(element: HTMLElement, bound: BoundElement) {
  let reshaped = false;
  for (const entry of bound.bindings) {
    const args = entry.binding.args();
    if (sameArgs(args, entry.args)) continue;
    const { part, inline } = entry.binding.style[EVALUATE](args);
    entry.args = args;
    if (part !== bound.parts[entry.index]) {
      bound.parts[entry.index] = part;
      reshaped = true;
    }
    const previous = entry.inline;
    entry.inline = inline;
    for (const name in inline) {
      if (previous[name] !== inline[name]) element.style.setProperty(name, inline[name]!);
    }
    for (const name in previous) {
      if (!(name in inline) && !ownedByOthers(bound, entry, name)) element.style.removeProperty(name);
    }
  }
  if (reshaped) swapClass(element, bound, compose(bound.parts).class ?? '');
}

/** 同一元素上别的绑定也写着这个变量（同一个动态样式绑了两次）：不删 */
const ownedByOthers = (bound: BoundElement, self: BindingEntry, name: string) =>
  bound.bindings.some((entry) => entry !== self && name in entry.inline);

/** 就地换类：只动引擎给的那几个类，元素上别的类（使用方的 class、过渡类）不碰 */
function swapClass(element: HTMLElement, bound: BoundElement, next: string) {
  const before = bound.className ? bound.className.split(' ') : [];
  const after = next ? next.split(' ') : [];
  const removed = before.filter((name) => !after.includes(name));
  const added = after.filter((name) => !before.includes(name));
  // 一换一（多半只是组合类换了）用 replace：元素的 class 只改一次
  const pairs = Math.min(removed.length, added.length);
  for (let index = 0; index < pairs; index++)
    element.classList.replace(removed[index]!, added[index]!);
  for (const name of removed.slice(pairs)) element.classList.remove(name);
  for (const name of added.slice(pairs)) element.classList.add(name);
  bound.className = next;
}

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

/**
 * attrs 的 watch：元素创建后调用，起一个 effect 并返回停止函数（框架的 owner / scope 负责在元素卸载时调用，
 * 在 effectScope 里创建时随作用域一起停）。第一次运行只为收集依赖：读到的参数与渲染时相同，就不再求值、不碰 DOM
 */
export function watchBindings(bindings: BindingEntry[], parts: StylePart[], className: string) {
  return (element: HTMLElement) => {
    const bound: BoundElement = { bindings, parts, className };
    return effect(() => apply(element, bound));
  };
}
