// 实验用：合并版运行时各模块的宽松声明
declare module '@hilt/reactive' {
  export const signal: <T>(value: T) => { value: T };
  export const computed: <T>(read: () => T) => { readonly value: T };
  export const renderEffect: (fn: () => void) => unknown;
  export const userEffect: (fn: () => void | (() => void)) => void;
  export const untrack: <T>(read: () => T) => T;
  export const onCleanup: (fn: () => void) => void;
  export const onError: (fn: (error: unknown) => void) => void;
  export const flushSync: () => void;
  export const warnings: unknown[];
  export const getOwner: () => unknown;
  export const getContext: () => object;
  export const withContext: <T>(saved: object, fn: () => T) => T;
  export const runSetup: (fn: (arg: any) => unknown, arg: unknown) => unknown;
  export const runWith: <T>(owner: unknown, saved: object, fn: () => T) => T;
  export const scope: (fn: () => void) => unknown;
  export const dispose: (node: unknown) => void;
  export const provideValue: (id: symbol, value: unknown) => void;
  export const setBoundary: (owner: unknown, handler: (error: Error) => void) => void;
  export const createContext: <T>(fallback: T) => { fallback: T };
  export const provide: <T>(context: { fallback: T }, value: T) => void;
  export const inject: <T>(context: { fallback: T }) => T;
}
declare module '@hilt/attrs' {
  export const bindInput: (...args: any[]) => void;
  export const setAttr: (el: any, key: string, value: any) => void;
  export const setSx: (el: any, value: any) => void;
  export const setHydrating: (value: boolean) => void;
  export const spread: (el: any, props: any) => void;
  export const hydrating: boolean;
}
declare module '@hilt/rules' {
  export const LATE: number;
  export const TABLE: Record<string, number | string | undefined>;
  export const config: any;
  export const eventOf: (key: string) => any;
  export const isEventKey: (key: string) => boolean;
  export const merge: (...sources: unknown[]) => unknown;
}
declare module '@hilt/server' {
  export const ssr: (parts: string[]) => unknown;
  export const ssrChild: (value: unknown) => string;
  export const ssrElement: (tag: string, props: any, children: () => unknown) => unknown;
}
declare module '@hilt/state' {
  export const state: <T>(value: T) => T;
  export const raw: <T>(value: T) => T;
  export const snapshot: <T>(value: T) => T;
}
declare module '@hilt/css/abi' {
  export const select: (read: () => never) => unknown;
}
declare module '@hilt/css' {
  export const create: <T>(styles: T, label?: string) => any;
  export const recipe: (config: any) => any;
  export const renderStyleTag: (html: string, options?: unknown) => string;
}
