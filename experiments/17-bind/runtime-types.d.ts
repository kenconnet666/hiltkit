// 实验用：运行时入口的宽松声明，只为让 hilt.ts 过类型检查
declare module '@hilt/runtime' {
  export const signal: <T>(value: T) => { value: T };
  export const computed: <T>(read: () => T) => { readonly value: T };
  export const renderEffect: (fn: () => void) => unknown;
  export const userEffect: (fn: () => void | (() => void)) => void;
  export const untrack: <T>(read: () => T) => T;
  export const state: <T>(value: T) => T;
  export const onCleanup: (fn: () => void) => void;
  export const bindInput: (...args: any[]) => void;
  export const spread: (el: any, props: any) => void;
  export const attrValue: (el: any, value: any) => void;
  export const attrState: (el: any, key: string, value: any) => void;
  export const attrBool: (el: any, key: string, value: any) => void;
  export const omit: (props: any, keys: any) => any;
  export const propsView: (props: any) => any;
  export const setterOf: (props: any, key: string) => ((value: any) => void) | undefined;
  export const createContext: <T>(fallback: T) => { fallback: T };
  export const provide: <T>(context: { fallback: T }, value: T) => void;
  export const inject: <T>(context: { fallback: T }) => T;
  export const mount: (render: () => unknown, host: Element) => () => void;
  export const flushSync: () => void;
}
