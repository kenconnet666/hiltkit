/**
 * hiltkit 的公开入口。这张导出表就是框架的 API，文档见仓库的 `docs/api.md`。
 *
 * 三条规则：传函数才是活的，传值只取一次；带 `()` 读，写用方法；传有 `set` 的 `Sig` 才能写回。
 *
 * 模块分工（依赖方向从下往上）：
 *   reactivity/  响应式：内核、深代理、Sig
 *   attrs/       属性写到元素：规则表、class 和 style、双向绑定、分层
 *   render/      描述对象 → DOM：元素、组件、动态段、列表、边界、懒加载
 *   app/         应用实例：mount、hydrate、服务、useId
 *   server/      描述对象 → HTML 字符串
 * 单独入口：hiltkit/css（样式）、hiltkit/devtools（调试）、hiltkit/vite（开发插件）。
 */
export {
  createContext,
  flushSync,
  inject,
  onCleanup,
  onError,
  provide,
  untrack,
  warnings,
} from './reactivity/kernel';
export { raw, snapshot } from './reactivity/state';
export {
  derived,
  effect,
  isSig,
  model,
  read,
  sig,
  type Model,
  type Prop,
  type ReadOnly,
  type ReadSig,
  type Sig,
  type SigFactory,
} from './reactivity/sig';
export { merge } from './render/merge';
export { registerStyles } from './render/props';
export { Boundary, Portal, dynamic, when } from './render/control';
export { For } from './render/list';
export { lazy, preloadLazy } from './render/lazy';
export { hotRegister } from './render/hot';
export { Custom, VNode, createElement } from './render/vnode';
export { createService, useId } from './app/context';
export { hydrate, mount } from './app/mount';
export { renderToString } from './server/render';
export type { Child } from './types/value';
