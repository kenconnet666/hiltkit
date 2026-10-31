import { component, preloadLazy, renderToString } from '@hilt/runtime';
import { renderStyleTag } from '@hilt/css';
import * as app from './app.tsx';

export const renderCase = (name: string) => {
  const body = renderToString(() => component((app as any)[name], {}));
  return { body, head: renderStyleTag(body) };
};
export const attrHtml = (index: number) =>
  [renderToString(() => component(app.AttrSpread, { index })), renderToString(() => app.attrCompiled[index]())];
export const attrCount = app.attrCount;
export { preloadLazy };
