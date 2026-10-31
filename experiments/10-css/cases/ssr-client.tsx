import { component, flushSync, hydrate, mount } from '@hilt/runtime';
import { stats } from '@hilt/css';
import { App, initial } from './ssr-app';

(window as any).flushSync = flushSync;
(window as any).cssStats = stats;
const host = document.getElementById('app')!;
if ((window as any).__mode === 'hydrate') {
  const start = performance.now();
  hydrate(() => component(App, { initial }), host);
  (window as any).__hydrateMs = performance.now() - start;
} else {
  mount(() => component(App, { initial }), host);
}
