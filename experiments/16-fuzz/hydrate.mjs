// 方向 4：水合。随机组件树源码 -> 编译 client / server -> 服务端渲染 -> 页面解析 -> 水合。
// 断言：水合 0 次 DOM 改动、节点身份不变、无报错；服务端 HTML / 水合后 / 纯客户端新挂载三者规范化后相同；
// 之后随机改状态若干轮，每轮水合后的页面与“同样状态下纯客户端新挂载”的 DOM 规范化后相等。
import { fileURLToPath } from 'node:url';
import { bundleApp } from './lib/build-app.mjs';
import { launch, openPage } from './lib/page.mjs';
import { generate, printModule } from './hydrate-gen.mjs';

const PAGE = JSON.stringify(fileURLToPath(new URL('./hydrate-page.js', import.meta.url)));
const CLIENT_ENTRY = `import ${PAGE};`;
const serverEntry = (sx) => `
import { component, renderToString, preloadLazy } from '@hilt/runtime';
${sx ? "import { renderStyleTag } from '@hilt/css';" : ''}
import * as app from 'fuzz-app';
export const render = (init) => {
  globalThis.__init = JSON.parse(JSON.stringify(init));
  globalThis.__apis = {};
  const body = renderToString(() => component(app.Root, { slot: 'main' }));
  return { body, head: ${sx ? 'renderStyleTag(body)' : "''"} };
};
export { preloadLazy };
`;

let browser;
const initialState = (c) => Object.fromEntries(c.states.map((s) => [s.name, s.init]));

/** 返回 { kind, message } 或 undefined */
let strict = false;
async function runCase(c) {
  const init = initialState(c);
  const source = printModule(c);
  let clientCode;
  let server;
  try {
    clientCode = await bundleApp({ entry: CLIENT_ENTRY, app: source, generate: 'client' });
    const serverCode = await bundleApp({ entry: serverEntry(c.features.sx), app: source, generate: 'server' });
    server = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
  } catch (error) {
    return { kind: 'compile-error', message: String(error.message ?? error).split('\n').slice(0, 6).join(' | '), source };
  }
  let rendered;
  try {
    await server.preloadLazy();
    rendered = server.render(init);
  } catch (error) {
    return { kind: 'ssr-throws', message: String(error.stack ?? error).split('\n').slice(0, 4).join(' | '), source };
  }
  // 视口开得很高：visible 策略的懒组件在屏幕外不会水合（没有 width 的 <svg> 会撑成一整屏高），状态更新就进不去，不是缺陷
  const page = await openPage(browser, undefined, { width: 1000, height: 30000 });
  try {
    await page.setContent(`<!doctype html><html><head>${rendered.head}</head><body><div id="app">${rendered.body}</div></body></html>`);
    await page.addScriptTag({ content: clientCode });
    const found = [];
    const note = (kind, message) => found.push({ kind, message });
    if (strict) await page.evaluate(() => (globalThis.__strictFormAttrs = true));
    await page.evaluate(() => window.hydrateFuzz.prepare());
    const hydrated = await page.evaluate(([state, preload]) => window.hydrateFuzz.hydrate(state, preload), [init, c.preload]);
    if (hydrated.error) note('hydrate-throws', hydrated.error);
    else {
      if (hydrated.mutationCount) note('hydrate-mutations', `${hydrated.mutationCount} 次：${hydrated.mutations.join(', ')}`);
      if (!hydrated.sameNodes) note('hydrate-nodes', `节点数 ${hydrated.nodeCounts.join(' -> ')} 或身份变了`);
      if (hydrated.inserted) note('hydrate-insertRule', `${hydrated.inserted} 次`);
    }
    if (page.errors.length) note('hydrate-page-error', page.errors.splice(0).join(' | '));
    const initial = await page.evaluate((state) => window.hydrateFuzz.initialCompare(state), init);
    if (initial.ssrVsFresh) note('ssr-vs-csr', initial.ssrVsFresh);
    if (initial.hydratedVsFresh) note('hydrated-vs-csr-initial', initial.hydratedVsFresh);
    if (!found.length) {
      let roundNo = 0;
      for (const round of c.rounds) {
        roundNo++;
        const result = await page.evaluate((ops) => window.hydrateFuzz.round(ops), round.ops);
        if (result.diff) {
          note('round-mismatch', `第 ${roundNo} 轮 ${JSON.stringify(round.ops).slice(0, 200)}：${result.diff}`);
          break;
        }
        if (page.errors.length) {
          note('round-page-error', `第 ${roundNo} 轮：${page.errors.splice(0).join(' | ')}`);
          break;
        }
      }
    }
    if (!found.length) return undefined;
    return { kind: found[0].kind, message: found.map((f) => `[${f.kind}] ${f.message}`).join('  ||  '), source };
  } finally {
    await page.close();
  }
}

export const direction = {
  name: 'hydrate',
  title: '水合',
  defaultSeeds: 150,
  shrinkBudget: 250,
  async setup() {
    browser = await launch();
  },
  async teardown() {
    await browser?.close();
  },
  async check(seed, options = {}) {
    strict = !!options['with-known-bugs'];
    const c = generate(seed, options);
    const failure = await runCase(c);
    if (!failure) return { ok: true };
    if (options.source) console.log(failure.source);
    return { ok: false, kind: failure.kind, message: failure.message, caseData: c };
  },
  async recheck(c) {
    return (await runCase(c))?.kind;
  },
  /** 调试：完整消息 */
  async detail(c) {
    const failure = await runCase(c);
    return failure ? `${failure.kind}
${failure.message}` : '通过';
  },
  /** 调试：把某个种子的 TSX 源码打出来 */
  sourceOf: (seed) => printModule(generate(seed)),
};
