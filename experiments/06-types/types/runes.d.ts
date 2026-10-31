/**
 * 符文的全局声明：编译期消失，类型层面都是“普通值”。
 */
import type { JsxElement } from 'exp06/core';

declare global {
  /**
   * 响应式状态：深代理，读写都是原类型。let 可整体替换，const 的对象属性照常可改。
   * 布尔字面量单独一条重载返回 boolean：泛型的 T 会被推成 false，
   * 让变量被“赋值收窄”成 false，之后 if (open === true) 报“没有重叠”，if (open) 里变成 never。
   */
  function _state(initial: boolean): boolean;
  function _state<T>(initial: T): T;
  /** 没有初始值的响应式状态，初始为 undefined */
  function _state<T>(): T | undefined;
  namespace _state {
    /** 只能整体替换、不代理的状态（大数组、DOM 元素、第三方实例） */
    function raw(initial: boolean): boolean;
    function raw<T>(initial: T): T;
    function raw<T>(): T | undefined;
    /** 去掉代理的静态拷贝，交给 structuredClone、第三方库 */
    function snapshot<T>(value: T): T;
  }

  /** 派生值：表达式。函数式派生写 _derived.by；这里传函数是类型错误（常见误写） */
  function _derived<T>(
    expression: T extends (...args: never[]) => unknown ? UseDerivedByForFunctions : T,
  ): T;
  namespace _derived {
    /** 复杂派生：写成函数 */
    function by<T>(fn: () => T): T;
  }

  /**
   * 副作用：可返回清理函数；返回其他值是类型错误。
   * 注意表达式体的箭头函数（`_effect(() => list.push(1))`）会因为返回 number 被拒，要写成块体。
   */
  function _effect(fn: () => void | (() => void)): void;
  namespace _effect {
    function pre(fn: () => void | (() => void)): void;
    function root(fn: () => void | (() => void)): () => void;
  }

  /** 只取当前值、不追踪 */
  function _untrack<T>(value: T): T;

  /**
   * 组件参数的默认值：可绑定 prop 没传时由组件自己持有状态。
   * 给了初始值返回 T；没给时诚实地返回 T | undefined（调用侧可能一直没传）。
   */
  function _bindable(fallback: boolean): boolean;
  function _bindable<T>(fallback: T): T;
  function _bindable<T>(): T | undefined;
  namespace _bindable {
    /** 不代理：只有整体替换才更新 */
    function raw<T>(fallback: T): T;
    function raw<T>(): T | undefined;
  }

  /**
   * 定义组件：函数体只执行一次，参数解构即 props，JSX 内容就是 children prop。
   * 两种写法都支持：`_component<Props>(({ a, ...rest }) => …)` 与泛型 `_component(<T,>(props: P<T>) => …)`。
   */
  function _component<P>(setup: (props: P) => JsxElement): (props: P) => JsxElement;
}

/** _derived 收到函数时参数类型里的提示 */
interface UseDerivedByForFunctions {
  '_derived 接收表达式；函数式派生请写 _derived.by(() => …)': never;
}

export {};
