import { component, renderToString } from '@hilt/runtime';
import { renderStyleTag, themeBootClasses, themeBootScript } from '@hilt/css';
import { insertedCount } from '../engine/sheet';
import { App, initial, themes } from './ssr-app';

export function render(options: { literalWidth?: number; width?: string } = {}) {
  const start = performance.now();
  const body = renderToString(() => component(App, { initial: { width: options.width ?? initial.width }, literalWidth: options.literalWidth }));
  const head = renderStyleTag(body, { include: themeBootClasses(themes) });
  return { body, head, boot: `<script>${themeBootScript({ themes, storageKey: 'pref' })}</script>`, ms: performance.now() - start };
}
export { insertedCount };
