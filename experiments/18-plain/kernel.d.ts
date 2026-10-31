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
  export const devHooks: any;
  export const setDevHooks: (hooks: unknown) => void;
  export const diagnostics: { setupReads: boolean };
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
  export const attrValue: (el: any, value: any) => void;
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
  export const ssrAttr: (name: string, value: unknown, tag?: string) => string;
  export const ssrElement: (tag: string, props: any, children: () => unknown) => unknown;
}
declare module '@hilt/state' {
  export const state: <T>(value: T) => T;
  export const raw: <T>(value: T) => T;
  export const snapshot: <T>(value: T) => T;
}
declare module '@hilt/css/abi' {
  export const select: (read: () => never) => unknown;
  export const markServerRendered: () => void;
}
// 样式引擎。签名在 hilt/types/css/，hilt/css 原样导出；recipe 例外：hilt/css 在外面包了一层（档位收读取函数），所以这里是引擎自己的宽松声明
declare module '@hilt/css' {
  export const create: typeof import('./hilt/types/css/styles').create;
  export const keyframes: typeof import('./hilt/types/css/styles').keyframes;
  export const defineTokens: typeof import('./hilt/types/css/theme').defineTokens;
  export const defineVars: typeof import('./hilt/types/css/theme').defineVars;
  export const createTheme: typeof import('./hilt/types/css/theme').createTheme;
  export const themeStyle: typeof import('./hilt/types/css/theme').themeStyle;
  export const defineConditions: typeof import('./hilt/types/css/theme').defineConditions;
  export const configure: typeof import('./hilt/types/css/config').configure;
  export const renderStyleTag: typeof import('./hilt/types/css/config').renderStyleTag;
  export const defineMarker: typeof import('./hilt/types/css/theme').defineMarker;
  export const when: typeof import('./hilt/types/css/theme').relation;
  export const themeBootScript: typeof import('./hilt/types/css/theme').themeBootScript;
  export const themeBootClasses: typeof import('./hilt/types/css/theme').themeBootClasses;
  export const provideStyles: typeof import('./hilt/types/css/styles').provideStyles;
  export const useRecipe: typeof import('./hilt/types/css/styles').useRecipe;
  export const recipe: (config: object) => {
    (selection?: Record<string, unknown>, ...extensions: unknown[]): Record<string, unknown>;
    readonly parts: readonly string[];
    readonly name: string | undefined;
  };
}
