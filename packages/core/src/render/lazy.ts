/**
 * 懒加载组件：代码第一次要渲染时才加载；服务端渲染过的内容可以推迟接管，推迟期间不建 effect。
 * 接管时机由 hydrate 选项决定：load（默认）、idle、visible、interaction（第一次交互，事件排队后重放）。
 */
import { IDS } from '../app/context';
import { closeOf, cursor, hydrating, setCursor, setHydrating } from '../hydration';
import {
  flushSync,
  getContext,
  getOwner,
  onCleanup,
  provideValue,
  runWith,
  signal,
} from '../reactivity/kernel';
import type { Child } from '../types/value';
import { renderRegion } from './render';
import { Custom, VNode } from './vnode';

const lazyEntries: (() => Promise<unknown>)[] = [];
/** 服务端渲染前调用：把用到的 lazy 组件都加载好，renderToString 是同步的 */
export const preloadLazy = (): Promise<unknown[]> =>
  Promise.all(lazyEntries.map((entry) => entry()));
/** interaction 模式下，接管前要排队的事件 */
const REPLAYED = ['pointerdown', 'pointerup', 'click', 'focusin', 'input', 'keydown'];

/** 包一个按需加载的组件。可以传 fallback 属性，加载期间显示 */
export function lazy<P>(
  load: () => Promise<{ default: (props: P) => unknown }>,
  options: { hydrate?: 'load' | 'visible' | 'idle' | 'interaction' } = {},
) {
  let loaded: ((props: P) => unknown) | undefined;
  let pending: Promise<unknown> | undefined;
  const fetchModule = () =>
    (pending ??= load().then((module) => {
      loaded = module.default;
    }));
  lazyEntries.push(fetchModule);
  const Lazy = (props: P & { fallback?: Child }): unknown => {
    // useId 要和服务端一致：懒加载的子树单独一段前缀，加载早晚不影响兄弟的编号
    const ids = getContext()[IDS] as { prefix: string; next: number } | undefined;
    if (ids) provideValue(IDS, { prefix: `${ids.prefix}${ids.next++}-`, next: 0 });
    return new Custom(
      (parent, before, svg) => {
        if (hydrating && !loaded) return deferHydration(props);
        if (loaded) return renderRegion(() => new VNode(loaded, props), parent, before, svg);
        const ready = signal(false);
        void fetchModule().then(() => (ready.value = true));
        renderRegion(
          () => (ready.value ? new VNode(loaded, props) : props.fallback),
          parent,
          before,
          svg,
        );
      },
      (toHtml) =>
        `<!--[-->${loaded ? toHtml(new VNode(loaded, props)) : toHtml(props.fallback)}<!--]-->`,
    );
  };
  function deferHydration(props: P): void {
    const start = cursor!;
    const end = closeOf(start);
    setCursor(end.nextSibling);
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
        setCursor(start);
        try {
          runWith(owner, saved, () =>
            renderRegion(() => new VNode(loaded, props), end.parentNode!, end, false),
          );
        } finally {
          setHydrating(false);
          setCursor(null);
        }
        flushSync();
        replay?.();
      });
    const strategy = options.hydrate ?? 'load';
    if (strategy === 'load') void adopt();
    else if (strategy === 'idle') {
      const id =
        typeof requestIdleCallback === 'function'
          ? requestIdleCallback(() => void adopt())
          : (setTimeout(() => void adopt(), 200) as unknown as number);
      cancelTrigger = () =>
        typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id);
    } else {
      const elements: Element[] = [];
      for (let node = start.nextSibling; node !== end; node = node!.nextSibling)
        if (node!.nodeType === 1) elements.push(node as Element);
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
          for (const element of elements)
            for (const type of REPLAYED) element.removeEventListener(type, onEvent, true);
        };
        function onEvent(event: Event) {
          event.stopImmediatePropagation();
          if (event.type === 'click') event.preventDefault();
          queue.push(event);
          if (queue.length > 1) return;
          void adopt(() => {
            cancel();
            for (const item of queue) {
              const Kind = item.constructor as typeof Event;
              item.target!.dispatchEvent(new Kind(item.type, item));
            }
          });
        }
        for (const element of elements)
          for (const type of REPLAYED) element.addEventListener(type, onEvent, true);
        cancelTrigger = cancel;
      }
    }
  }
  return Object.assign(Lazy, { preload: fetchModule });
}
