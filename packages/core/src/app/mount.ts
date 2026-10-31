/**
 * 浏览器入口：`mount` 新建，`hydrate` 接管服务端输出。都返回卸载函数。
 * 服务端入口在 `server/render.ts`。
 */
import { setCursor, setHydrating } from '../hydration';
import { devHooks, dispose, flushSync } from '../reactivity/kernel';
import { notifyHydrate } from '../render/props';
import { renderValue } from '../render/render';
import { inApp } from './context';

/** 调试内核要知道应用的根：装了就包一层，没装不多一次调用 */
const renderApp = (view: () => unknown, host: Element) => {
  const render = () => renderValue(view(), host, null);
  return inApp(() => (devHooks ? devHooks.app(host, render) : render()));
};

/** 把视图渲染进容器。返回卸载函数 */
export function mount(view: () => unknown, host: Element): () => void {
  const { node } = renderApp(view, host);
  flushSync();
  return () => dispose(node);
}

/** 接管容器里服务端渲染好的 HTML：不重建 DOM，只接上事件和响应式。返回卸载函数 */
export function hydrate(view: () => unknown, host: Element): () => void {
  notifyHydrate();
  setHydrating(true);
  setCursor(host.firstChild);
  try {
    const { node } = renderApp(view, host);
    return () => dispose(node);
  } finally {
    setHydrating(false);
    setCursor(null);
    flushSync();
  }
}
