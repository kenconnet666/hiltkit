// 实验三：组件库预编译 → npm pack → 真实安装到应用 → Vite 开发服务器与生产构建 → 浏览器里验证。
//   node 03-publish/run.mjs
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { build, createServer } from 'vite';
import { hilt } from './packages/compiler/index.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const run = (command, cwd) => execSync(command, { cwd, stdio: 'pipe', encoding: 'utf8' });

// 1. 预编译 + 打包成 tarball
run('node build-lib.mjs', root);
const tarballs = join(root, '.tarballs');
rmSync(tarballs, { recursive: true, force: true });
mkdirSync(tarballs);
const pack = (name) => run(`npm pack --silent --pack-destination "${tarballs}"`, join(root, 'packages', name)).trim();
const runtimeTgz = pack('runtime');
const uiTgz = pack('ui');

// 2. 真实安装到一个隔离目录，不走 workspace、不走链接
function install(app) {
  const work = join(root, '.apps', app);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  cpSync(join(root, app), work, { recursive: true });
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({
      name: app,
      private: true,
      type: 'module',
      dependencies: {
        '@hilt/runtime': `file:${join(tarballs, runtimeTgz).replaceAll('\\', '/')}`,
        '@hilt/ui': `file:${join(tarballs, uiTgz).replaceAll('\\', '/')}`,
      },
    }),
  );
  run('npm install --silent --ignore-scripts --no-audit --no-fund --install-links', work);
  return work;
}

const results = {};
const browser = await chromium.launch();

async function withPage(url, fn) {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('request', (request) => requests.push(request.url()));
  const start = Date.now();
  await page.goto(url);
  const value = await fn(page, { errors, requests, ms: () => Date.now() - start });
  await page.close();
  return { value, errors, requests };
}

const check = (label, passed, detail) => {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
};

/** 功能断言：既跑开发服务器也跑生产构建 */
async function assertBehaviour(page) {
  const attr = (selector, name) => page.locator(selector).getAttribute(name);
  const flush = () => page.evaluate(() => window.api.flushSync());

  const cls = await attr('#merged', 'class');
  check('class 跨三层拼接（库内部 + 使用方）', cls === 'base btn btn-md user-class', cls);
  check('使用方的 data 属性透传到底层 button', (await attr('#merged', 'data-user')) === '1');
  check('库内部的 data-part 保留', (await attr('#merged', 'data-part')) === 'root');
  check('title 初值', (await attr('#merged', 'title')) === 'first');

  await page.evaluate(() => window.api.setTitle('second'));
  await flush();
  check('改 title 只走那一个键', (await attr('#merged', 'title')) === 'second');
  await page.evaluate(() => window.api.setTitle(undefined));
  await flush();
  check('title 变 undefined 后属性消失', (await attr('#merged', 'title')) === null);

  await page.evaluate(() => window.api.setExtra({ 'data-extra': 'yes', title: 'from-spread' }));
  await flush();
  check('动态 spread 的键出现', (await attr('#merged', 'data-extra')) === 'yes');
  check('动态 spread 盖过静态层', (await attr('#merged', 'title')) === 'from-spread');
  await page.evaluate(() => window.api.setExtra(null));
  await flush();
  check('动态 spread 的键消失', (await attr('#merged', 'data-extra')) === null);

  await page.click('#merged');
  await flush();
  const after = await page.evaluate(() => window.api.read());
  check('使用方事件执行、派生值更新', after.userClicks === 1 && after.doubled === 2, after);
  check('库内部事件也执行', (await attr('#merged', 'data-clicks')) === '1', await attr('#merged', 'data-clicks'));
  const label = await page.locator('#merged').innerText();
  check('使用方写的子节点随状态更新', label.includes('保存 1'), label);

  await page.click('#prevented');
  await flush();
  check('preventDefault 跳过库内部处理', (await attr('#prevented', 'data-clicks')) === '0', await attr('#prevented', 'data-clicks'));

  await page.evaluate(() => window.api.setLoading(true));
  await flush();
  check('受管属性跟着 prop', (await attr('#merged', 'aria-busy')) === 'true' && (await attr('#merged', 'disabled')) === '');
  check('加载态分支渲染，别的子节点没丢', (await page.locator('#merged .spinner').count()) === 1 && (await page.locator('#merged').innerText()).includes('保存 1'));
  await page.evaluate(() => window.api.setLoading(false));
  await flush();
  check('加载态分支卸载', (await page.locator('#merged .spinner').count()) === 0);

  await page.check('#sw input');
  await flush();
  const bound = await page.evaluate(() => window.api.read().on);
  check('双向绑定：子改父', bound === true, bound);
  check('父级界面跟着变', (await page.locator('#state').innerText()) === '开');
  await page.evaluate(() => window.api.setOn(false));
  await flush();
  check('双向绑定：父改子', (await page.locator('#sw input').isChecked()) === false);
  check('库内部派生的属性也变', (await attr('#sw span', 'data-state')) === 'off');

  check('列表初始 2 行', (await page.locator('#list li').count()) === 2);
  await page.evaluate(() => window.api.push('c'));
  await flush();
  const rows = await page.locator('#list li').allInnerTexts();
  check('deep 状态 push 后列表更新', rows.join() === 'a,b,c', rows);
}

// 3. 编译型应用
const compiledDir = install('app-compiled');
const server = await createServer({
  root: compiledDir,
  logLevel: 'silent',
  plugins: [hilt()],
  server: { port: 5310, strictPort: true },
  optimizeDeps: { include: [] },
});
const serverStart = performance.now();
await server.listen();
const ready = performance.now() - serverStart;
console.log('\n== 开发服务器 + 预编译组件库 ==');
const dev = await withPage('http://localhost:5310/', async (page, ctx) => {
  await page.waitForSelector('#merged');
  const firstPaint = ctx.ms();
  await assertBehaviour(page);
  return { firstPaint };
});
const uiSourceRequests = dev.requests.filter((url) => url.includes('@hilt') && !url.includes('.vite/deps'));
results.dev = {
  'server ready ms': +ready.toFixed(0),
  'first paint ms (cold, includes prebundle)': dev.value.firstPaint,
  requests: dev.requests.length,
  'requests to lib source (not prebundled)': uiSourceRequests.length,
  errors: dev.errors,
};
await server.close();

// 4. 生产构建
console.log('\n== 生产构建 ==');
const bundle = async (dir, plugins, rollupOptions) => {
  const output = await build({
    root: dir,
    logLevel: 'silent',
    plugins,
    build: { outDir: join(dir, 'dist'), emptyOutDir: true, minify: true, rollupOptions },
  });
  const chunks = (Array.isArray(output) ? output[0] : output).output.filter((item) => item.type === 'chunk');
  return chunks.map((chunk) => chunk.code).join('\n');
};
const compiledCode = await bundle(compiledDir, [hilt()]);
results.prod = {
  'app bundle bytes': compiledCode.length,
  'app bundle gzip': gzipSync(compiledCode).length,
  'NeverUsed tree-shaken': !compiledCode.includes('never used marker'),
};
const previewServer = await (await import('vite')).preview({
  root: compiledDir,
  logLevel: 'silent',
  build: { outDir: join(compiledDir, 'dist') },
  preview: { port: 5311, strictPort: true },
});
const prod = await withPage('http://localhost:5311/', async (page) => {
  await page.waitForSelector('#merged');
  await assertBehaviour(page);
});
results.prod.errors = prod.errors;
await previewServer.close();

// 5. 使用方完全不编译
console.log('\n== 使用方没有任何插件 ==');
const plainDir = install('app-plain');
const plainServer = await createServer({
  root: plainDir,
  logLevel: 'silent',
  server: { port: 5312, strictPort: true },
});
await plainServer.listen();
const plain = await withPage('http://localhost:5312/', async (page) => {
  await page.waitForSelector('#plain');
  const cls = await page.locator('#plain').getAttribute('class');
  check('无插件：组件库能渲染、class 合并', cls === 'base btn btn-md from-plain', cls);
  await page.evaluate(() => window.api.setTitle('changed'));
  await page.waitForFunction(() => document.querySelector('#plain').title === 'changed');
  check('无插件：手写 getter 的响应式能穿过组件库', true);
  await page.click('#plain');
  check('无插件：事件合并', (await page.evaluate(() => window.api.clicks())) === 1);
  return true;
});
results.plain = { errors: plain.errors };
await plainServer.close();

// 6. ABI 与版本错配：运行时升级（内部改动、加新导出）后不重新编译组件库
const uiDist = readFileSync(join(root, 'packages/ui/dist/index.js'), 'utf8');
const abi = [...uiDist.matchAll(/(\w+) as _hilt_\w+/g)].map((match) => match[1]);
const named = [...uiDist.matchAll(/import \{([^}]*)\} from '@hilt\/runtime'/g)].flatMap((match) => match[1].split(',').map((name) => name.trim()));
results.abi = { 'symbols imported by compiled lib': [...new Set([...abi, ...named])] };

console.log('\n== 指标 ==');
console.log(JSON.stringify(results, null, 2));
await browser.close();
void createRequire;
void dirname;
