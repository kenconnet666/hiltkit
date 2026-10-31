// node 12-dev/run.mjs [组件数=300]：大型组件库下的开发效率。
// 两种用法：组件库是工作区源码（开发组件库本身、文档站），组件库是 npm 依赖（业务项目）。
// 量开发服务器就绪、首次打开、再次打开、请求数，以及各种改动的热更新延迟（写文件到页面变化）。
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { generate } from './gen.mjs';

const COUNT = Number(process.argv[2] ?? 300);
const HMR_ROUNDS = Number(process.argv[3] ?? 7);
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const root = here(`./.gen/${COUNT}`);
// 运行时和编译器所在目录。重写 03-publish/packages 期间用 HILT_PACKAGES 指向快照（如 03-publish/packages-v0）
const packagesDir = here(`../${process.env.HILT_PACKAGES ?? '03-publish/packages'}`);
const runtimeDir = join(packagesDir, 'runtime');
const { compile } = await import(pathToFileURL(join(packagesDir, 'compiler/index.mjs')).href);
const cssEntry = here('./css-entry.ts');
const engineDir = here('../04-css/engine');

const resolveAlias = [
  { find: '@hilt/runtime', replacement: join(runtimeDir, 'index.js') },
  { find: '@hilt/css-hot', replacement: join(engineDir, 'hot.ts') },
  { find: '@hilt/css', replacement: cssEntry },
];

/** 开发插件：按内容哈希缓存到磁盘（再次启动时没改过的文件不用重新编译） */
function hiltDev(stats, cacheDir) {
  let projectRoot;
  return {
    name: 'hilt-dev',
    enforce: 'pre',
    configResolved(config) {
      projectRoot = config.root;
    },
    async transform(code, id) {
      const file = id.split('?')[0];
      if (file.includes('node_modules') || !file.endsWith('.tsx')) return null;
      const moduleId = file.replace(projectRoot, '').replaceAll('\\', '/');
      const key = cacheDir && join(cacheDir, `${createHash('sha256').update(moduleId + code).digest('hex').slice(0, 20)}.js`);
      if (key && existsSync(key)) {
        stats.cacheHits++;
        return { code: readFileSync(key, 'utf8'), map: null };
      }
      const start = performance.now();
      const result = await compile(code, file, { hot: moduleId });
      stats.compileMs += performance.now() - start;
      stats.compiled++;
      if (key) writeFileSync(key, result.code);
      return result;
    },
  };
}

const browser = await chromium.launch();

async function openOnce(port) {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  const start = performance.now();
  await page.goto(`http://localhost:${port}/`, { timeout: 180000 });
  await page.waitForSelector('#app-text', { timeout: 180000 });
  const ms = performance.now() - start;
  return { page, ms, requests, errors };
}

async function serve(config, port) {
  const start = performance.now();
  const server = await createServer({ configFile: false, logLevel: process.env.HILT_LOG ?? 'silent', server: { port, strictPort: true }, ...config });
  await server.listen();
  return { server, ready: performance.now() - start };
}

// ================= 工作区源码 =================
console.log(`\n===== 组件库是工作区源码（${COUNT} 个组件）=====`);
const generated = generate(root, COUNT);
const cacheDir = join(root, '.hilt-cache');
mkdirSync(cacheDir, { recursive: true });
const sourceStats = { compiled: 0, compileMs: 0, cacheHits: 0 };
const baseConfig = {
  root,
  resolve: { alias: resolveAlias },
  optimizeDeps: { noDiscovery: true, include: [] },
};

let { server, ready } = await serve({ ...baseConfig, plugins: [hiltDev(sourceStats, cacheDir)] }, 5401);
const cold = await openOnce(5401);
console.log(`开发服务器就绪 ${ready.toFixed(0)} ms；首次打开 ${cold.ms.toFixed(0)} ms，${cold.requests.length} 个请求；编译 ${sourceStats.compiled} 个文件共 ${sourceStats.compileMs.toFixed(0)} ms（单线程，平均 ${(sourceStats.compileMs / sourceStats.compiled).toFixed(1)} ms/个）`);
check('页面没有报错', cold.errors.length === 0, cold.errors.slice(0, 3));
check('组件渲染出来', (await cold.page.locator(`#${generated.used[1]}`).count()) === 1);
await cold.page.close();

// 同一次开发会话里再开一个页面：Vite 的转换缓存命中
const again = await openOnce(5401);
console.log(`同一会话再次打开 ${again.ms.toFixed(0)} ms`);
await again.page.close();

// ---- 热更新 ----
console.log('\n--- 热更新（写文件到页面变化，多轮中位数）---');
const page = (await openOnce(5401)).page;
const hotLog = [];
await page.exposeFunction('__recordHot', (entry) => hotLog.push(entry));
await page.evaluate(() => {
  window.__hiltHot = (entry) => window.__recordHot(entry);
});
const requestsDuring = [];
page.on('request', (request) => requestsDuring.push(request.url()));
const reloads = [];
page.on('load', () => reloads.push(Date.now()));

const target = generated.used[1];
const targetFile = join(generated.lib, `${target}.tsx`);
const appFile = join(root, 'src/App.tsx');
const baseFile = join(generated.lib, 'base.tsx');
const original = { target: readFileSync(targetFile, 'utf8'), app: readFileSync(appFile, 'utf8'), base: readFileSync(baseFile, 'utf8') };

// 先攒一点状态：热更新之后要还在
await page.evaluate(() => window.__app.inc());
await page.evaluate(() => window.__app.inc());
await page.click(`#${target}`);
await page.waitForFunction((id) => document.getElementById(id).getAttribute('data-hits') === '2', target);
await page.waitForFunction(() => document.getElementById('app-root').getAttribute('data-count') === '2');
await page.evaluate((id) => {
  window.__marker = { sibling: document.getElementById('app-text'), root: document.getElementById('app-root'), target: document.getElementById(id) };
}, target);

async function measure(label, mutate, restore, ready) {
  const times = [];
  const modules = [];
  for (let round = 0; round < HMR_ROUNDS; round++) {
    requestsDuring.length = 0;
    const value = `${round}`;
    const start = performance.now();
    mutate(value);
    await ready(value);
    times.push(performance.now() - start);
    await new Promise((resolve) => setTimeout(resolve, 80));
    modules.push(requestsDuring.filter((url) => !url.includes('hot-update.json') && !url.includes('@vite')).length);
  }
  restore();
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log(`${label}：${median(times).toFixed(0)} ms（最快 ${Math.min(...times).toFixed(0)}，最慢 ${Math.max(...times).toFixed(0)}），每次重新请求 ${median(modules)} 个模块`);
  return median(times);
}

hotLog.length = 0;
const styleMs = await measure(
  '改样式值（组件库里的一个组件）',
  (value) => writeFileSync(targetFile, original.target.replace("padding: '4px'", `padding: '${10 + Number(value)}px'`)),
  () => writeFileSync(targetFile, original.target),
  (value) => page.waitForFunction(([id, px]) => getComputedStyle(document.getElementById(id)).paddingTop === px, [target, `${10 + Number(value)}px`], { polling: 'raf' }),
);
check('改样式：热更新记的全是样式，没有组件重建', hotLog.length > 0 && hotLog.every((entry) => entry.kind === 'style'), hotLog.slice(0, 4));
const afterStyle = await page.evaluate((id) => ({
  count: window.__app.count,
  sameTarget: window.__marker.target === document.getElementById(id),
  hits: document.getElementById(id).getAttribute('data-hits'),
}), target);
check('改样式：元素没换，组件自己的状态还在', afterStyle.sameTarget && afterStyle.hits === '2', afterStyle);
check('改样式：没有整页刷新', reloads.length === 0, reloads.length);

hotLog.length = 0;
const compMs = await measure(
  '改组件代码（组件库里的一个组件）',
  (value) => writeFileSync(targetFile, original.target.replace('{label}{children}', `{label}改${value}{children}`)),
  () => writeFileSync(targetFile, original.target),
  (value) => page.waitForFunction(([id, text]) => document.getElementById(id).textContent.includes(text), [target, `改${value}`], { polling: 'raf' }),
);
check('改组件：只重建了它的实例', hotLog.length > 0 && hotLog.every((entry) => entry.kind === 'component' && entry.rebuilt >= 1 && entry.rebuilt <= 2), hotLog.slice(0, 4));
const afterComponent = await page.evaluate((id) => ({
  appCount: window.__app.count,
  sameSibling: window.__marker.sibling === document.getElementById('app-text'),
  sameRoot: window.__marker.root === document.getElementById('app-root'),
  sameTarget: window.__marker.target === document.getElementById(id),
  hits: document.getElementById(id).getAttribute('data-hits'),
}), target);
check('改组件：上层和兄弟的元素、状态都没动', afterComponent.appCount === 2 && afterComponent.sameSibling && afterComponent.sameRoot, afterComponent);
console.log(`info 改组件后：被改组件自己的状态 data-hits=${afterComponent.hits}（重建后归零，同 Svelte、Vue 的组件重载）`);
check('改组件：没有整页刷新', reloads.length === 0, reloads.length);

hotLog.length = 0;
const appMs = await measure(
  '改应用页面',
  (value) => writeFileSync(appFile, original.app.replace('应用文字', `应用文字${value}`)),
  () => writeFileSync(appFile, original.app),
  (value) => page.waitForFunction((text) => document.getElementById('app-text').textContent === text, `应用文字${value}`, { polling: 'raf' }),
);

// 基础模块里既有组件又有导出的函数：只改组件不该连锁，改函数才连锁
const partClass = (value) => original.base.replace('class="part"', `class="part${value}"`);
await page.evaluate((id) => {
  const box = document.getElementById(id);
  // 让 Part 出现：改一个有 Part 的组件不方便，这里只看热更新记录
  window.__rootBefore = box;
}, target);
hotLog.length = 0;
const reloadsBefore = reloads.length;
const baseTimes = [];
const baseRequests = [];
for (let round = 0; round < HMR_ROUNDS; round++) {
  requestsDuring.length = 0;
  const start = performance.now();
  const seen = hotLog.length;
  writeFileSync(baseFile, partClass(round));
  while (hotLog.length === seen) await new Promise((resolve) => setTimeout(resolve, 2));
  baseTimes.push(performance.now() - start);
  await new Promise((resolve) => setTimeout(resolve, 150));
  baseRequests.push(requestsDuring.filter((url) => !url.includes('hot-update.json') && !url.includes('@vite')).length);
}
writeFileSync(baseFile, original.base);
await new Promise((resolve) => setTimeout(resolve, 400));
console.log(`改基础模块里的组件：${median(baseTimes).toFixed(0)} ms，每次重新请求 ${median(baseRequests)} 个模块`);
check('基础模块只改组件：不连锁到导入它的组件', median(baseRequests) === 1, baseRequests);
check('基础模块只改组件：没有整页刷新', reloads.length === reloadsBefore, reloads.length - reloadsBefore);

// 改基础模块导出的函数：导入方拿着旧函数，必须重新执行。量连锁的代价
hotLog.length = 0;
const hookTimes = [];
const hookRequests = [];
for (let round = 0; round < Math.min(HMR_ROUNDS, 3); round++) {
  requestsDuring.length = 0;
  const seen = hotLog.length;
  const start = performance.now();
  writeFileSync(baseFile, original.base.replace("options.size ?? 'md'", `options.size ?? 'md' /* ${round} */`));
  while (hotLog.length === seen) await new Promise((resolve) => setTimeout(resolve, 2));
  await new Promise((resolve) => setTimeout(resolve, 400));
  hookTimes.push(performance.now() - start - 400);
  hookRequests.push(requestsDuring.filter((url) => !url.includes('hot-update.json') && !url.includes('@vite')).length);
}
writeFileSync(baseFile, original.base);
await new Promise((resolve) => setTimeout(resolve, 600));
console.log(`改基础模块导出的函数（所有组件都用它）：约 ${median(hookTimes).toFixed(0)} ms 开始生效，连锁请求 ${median(hookRequests)} 个模块，整页刷新 ${reloads.length - reloadsBefore} 次`);

// 入口文件有顶层 mount：不能自己接住，要整页刷新，不能挂载第二份
const entryFile = join(root, 'src/main.tsx');
const entryOriginal = readFileSync(entryFile, 'utf8');
await Promise.all([page.waitForEvent('load'), (async () => writeFileSync(entryFile, `${entryOriginal}\n// 改了入口\n`))()]);
await page.waitForSelector('#app-text');
check('改入口文件：整页刷新，没有挂载第二份', (await page.locator('#app-root').count()) === 1, await page.locator('#app-root').count());
writeFileSync(entryFile, entryOriginal);
await page.waitForEvent('load');await page.close();
await server.close();

// 再次启动：磁盘编译缓存
sourceStats.compiled = 0;
sourceStats.compileMs = 0;
sourceStats.cacheHits = 0;
({ server, ready } = await serve({ ...baseConfig, plugins: [hiltDev(sourceStats, cacheDir)] }, 5401));
const warm = await openOnce(5401);
console.log(`\n重启开发服务器（磁盘缓存）：就绪 ${ready.toFixed(0)} ms；打开 ${warm.ms.toFixed(0)} ms；命中缓存 ${sourceStats.cacheHits} 个，重新编译 ${sourceStats.compiled} 个`);
await warm.page.close();
await server.close();

// ================= npm 依赖 =================
console.log(`\n===== 组件库是 npm 依赖（${COUNT} 个组件）=====`);
const appRoot = join(root, 'as-dependency');
rmSync(appRoot, { recursive: true, force: true });
mkdirSync(join(appRoot, 'src'), { recursive: true });
const modules = join(appRoot, 'node_modules');
// 运行时
mkdirSync(join(modules, '@hilt'), { recursive: true });
cpSync(runtimeDir, join(modules, '@hilt/runtime'), { recursive: true });
// 样式引擎：打包成一个文件发布
mkdirSync(join(modules, '@hilt/css'), { recursive: true });
await esbuild({ entryPoints: [cssEntry], bundle: true, format: 'esm', platform: 'browser', external: ['alien-signals'], outfile: join(modules, '@hilt/css/index.js'), logLevel: 'silent' });
writeFileSync(join(modules, '@hilt/css/package.json'), JSON.stringify({ name: '@hilt/css', version: '0.1.0', type: 'module', sideEffects: false, exports: './index.js' }));
// 组件库：逐文件预编译，保留模块结构（同 tsdown、rollup preserveModules）
const dist = join(modules, '@big/ui/dist');
mkdirSync(dist, { recursive: true });
const publishStart = performance.now();
for (const file of readdirSync(generated.lib)) {
  const source = join(generated.lib, file);
  if (file.endsWith('.tsx')) {
    const { code } = await compile(readFileSync(source, 'utf8'), source);
    writeFileSync(join(dist, file.replace('.tsx', '.js')), code.replace(/from '\.\/([^']+)'/g, "from './$1.js'"));
  } else {
    writeFileSync(join(dist, file.replace('.ts', '.js')), readFileSync(source, 'utf8').replace(/from '\.\/([^']+)'/g, "from './$1.js'"));
  }
}
const publishMs = performance.now() - publishStart;
writeFileSync(join(modules, '@big/ui/package.json'), JSON.stringify({ name: '@big/ui', version: '1.0.0', type: 'module', sideEffects: false, exports: { '.': './dist/index.js' }, peerDependencies: { '@hilt/runtime': '*', '@hilt/css': '*' } }));
const usedInApp = generated.used;
writeFileSync(
  join(appRoot, 'src/App.tsx'),
  `import { ${usedInApp.join(', ')} } from '@big/ui';

export const App = _component(() => {
  let count = _state(0);
  window.__app = { get count() { return count; }, inc: () => count++ };
  return (
    <main id="app-root" data-count={count}>
      <p id="app-text">应用文字</p>
${usedInApp.map((name) => `      <${name} id="${name}" />`).join('\n')}
    </main>
  );
});
`,
);
writeFileSync(join(appRoot, 'src/main.tsx'), `import { mount } from '@hilt/runtime';\nimport { App } from './App';\n\nmount(() => <App />, document.getElementById('app'));\n`);writeFileSync(join(appRoot, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.tsx"></script></body></html>');
console.log(`组件库发布时编译 ${COUNT} 个组件：${publishMs.toFixed(0)} ms（只在发布时发生一次，使用方不用）`);

const depStats = { compiled: 0, compileMs: 0, cacheHits: 0 };
const depConfig = { root: appRoot, plugins: [hiltDev(depStats)], resolve: { alias: [{ find: '@hilt/css-hot', replacement: join(modules, '@hilt/css/index.js') }] }, optimizeDeps: { noDiscovery: true, include: ['@big/ui', '@hilt/runtime', '@hilt/css'] } };
({ server, ready } = await serve(depConfig, 5402));
const depCold = await openOnce(5402);
const libRequests = depCold.requests.filter((url) => url.includes('@big') && !url.includes('.vite/deps'));
console.log(`开发服务器就绪 ${ready.toFixed(0)} ms；首次打开（含预构建）${depCold.ms.toFixed(0)} ms，${depCold.requests.length} 个请求，其中组件库源文件 ${libRequests.length} 个；使用方编译 ${depStats.compiled} 个文件`);
check('页面没有报错', depCold.errors.length === 0, depCold.errors.slice(0, 3));
check('组件渲染出来，样式生效', (await depCold.page.evaluate((id) => getComputedStyle(document.getElementById(id)).display, usedInApp[1])) === 'inline-flex');
const depPage = depCold.page;
const depFile = join(appRoot, 'src/App.tsx');
const depOriginal = readFileSync(depFile, 'utf8');
const depTimes = [];
const depRequests = [];
depPage.on('pageerror', (error) => console.log('pageerror', error.message));
depPage.on('console', (message) => process.env.HILT_LOG ? console.log('console', message.text()) : message.type() === 'error' && console.log('console', message.text()));
depPage.on('request', (request) => depRequests.push(request.url()));
for (let round = 0; round < HMR_ROUNDS; round++) {
  const start = performance.now();
  writeFileSync(depFile, depOriginal.replace('应用文字', `应用文字${round}`));
  await depPage.waitForFunction((text) => document.getElementById('app-text').textContent === text, `应用文字${round}`, { polling: 'raf' });
  depTimes.push(performance.now() - start);
  // 连续写同一个文件时，文件监听会合并事件，留点间隔（真实保存也不会这么密）
  await new Promise((resolve) => setTimeout(resolve, 120));
}
writeFileSync(depFile, depOriginal);
console.log(`改业务页面的热更新：${median(depTimes).toFixed(0)} ms`);
await depPage.close();
await server.close();
({ server, ready } = await serve(depConfig, 5402));
const depWarm = await openOnce(5402);
console.log(`重启（预构建缓存）：就绪 ${ready.toFixed(0)} ms；打开 ${depWarm.ms.toFixed(0)} ms，${depWarm.requests.length} 个请求`);
await depWarm.page.close();
await server.close();

await browser.close();
console.log(`\n汇总：改样式 ${styleMs.toFixed(0)} ms，改组件 ${compMs.toFixed(0)} ms，改页面 ${appMs.toFixed(0)} ms`);
void dirname;
