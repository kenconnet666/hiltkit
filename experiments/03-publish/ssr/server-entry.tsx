import { component, renderToString } from '@hilt/runtime';
import { App, css, initial } from './app';

export function render() {
  const start = performance.now();
  const body = renderToString(() => component(App, { initial }));
  return { body, head: css.renderStyleTag(body), ms: performance.now() - start };
}
