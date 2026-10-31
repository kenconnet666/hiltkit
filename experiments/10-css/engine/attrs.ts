/**
 * 一个元素的 sx → 元素要的类与变量。运行时（spread）经 register.ts 登记的就是这个函数，用户不直接调用。
 */
import { untrack, watchBindings, type BindingEntry, type StyleHost } from './bindings';
import { compose } from './compose';
import { collectParts } from './resolve';
import { BINDING, DYNAMIC, EVALUATE, type Binding, type StylePart } from './fragment';

/** attrs 的结果 */
export interface Attrs {
  /** 组合类，加上主题、标记的类 */
  class?: string;
  /** 动态样式的行内变量 */
  style?: Readonly<Record<string, string>>;
  /** 有响应式绑定时：元素创建后调用，起一个 effect 改变量、换类，返回停止函数 */
  watch?: (host: StyleHost) => () => void;
}

/**
 * 合并样式成元素属性 `{ class, style, watch? }`，后面的覆盖前面的；假值忽略，可以嵌套成数组，也可以直接写样式对象。
 * 只有静态片段时返回缓存的同一个对象；有动态样式时 class 走缓存，style 是这次的变量值；
 * 有响应式绑定（bind、select）时再带一个 watch：元素创建后由 effect 改变量、换类（见 watchBindings）
 */
export function attrs(...styles: readonly unknown[]): Attrs {
  /** 一项一位：静态的是片段本身，绑定的是它这次算出的一组片段（数组） */
  const slots: (StylePart | StylePart[])[] = [];
  let inline: Record<string, string> | undefined;
  let entries: BindingEntry[] | undefined;
  const addInline = (values: Readonly<Record<string, string>>) => {
    // 还没有属性转成变量时行内为空：不给 style，结果仍是缓存的同一个对象
    for (const _ in values) {
      inline = Object.assign(inline ?? {}, values);
      return;
    }
  };
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (BINDING in value) {
      // 渲染时只取这一次的值算类名与首屏的变量，不追踪：参数变化交给元素上的 effect
      const binding = value as Binding;
      let args: readonly unknown[] = [];
      const { parts, inline: values } = untrack(() => binding.style[EVALUATE]((args = binding.args())));
      (entries ??= []).push({ binding, index: slots.length, args, inline: values });
      slots.push(parts as StylePart[]);
      addInline(values);
    } else if (Array.isArray(value) && !(DYNAMIC in value)) {
      value.forEach(collect);
    } else {
      const parts: StylePart[] = [];
      const values: Record<string, string> = {};
      collectParts(value, parts, values);
      slots.push(...parts);
      addInline(values);
    }
  };
  styles.forEach(collect);

  const composed = compose(entries ? slots.flat() : (slots as StylePart[]));
  if (!inline && !entries) return composed;
  const result: Attrs = inline ? { ...composed, style: inline } : { ...composed };
  if (entries) result.watch = watchBindings(entries, slots as StylePart[][]);
  return result;
}
