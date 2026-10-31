// 实验用的最小 JSX 声明：只写到能验证绑定的类型。完整的元素表在 15-types。
import type { Ref, ReadRef, Signal } from './hilt';

declare global {
  namespace JSX {
    type Element = unknown;
    interface ElementChildrenAttribute {
      children: unknown;
    }
    interface Common {
      id?: string | undefined;
      class?: unknown;
      style?: unknown;
      sx?: unknown;
      role?: string;
      title?: string | undefined;
      hidden?: boolean;
      tabindex?: number | string;
      children?: unknown;
      ref?: (el: any) => void;
      onClick?: (event: MouseEvent) => void;
      onKeyDown?: (event: KeyboardEvent) => void;
      onInput?: (event: Event) => void;
      [data: `data-${string}`]: unknown;
      [aria: `aria-${string}`]: unknown;
    }
    interface InputAttrs extends Common {
      type?: string;
      name?: string;
      disabled?: boolean;
      /** 传壳双向，传值单向；只读的壳不收 */
      value?: string | number | undefined | Ref<string> | Ref<number> | Signal<string>;
      checked?: boolean | Ref<boolean> | Signal<boolean> | unknown[];
    }
    interface IntrinsicElements {
      div: Common;
      span: Common;
      p: Common;
      i: Common;
      b: Common;
      label: Common & { for?: string };
      section: Common;
      button: Common & { type?: string; disabled?: boolean };
      input: InputAttrs;
      select: InputAttrs;
      option: Common & { value?: string };
      textarea: InputAttrs;
    }
  }
  // 符文体系的声明（s0、s3 用）
  function _state<T>(initial: T): T;
  function _derived<T>(expression: T): T;
  function _effect(fn: () => void | (() => void)): void;
  function _bindable<T>(fallback: T): T;
  function _bind<T>(target: T): T;
  namespace _bind {
    function trim<T>(target: T): T;
    function group<T>(target: T): any;
  }
  /** 取到变量背后的壳 */
  function _ref<T>(target: T): Ref<T>;
  function _model<T>(source: T | Ref<T> | undefined, fallback: T): T;
  function _model<T>(fallback: T): T;
  /** 可写的派生：类型上就是 T */
  function _writable<T>(read: () => T, write: (value: T) => void): T;
  function _component<P>(setup: (props: P) => unknown): (props: P) => unknown;
}
export type { ReadRef };
