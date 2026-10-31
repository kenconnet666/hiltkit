/**
 * 内置的控制组件：条件 `when`、错误边界 `Boundary`、传送 `Portal`、动态键 `dynamic`。
 * 它们都只是 `Custom` 或普通函数，没有编译器参与，用户也能照着写出自己的。
 */
import {
  computed as rawComputed,
  getOwner,
  setBoundary,
  signal,
  untrack,
} from '../reactivity/kernel';
import { effect, read, type Prop, type ReadSig } from '../reactivity/sig';
import type { Child } from '../types/value';
import { renderRegion, renderValue } from './render';
import { Custom } from './vnode';

/**
 * 条件：真假不变时分支不重建。判空后类型收窄：u 是非空的读取函数。
 * 普通的 () => on() ? <A /> : <B /> 也能用，只是依赖一变分支就重建。
 */
export function when<T>(
  source: Prop<T>,
  then: (value: ReadSig<NonNullable<T>>) => Child,
  otherwise?: () => Child,
): () => Child {
  const truthy = rawComputed(() => !!read(source));
  return () => (truthy.value ? then(() => read(source) as NonNullable<T>) : otherwise?.());
}

/**
 * 错误边界：子树渲染或更新时抛错，显示 fallback(错误, 重试)。
 * 边界就是一段动态内容：出错时这一段重跑，换成 fallback；重试时再换回来，children 是描述对象，可以再建一次
 */
export function Boundary(props: {
  fallback: (error: Error, retry: () => void) => Child;
  children?: Child;
}): unknown {
  return new Custom(
    (parent, before, svg) => {
      const failure = signal<{ error: Error } | undefined>(undefined);
      renderRegion(
        () => {
          const current = failure.value;
          if (current) {
            return untrack(() => props.fallback(current.error, () => (failure.value = undefined)));
          }
          setBoundary(getOwner()!, (error: Error) => (failure.value = { error }));
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
          for (let node = start.nextSibling; node !== end; node = start.nextSibling)
            target.removeChild(node!);
          target.removeChild(start);
          target.removeChild(end);
        };
      });
    },
    () => '',
  );
}

/**
 * 动态键：键集合本身会变时用。{...dynamic(() => (cond() ? a : b))}、{...dynamic(propsIcon)}；普通写法没有这个成本。
 * 和同一元素上写的属性分层：class 拼接，事件都执行，撤掉时只清它自己写的。每次调用一个键，同一元素可以有多个
 */
export const dynamic = (source: Prop<object | null | undefined>): object => {
  const readSource: any = () => read(source);
  readSource.$$dynamic = true;
  return { [Symbol('hilt.dynamic')]: readSource };
};
