// 缺陷复现用：手写一段 TSX（导出 Root，用 globalThis.__init / __apis 约定同 hydrate 方向），服务端渲染 -> 水合，返回事实。
//   const r = await runScenario({ source, init, preload, rounds });
//   r.mutations / r.sameNodes / r.hydrateError / r.ssrVsFresh / r.errors / r.rounds[i].diff
import { fileURLToPath } from 'node:url';
import { bundleApp } from './build-app.mjs';
import { launch, openPage } from './page.mjs';

const PAGE = JSON.stringify(fileURLToPath(new URL('../hydrate-page.js', import.meta.url)));
const serverEntry = `
import { component, renderToString, preloadLazy } from '@hilt/runtime';
import * as app from 'fuzz-app';
export const render = (init) => {
  globalThis.__init = JSON.parse(JSON.stringify(init));
  globalThis.__apis = {};
  const body = renderToString(() => component(app.Root, { slot: 'main' }));
  return { body, head: '' };
};
export { preloadLazy };
`;

export async function runScenario({ source, init = {}, preload = false, rounds = [], strictFormAttrs = false, waitMs = 0 }) {
  const clientCode = await bundleApp({ entry: `import ${PAGE};`, app: source, generate: 'client' });
  const serverCode = await bundleApp({ entry: serverEntry, app: source, generate: 'server' });
  const server = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
  await server.preloadLazy();
  const rendered = server.render(init);
  const browser = await launch();
  try {
    const page = await openPage(browser, undefined, { width: 1000, height: 30000 });
    await page.setContent(`<!doctype html><html><head></head><body><div id="app">${rendered.body}</div></body></html>`);
    await page.addScriptTag({ content: clientCode });
    if (strictFormAttrs) await page.evaluate(() => (globalThis.__strictFormAttrs = true));
    await page.evaluate(() => window.hydrateFuzz.prepare());
    const hydrated = await page.evaluate(([state, flag]) => window.hydrateFuzz.hydrate(state, flag), [init, preload]);
    if (waitMs) await page.waitForTimeout(waitMs);
    const initial = await page.evaluate((state) => window.hydrateFuzz.initialCompare(state), init);
    const results = [];
    for (const ops of rounds) results.push(await page.evaluate((list) => window.hydrateFuzz.round(list), ops));
    return {
      html: rendered.body,
      hydrateError: hydrated.error,
      mutations: hydrated.mutations,
      sameNodes: hydrated.sameNodes,
      ssrVsFresh: initial.ssrVsFresh,
      hydratedVsFresh: initial.hydratedVsFresh,
      rounds: results,
      errors: page.errors,
    };
  } finally {
    await browser.close();
  }
}

/** 输出一行结论，返回是否有问题 */
export function report(ok, good, bad) {
  console.log(ok ? `ok ${good}` : `FAIL ${bad}`);
  process.exitCode = ok ? 0 : 1;
}
