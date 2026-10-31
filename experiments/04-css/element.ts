// 最小的元素层（代替 JSX 编译器）：手写 el = template.cloneNode()，再把引擎的 attrs 结果接到元素上。
import { effect } from 'alien-signals';
import type { Attrs } from './engine/runtime';

/**
 * 写法一：编译器把 attrs 里随状态变的部分改写成 css.bind / css.select，attrs 只算一次，
 * 之后由 attrs.watch 起的 effect 改变量、换类。静态样式只写一次 class。
 * 在 effectScope 里调用时，effect 随作用域一起停。
 */
export function mount<T extends HTMLElement>(element: T, attrs: Attrs): T {
  if (attrs.class) {
    // 元素上已有使用方的类时不覆盖
    if (element.className) element.classList.add(...attrs.class.split(' '));
    else element.className = attrs.class;
  }
  if (attrs.style) for (const name in attrs.style) element.style.setProperty(name, attrs.style[name]!);
  attrs.watch?.(element);
  return element;
}

/**
 * 写法二（对照）：框架的 JSX 编译器把整个 attrs 表达式包进一个 effect（Solid 的做法），
 * 不用 bind / select。每次依赖变化重新算 attrs（引擎有缓存），再和上次的结果比，只写变了的 class 与变量。
 * 元素的 class 整个由引擎管（不保留使用方的类），这是与写法一的语义差别。
 */
export function mountReactive<T extends HTMLElement>(element: T, read: () => Attrs): T {
  let className: string | undefined;
  let inline: Readonly<Record<string, string>> = {};
  effect(() => {
    const next = read();
    const nextClass = next.class ?? '';
    if (nextClass !== className) element.className = className = nextClass;
    const nextInline = next.style ?? {};
    if (nextInline === inline) return;
    for (const name in nextInline) {
      if (inline[name] !== nextInline[name]) element.style.setProperty(name, nextInline[name]!);
    }
    for (const name in inline) if (!(name in nextInline)) element.style.removeProperty(name);
    inline = nextInline;
  });
  return element;
}
