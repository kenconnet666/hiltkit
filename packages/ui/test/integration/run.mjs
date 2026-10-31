// 组件库的集成测试：服务端渲染、水合、摇树、只走构建产物的使用方。node test/integration/run.mjs
// 要 hiltkit 和 @hiltkit/ui 的构建产物，先 pnpm build。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const core = (file) => here(`../../../core/src/${file}`);
const ALIAS = {
  'hiltkit/jsx-runtime': core('jsx-runtime.ts'),
  'hiltkit/jsx-dev-runtime': core('jsx-dev-runtime.ts'),
  'hiltkit/devtools': core('devtools/index.ts'),
  'hiltkit/css': core('css/index.ts'),
  hiltkit: core('index.ts'),
  '@hiltkit/ui/locale/zh-CN': here('../../src/locale/zh-CN.ts'),
  '@hiltkit/ui': here('../../src/index.ts'),
};
const bundle = async (contents, { server = false, minify = false } = {}) => {
  const result = await build({
    stdin: { contents, resolveDir: here('.'), loader: 'tsx' },
    bundle: true,
    write: false,
    format: server ? 'esm' : 'iife',
    platform: server ? 'node' : 'browser',
    target: 'es2022',
    minify,
    // 中文不转义：下面按文字检查语言包进没进包
    charset: 'utf8',
    jsx: 'automatic',
    jsxImportSource: 'hiltkit',
    alias: ALIAS,
  });
  return result.outputFiles[0].text;
};
let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `：${JSON.stringify(detail)?.slice(0, 400)}`}`,
  );
};

// 同一份应用：服务端和客户端都跑它
const app = (provider) => `
import { flushSync, hydrate, renderToString, sig } from 'hiltkit';
import { Provider, commonMessages, useFormat, useLocale, useMessages } from '@hiltkit/ui';
import zhCN from '@hiltkit/ui/locale/zh-CN';
function Page() {
  const format = useFormat();
  const t = useMessages(commonMessages);
  const { timeZone } = useLocale();
  return <main>
    <p id="instant">{() => format.dateTime('2026-10-31T16:30:00Z', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' })}</p>
    <p id="plain">{() => format.date('2026-10-31')}</p>
    <p id="zone">{timeZone}</p>
    <p id="number">{() => format.number(1234.5)}</p>
    <button id="close">{() => t().close}</button>
  </main>;
}
const view = () => ${provider};
export const html = () => renderToString(view);
globalThis.adopt = (host) => hydrate(view, host);
globalThis.flush = flushSync;
`;
const load = async (source) => {
  const code = await bundle(source, { server: true });
  // 服务端模块读 globalThis.adopt 不执行，只用 html
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};
const text = (page, id) =>
  page.evaluate((selector) => document.querySelector(selector).textContent, `#${id}`);

async function hydrateIn(kind, source, html, timezoneId) {
  const browser = await kind.launch();
  const context = await browser.newContext({ timezoneId, locale: 'en-GB' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(`<!doctype html><html><body><div id="host">${html}</div></body></html>`);
  await page.addScriptTag({ content: await bundle(source) });
  const mutations = await page.evaluate(async () => {
    const host = document.getElementById('host');
    const records = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    globalThis.adopt(host);
    const during = observer.takeRecords().length + records.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    globalThis.flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
    records.push(...observer.takeRecords());
    return {
      during,
      total: records.length,
      targets: records.map((record) => record.target.parentElement?.id ?? record.target.id),
    };
  });
  return { page, browser, mutations, errors };
}

const warnings = [];
const originalWarn = console.warn;
console.warn = (message) => warnings.push(String(message));
const explicit = app(
  `<Provider locale="zh-CN" timeZone="Asia/Shanghai" messages={zhCN}><Page /></Provider>`,
);
const unset = app(`<Provider locale="zh-CN" messages={zhCN}><Page /></Provider>`);
const explicitHtml = (await load(explicit)).html();
check('明确时区时服务端不告警', warnings.length === 0, warnings);
check(
  '服务端输出 lang、dir 和文案',
  explicitHtml.includes('lang="zh-CN"') &&
    explicitHtml.includes('dir="ltr"') &&
    explicitHtml.includes('关闭'),
  explicitHtml,
);
check('服务端按指定时区格式化', explicitHtml.includes('2026/11/1 00:30'), explicitHtml);
check('墙上时间和时区无关', explicitHtml.includes('2026年10月31日'), explicitHtml);
const unsetHtml = (await load(unset)).html();
check(
  '没设时区：服务端按 UTC 输出',
  unsetHtml.includes('2026/10/31 16:30') && unsetHtml.includes('>UTC<'),
  unsetHtml,
);
check(
  '没设时区：服务端上报 HILT004',
  warnings.some((item) => item.includes('HILT004')),
  warnings,
);
console.warn = originalWarn;

for (const [name, kind] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  {
    const { page, browser, mutations, errors } = await hydrateIn(
      kind,
      explicit,
      explicitHtml,
      'America/New_York',
    );
    check(`${name} 明确时区：水合 0 DOM 改动`, mutations.total === 0, mutations);
    check(
      `${name} 明确时区：不跟着浏览器时区走`,
      (await text(page, 'zone')) === 'Asia/Shanghai',
      await text(page, 'zone'),
    );
    check(`${name} 明确时区：没有页面错误`, !errors.length, errors);
    await browser.close();
  }
  {
    const { page, browser, mutations, errors } = await hydrateIn(
      kind,
      unset,
      unsetHtml,
      'America/New_York',
    );
    check(`${name} 没设时区：接管本身 0 DOM 改动`, mutations.during === 0, mutations);
    check(
      `${name} 没设时区：挂载后换成浏览器时区`,
      (await text(page, 'zone')) === 'America/New_York',
      await text(page, 'zone'),
    );
    check(
      `${name} 没设时区：时刻更新成用户时区`,
      (await text(page, 'instant')) === '2026/10/31 12:30',
      await text(page, 'instant'),
    );
    check(
      `${name} 没设时区：只改用到时区的绑定`,
      mutations.targets.every((id) => id === 'instant' || id === 'zone'),
      mutations.targets,
    );
    check(
      `${name} 没设时区：纯日期不变`,
      (await text(page, 'plain')) === '2026年10月31日',
      await text(page, 'plain'),
    );
    check(`${name} 没设时区：没有页面错误`, !errors.length, errors);
    await browser.close();
  }
}

// 主题：服务端输出样式，水合不改 DOM，颜色对得上
{
  const themed = `
import { flushSync, hydrate, renderToString } from 'hiltkit';
import { create, renderStyleTag } from 'hiltkit/css';
import { Button, Provider, navyTheme } from '@hiltkit/ui';
const styles = create({ box: { backgroundColor: '_surface', color: '_text', padding: '_md' } });
const view = () => <Provider timeZone="UTC" theme={navyTheme}><main id="box" sx={styles.box}><Button id="go" variant="primary">保存</Button></main></Provider>;
export const html = () => { const body = renderToString(view); return { body, head: renderStyleTag(body) }; };
globalThis.adopt = (host) => hydrate(view, host);
globalThis.flush = flushSync;
`;
  const { body, head } = (await load(themed)).html();
  check(
    '主题：服务端输出 data-theme 和样式',
    body.includes('data-theme="navy"') && head.includes('--hk-colors-surface'),
    head.slice(0, 200),
  );
  for (const [name, kind] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    const browser = await kind.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      `<!doctype html><html><head>${head}</head><body><div id="host">${body}</div></body></html>`,
    );
    const before = await page.evaluate(
      () => getComputedStyle(document.getElementById('box')).backgroundColor,
    );
    await page.addScriptTag({ content: await bundle(themed) });
    const result = await page.evaluate(async () => {
      const host = document.getElementById('host');
      const records = [];
      const observer = new MutationObserver((list) => records.push(...list));
      observer.observe(host, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      globalThis.adopt(host);
      await new Promise((resolve) => setTimeout(resolve, 30));
      globalThis.flush();
      records.push(...observer.takeRecords());
      const go = document.getElementById('go');
      return {
        mutations: records.length,
        color: getComputedStyle(go).backgroundColor,
        page: document.documentElement.style.backgroundColor,
      };
    });
    check(`${name} 主题：接管前样式已经生效`, before === 'rgb(12, 36, 68)', before);
    check(`${name} 主题：水合 0 DOM 改动`, result.mutations === 0, result);
    check(`${name} 主题：组件用上主题的颜色`, result.color === 'rgb(62, 155, 255)', result);
    check(`${name} 主题：挂载后设页面底色`, result.page === 'rgb(7, 26, 51)', result);
    check(`${name} 主题：没有页面错误`, !errors.length, errors);
    await browser.close();
  }
}

// token 短写：类型上只要导入过组件库就能写，运行时也要成立，token 模块不能被摇掉
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({
    content: await bundle(`import { mount } from 'hiltkit';
import { create } from 'hiltkit/css';
import { Provider } from '@hiltkit/ui';
const styles = create({ box: { paddingBlock: '_md', color: '_text' } });
mount(() => <Provider><main id="box" sx={styles.box} /></Provider>, document.body);`),
  });
  const padding = await page.evaluate(() => {
    const box = document.getElementById('box');
    return box && getComputedStyle(box).paddingBlockStart;
  });
  check('token 短写：只用 Provider 时也生效', padding === '12px' && !errors.length, {
    padding,
    errors,
  });
  await browser.close();
  // 构建产物走另一条 sideEffects 路径，单独确认
  const built = await build({
    stdin: {
      contents: `import { Provider } from '../../dist/index.js'; console.log(Provider);`,
      resolveDir: here('.'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    logLevel: 'silent',
  });
  check('token 短写：构建产物里 token 模块没被摇掉', built.outputFiles[0].text.includes('#1A5CAD'));
}

// 弹层：进场有过渡；离场的过渡只记录，不是所有浏览器都支持
for (const [name, kind] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  const browser = await kind.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({
    content: await bundle(`import { mount } from 'hiltkit';
import { transitions } from '@hiltkit/ui';
mount(() => <dialog id="d" sx={[transitions.fade, transitions.backdrop]}>x</dialog>, document.body);`),
  });
  const result = await page.evaluate(async () => {
    const dialog = document.getElementById('d');
    dialog.showModal();
    const entering = dialog.getAnimations().length;
    await Promise.allSettled(dialog.getAnimations().map((item) => item.finished));
    const opened = getComputedStyle(dialog).opacity;
    dialog.close();
    const leaving = dialog.getAnimations().length;
    return { entering, opened, leaving };
  });
  check(
    `${name} 弹框：进场有过渡，结束后完全显示`,
    result.entering > 0 && result.opened === '1',
    result,
  );
  console.log(`     ${name} 离场过渡数：${result.leaving}`);
  await browser.close();
}

// 调试内核收到问题
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({
    content: await bundle(`import 'hiltkit/devtools';
import { mount } from 'hiltkit';
import { Provider, useLocale } from '@hiltkit/ui';
function Page() { const { locale } = useLocale(); return <p>{locale}</p>; }
mount(() => <Provider locale="not_a_locale"><Page /></Provider>, document.body);`),
  });
  const issues = await page.evaluate(() =>
    window.__HILT_DEVTOOLS__.call('issues', { code: 'HILT005' }),
  );
  check(
    '调试工具的问题清单里有 HILT005',
    issues.result.total === 1 && issues.result.issues[0].message.includes('not_a_locale'),
    issues,
  );
  await browser.close();
}

// 摇树：只用 Button 时，语言相关的代码不进包
const size = async (source) => {
  const code = await bundle(source, { minify: true });
  return { code, gzip: gzipSync(code).length };
};
const baseline = await size(`import { mount } from 'hiltkit'; mount(() => null, document.body);`);
const buttonOnly = await size(
  `import { mount } from 'hiltkit'; import { Button } from '@hiltkit/ui'; mount(() => <Button>x</Button>, document.body);`,
);
const withProvider = await size(
  `import { mount } from 'hiltkit'; import { Provider, useFormat } from '@hiltkit/ui'; function P(){const f=useFormat();return <p>{()=>f.number(1)}</p>} mount(() => <Provider locale="zh-CN"><P /></Provider>, document.body);`,
);
const withPack = await size(
  `import { mount } from 'hiltkit'; import { Provider } from '@hiltkit/ui'; import zhCN from '@hiltkit/ui/locale/zh-CN'; mount(() => <Provider locale="zh-CN" messages={zhCN} />, document.body);`,
);
console.log(
  `gzip：框架 ${baseline.gzip}，加 Button ${buttonOnly.gzip}，加 Provider ${withProvider.gzip}，再加语言包 ${withPack.gzip}`,
);
check(
  '只用 Button：语言代码摇掉',
  !/getCanonicalLocales|NumberFormat|ListFormat|RelativeTimeFormat/.test(buttonOnly.code),
  buttonOnly.gzip - baseline.gzip,
);
check('只用 Provider：语言包不进包', !withProvider.code.includes('关闭'), withProvider.gzip);
check('用语言包时才进包', withPack.code.includes('关闭'));

// 使用方：只走构建产物
try {
  execFileSync(
    process.execPath,
    [here('../../node_modules/typescript/bin/tsc'), '-p', here('../consumer/tsconfig.json')],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  check('使用方类型：正例通过，负例命中，声明合并生效', true);
} catch (error) {
  check('使用方类型', false, String(error.stdout).slice(0, 800));
}

console.log(`通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
