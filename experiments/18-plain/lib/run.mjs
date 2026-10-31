// 组件库预编译后使用：node 18-plain/lib/run.mjs
// 库：只转 JSX + 生成 .d.ts，一份 JS。使用方：不装插件，只用 esbuild 自带的 JSX 转换；服务端、浏览器都用同一份库产物
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { launch } from '../../lib/browser.mjs';
import { bundle } from '../bundle.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const tsc = here('../../13-ts/node_modules/typescript/bin/tsc');
let failed = 0;
let passed = 0;
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};

// 1. 发布组件库
mkdirSync(here('./dist'), { recursive: true });
const source = readFileSync(here('./src/index.tsx'), 'utf8');
const start = performance.now();
const { code } = await transform(source, { loader: 'tsx', jsx: 'automatic', jsxImportSource: 'hilt', target: 'es2022', format: 'esm' });
const transformMs = performance.now() - start;
writeFileSync(here('./dist/index.js'), code);
execFileSync('node', [tsc, '-p', here('./tsconfig.json')], { stdio: 'inherit' });
const digest = createHash('sha256').update(code).digest('hex');
console.log(`转换 ${source.length} 字符用了 ${transformMs.toFixed(2)} ms，产物 ${code.length} 字节，含 @hilt 内部导入：${/@hilt\//.test(code)}`);
console.log('--- 产物里的导入 ---');
console.log(code.split('\n').filter((line) => line.startsWith('import')).join('\n'));
check('库产物只依赖公开入口（hilt、hilt/css、hilt/jsx-runtime）', !/@hilt\//.test(code) && /hilt\/jsx-runtime/.test(code));
const dts = readFileSync(here('./dist/lib/src/index.d.ts'), 'utf8');
console.log('--- .d.ts 片段 ---');
console.log(dts.split('\n').slice(0, 14).join('\n'));
check('.d.ts 保留泛型', /Select<T>/.test(dts));

// 2. 使用方类型只看 .d.ts
try {
  execFileSync('node', [tsc, '-p', here('./consumer/tsconfig.json')], { stdio: 'pipe', encoding: 'utf8' });
  check('使用方类型：正例通过、负例全部命中（TS 7.1 beta）', true);
} catch (error) {
  check('使用方类型', false, String(error.stdout).slice(0, 1200));
}

// 3. 使用方不装插件，运行
const alias = { '@lib/ui': here('./dist/index.js') };
const app = `import { flushSync, hydrate, mount, sig } from 'hilt';
import { Button, Select, Switch, ThemeName, ThemeProvider, useCounter } from '@lib/ui';
function App() {
  const on = sig(false);
  const loading = sig(false);
  const picked = sig(undefined);
  const counter = useCounter(1);
  globalThis.api = { setOn: (next) => on.set(next), setLoading: (next) => loading.set(next) };
  return (
    <div>
      <Switch id="sw" label="开关" checked={on} />
      <p id="sw-state">{() => String(on())}</p>
      <Switch id="free" label="自己持有" />
      <Button id="btn" class="user" loading={loading} onClick={() => counter.add()}>保存</Button>
      <p id="count">{counter.count}</p>
      <Select id="sel" options={['甲', '乙']} value={picked} text={(item) => item} />
      <p id="picked">{() => picked() ?? '无'}</p>
      <ThemeProvider value="dark"><ThemeName id="theme" /></ThemeProvider>
      <ThemeName id="theme-outer" />
    </div>
  );
}
`;
const clientCode = await bundle(`${app}
window.flushSync = flushSync;
window.startMount = () => mount(() => <App />, document.body);
window.startHydrate = () => hydrate(() => <App />, document.getElementById('ssr'));`, { alias });
const serverCode = await bundle(`${app}
import { renderToString } from 'hilt'; import { renderStyleTag } from 'hilt/css';
export const render = () => { const body = renderToString(() => <App />); return { body, head: renderStyleTag(body) }; };`, { server: true, alias });
check('使用方构建没有改动库产物', createHash('sha256').update(readFileSync(here('./dist/index.js'))).digest('hex') === digest);

const browser = await launch();
async function behaviour(page, title) {
  console.log(`## ${title}`);
  page.setDefaultTimeout(3000);
  const flush = () => page.evaluate(() => window.flushSync());
  const text = (id) => page.evaluate((target) => document.getElementById(target)?.textContent, id);
  const before = await page.evaluate(() => {
    const el = document.getElementById('btn');
    return { cls: el.className, busy: el.getAttribute('aria-busy'), color: getComputedStyle(el).color };
  });
  check('class 跨库和使用方拼接、样式生效', before.cls.includes('user') && before.cls.includes('lib-button') && before.color === 'rgb(255, 0, 0)', before);
  await page.click('#sw');
  await flush();
  check('双向穿过库', (await text('sw-state')) === 'true', await text('sw-state'));
  check('库内部的样式跟着变', (await page.evaluate(() => getComputedStyle(document.getElementById('sw').closest('label')).color)) === 'rgb(0, 128, 0)');
  await page.evaluate(() => window.api.setOn(false));
  await flush();
  check('父改子', (await page.evaluate(() => document.getElementById('sw').checked)) === false);
  await page.click('#free');
  await flush();
  check('不传：库自己持有', (await page.evaluate(() => document.getElementById('free').closest('label').dataset.state)) === 'on');
  await page.click('#btn');
  await flush();
  check('事件合并：使用方执行', (await text('count')) === '2', await text('count'));
  await page.evaluate(() => window.api.setLoading(true));
  await flush();
  await page.click('#btn');
  await flush();
  check('受管层拦下使用方', (await text('count')) === '2', await text('count'));
  await page.click('#sel button:nth-child(2)');
  await flush();
  check('泛型组件写回', (await text('picked')) === '乙', await text('picked'));
  check('context 穿过库', (await text('theme')) === 'dark' && (await text('theme-outer')) === 'light', [await text('theme'), await text('theme-outer')]);
}
{
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ content: clientCode });
  await page.evaluate(() => void window.startMount());
  await behaviour(page, '客户端');
  await page.close();
}
{
  const { render } = await import(`data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`);
  const { body, head } = render();
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head>${head}</head><body><div id="ssr">${body}</div></body></html>`);
  await page.evaluate(() => {
    window.mutations = [];
    window.observer = new MutationObserver((records) => window.mutations.push(...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)));
    window.observer.observe(document.getElementById('ssr'), { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.addScriptTag({ content: clientCode });
  const mutations = await page.evaluate(async () => {
    window.startHydrate();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [...window.mutations, ...window.observer.takeRecords().map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`)];
  });
  check('服务端渲染后接管：0 次 DOM 改动（同一份库产物）', mutations.length === 0, mutations.slice(0, 8));
  await behaviour(page, '接管之后');
  await page.close();
}
await browser.close();
console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;
