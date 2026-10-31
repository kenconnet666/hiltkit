// node 12-dev/open.mjs <组件数> <方案,方案,…> [轮数=3]
// 工作区组件库的首开优化方案对比。每轮：冷启动（Vite 缓存、编译缓存全清）→ 首次打开 → 同会话再开 →
// 改库里的组件（首次改 / 稳态）→ 重启开发服务器（保留各种缓存）→ 再打开。
// 环境变量：OPEN_PROF=1 对冷启动首开期间的服务端主线程采样 CPU 并按包汇总；需要 HILT_PACKAGES 指向快照。
//
// 方案（除 base-chokidar 外，库目录都改由 Node 递归 fs.watch 监听、chokidar 不再扫它；原因见 results/12-dev-hmr.txt）：
//   base-chokidar  现状，Vite 默认的监听（chokidar 监听整个项目）
//   base           单线程编译，无缓存
//   pool4|8|16     编译派给 N 个 worker_threads
//   cache          按内容哈希把编译结果存磁盘（目录在项目根之外）
//   pool8-cache    线程池 + 磁盘缓存
//   optimize       工作区包交给 Vite 依赖预打包（optimizeDeps.include + rolldown 编译插件）
//   bundle         esbuild 打成一个文件，改动的文件以独立模块叠加（lib-bundle.mjs）
//   bundle-pool8   同上，打包时编译用线程池
//   bundle-cache   同上，打包时用磁盘缓存
//   direct         应用按组件文件直接引用，不经桶文件（只加载用到的 ~13 个模块；改变了应用的写法）
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLibBundle, bundleOutfile, libBundlePlugin } from './lib-bundle.mjs';
import { createCompilePool } from './compile-pool.mjs';
import { generate } from './gen.mjs';
import { nativeWatch } from './native-watch.mjs';
import { cachedCompile, hiltDev, here, launchBrowser, median, moduleIdOf, newStats, openOnce, profile, resolveAlias, runtimeDir, serve, sleep, summarizeProfile } from './common.mjs';

const COUNT = Number(process.argv[2] ?? 300);
const NAMES = (process.argv[3] ?? 'base').split(',');
const ROUNDS = Number(process.argv[4] ?? 3);
const HMR_EDITS = 7;
const PORT = 5431;
const root = here(`./.gen/open-${COUNT}`);
const compileCacheDir = here(`./.gen/open-${COUNT}-cc`);
const slash = (path) => path.replaceAll('\\', '/');

const VARIANTS = {
  'base-chokidar': { watch: 'chokidar' },
  base: {},
  pool4: { pool: 4 },
  pool8: { pool: 8 },
  pool16: { pool: 16 },
  cache: { cache: true },
  'pool8-cache': { pool: 8, cache: true },
  optimize: { optimize: true },
  bundle: { bundle: true },
  'bundle-pool8': { bundle: true, pool: 8 },
  'bundle-cache': { bundle: true, cache: true },
  direct: { appImport: 'direct' },
};

/** 页面里记下 #app-text 第一次出现的时间（相对导航开始），用来拆"网络结束 → 挂载完成" */
const pageInit = () => {
  performance.setResourceTimingBufferSize(100000);
  const observer = new MutationObserver(() => {
    if (document.getElementById('app-text')) {
      window.__mountedAt = performance.now();
      observer.disconnect();
    }
  });
  observer.observe(document, { childList: true, subtree: true });
};

/** 工作区包要在 node_modules 里有个入口（symlink 到源码目录，同 pnpm workspace），optimize 方案用 */
function linkWorkspacePackages(generated) {
  const modules = join(root, 'node_modules');
  const link = (name, target) => {
    mkdirSync(join(modules, name, '..'), { recursive: true });
    symlinkSync(target, join(modules, name), 'junction');
  };
  writeFileSync(join(generated.lib, 'package.json'), JSON.stringify({ name: '@big/ui', version: '1.0.0', type: 'module', main: 'index.ts' }));
  link('@big/ui', generated.lib);
  link('@hilt/runtime', runtimeDir);
  for (const [name, entry] of [['css', here('./css-entry.ts')], ['css-hot', here('../04-css/engine/hot.ts')]]) {
    const dir = join(modules, `@hilt-${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@hilt/${name}`, version: '0.0.0', type: 'module', main: 'index.ts' }));
    writeFileSync(join(dir, 'index.ts'), `export * from '${slash(entry)}';\n`);
    link(`@hilt/${name}`, dir);
  }
}

/** 预构建时编译库里的 .tsx（rolldown 插件） */
function rolldownCompilePlugin(stats) {
  const compileModule = cachedCompile(stats);
  return {
    name: 'hilt-compile',
    async transform(code, id) {
      const file = slash(id.split('?')[0]);
      if (!file.endsWith('.tsx') || file.includes('/node_modules/')) return null;
      return compileModule(code, file, moduleIdOf(file, slash(root)));
    },
  };
}

async function startServer(variant, generated) {
  const stats = newStats();
  const pool = variant.pool ? createCompilePool(variant.pool) : undefined;
  const compileOptions = { cacheDir: variant.cache ? compileCacheDir : undefined, compileFn: pool?.compile };
  const plugins = [];
  const useChokidar = variant.watch === 'chokidar';
  if (!useChokidar) plugins.push(nativeWatch({ dirs: [generated.lib] }));
  plugins.push(hiltDev(stats, compileOptions));
  let prepMs = 0;
  if (variant.bundle) {
    const outfile = bundleOutfile(root);
    prepMs = await buildLibBundle({ root, barrel: join(generated.lib, 'index.ts'), outfile, compileModule: cachedCompile(stats, compileOptions) });
    plugins.push(libBundlePlugin({ root, lib: generated.lib, outfile }));
  }
  const config = {
    root,
    // Vite 默认把缓存放在最近的 package.json 旁（这里是 experiments/node_modules/.vite），会跨轮复用预构建结果，所以放进每轮重建的 root
    cacheDir: join(root, '.vite-cache'),
    server: useChokidar ? undefined : { watch: { ignored: [`${slash(generated.lib)}/**`] } },
    plugins,
    resolve: { alias: variant.optimize ? [] : resolveAlias },
    optimizeDeps: variant.optimize
      ? { noDiscovery: true, include: ['@big/ui', '@hilt/runtime', '@hilt/css', '@hilt/css-hot'], rolldownOptions: { plugins: [rolldownCompilePlugin(stats)] } }
      : { noDiscovery: true, include: [] },
  };
  const { server, ready } = await serve(config, PORT);
  return { server, ready, prepMs, stats, pool };
}

/** 页面的网络与挂载时间线：什么时候开始请求模块、什么时候最后一个回来、什么时候挂载完，请求的并发 */
async function timeline(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('resource').filter((entry) => entry.initiatorType !== 'beacon');
    const events = entries.flatMap((entry) => [[entry.requestStart, 1], [entry.responseEnd, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let live = 0;
    let peak = 0;
    for (const [, delta] of events) peak = Math.max(peak, (live += delta));
    return {
      requests: entries.length,
      firstRequest: Math.min(...entries.map((entry) => entry.startTime)),
      lastResponse: Math.max(...entries.map((entry) => entry.responseEnd)),
      stalledMs: entries.reduce((sum, entry) => sum + Math.max(0, entry.requestStart - entry.startTime), 0),
      avgServerMs: entries.reduce((sum, entry) => sum + (entry.responseEnd - entry.requestStart), 0) / entries.length,
      peakConcurrent: peak,
      mountedAt: window.__mountedAt,
    };
  });
}

/** 改库里一个组件的文字，量到页面变化。value 要唯一 */
async function editComponent(page, file, original, id, value, timeout = 5000) {
  const start = performance.now();
  writeFileSync(file, original.replace('{label}{children}', `{label}改${value}{children}`));
  try {
    await page.waitForFunction(([target, text]) => document.getElementById(target).textContent.includes(text), [id, `改${value}`], { polling: 'raf', timeout });
  } catch {
    return null;
  }
  const ms = performance.now() - start;
  await sleep(200);
  return ms;
}

async function openAndMeasure(browser) {
  const opened = await openOnce(browser, PORT, { pageInit: `(${pageInit})();` });
  const info = await timeline(opened.page);
  return { ...opened, info };
}

async function runRound(browser, name, variant, round) {
  const generated = generate(root, COUNT, { appImport: variant.optimize ? '@big/ui' : (variant.appImport ?? 'barrel') });
  rmSync(compileCacheDir, { recursive: true, force: true });
  mkdirSync(compileCacheDir, { recursive: true });
  if (variant.optimize) linkWorkspacePackages(generated);
  const result = { name, round };

  // ---- 冷启动 ----
  let started = await startServer(variant, generated);
  result.ready = started.ready;
  result.prep = started.prepMs;
  const doOpen = () => openAndMeasure(browser);
  let cold;
  if (process.env.OPEN_PROF === '1' && round === 0) {
    const profiled = await profile(async () => void (cold = await doOpen()));
    const summary = summarizeProfile(profiled, { top: 8 });
    console.log(`  [CPU 采样 ${name}] 服务端主线程自身时间合计 ${summary.totalMs.toFixed(0)} ms\n    ${summary.groups.join('\n    ')}`);
  } else cold = await doOpen();
  Object.assign(result, { open: cold.ms, requests: cold.requests.length, errors: cold.errors.length, firstError: cold.errors[0], compiled: started.stats.compiled, compileMs: started.stats.compileMs, info: cold.info });
  const used = generated.used[1];
  result.rendered = (await cold.page.locator(`#${used}`).count()) === 1;
  result.poolReady = started.pool?.readyMs;
  await cold.context.close();

  const again = await doOpen();
  result.reopen = again.ms;
  await again.context.close();

  // ---- 改库里的组件：先在三个没碰过的文件上各改一次（首次改），再在同一个文件上连改（稳态）----
  const live = await doOpen();
  if (process.env.OPEN_DEBUG) {
    live.page.on('console', (message) => console.log('  [页面]', message.type(), message.text().slice(0, 300)));
    live.page.on('pageerror', (error) => console.log('  [页面错误]', error.message.slice(0, 300)));
  }
  const files = generated.used.slice(1, 4).map((id) => ({ id, file: generated.fileOf(id), original: readFileSync(generated.fileOf(id), 'utf8') }));
  let counter = round * 1000 + 1;
  const first = [];
  for (const { id, file, original } of files) first.push(await editComponent(live.page, file, original, id, counter++));
  const steady = [];
  for (let i = 0; i < HMR_EDITS; i++) steady.push(await editComponent(live.page, files[0].file, files[0].original, files[0].id, counter++));
  result.hmrFirst = first.every((ms) => ms !== null) ? median(first) : null;
  result.hmrSteady = steady.every((ms) => ms !== null) ? median(steady.slice(1)) : null;
  for (const { file, original } of files) writeFileSync(file, original);
  await live.context.close();
  await started.server.close();
  await started.pool?.close();

  // ---- 重启：保留 Vite 缓存和编译缓存 ----
  started = await startServer(variant, generated);
  const restarted = await doOpen();
  Object.assign(result, { restartReady: started.ready, restartPrep: started.prepMs, restartOpen: restarted.ms, restartRequests: restarted.requests.length, restartCompiled: started.stats.compiled, restartHits: started.stats.cacheHits });
  await restarted.context.close();
  await started.server.close();
  await started.pool?.close();
  return result;
}

const fmt = (value, digits = 0) => (value === null || value === undefined || Number.isNaN(value) ? '—' : value.toFixed(digits));
const browser = await launchBrowser();
for (const name of NAMES) if (!VARIANTS[name]) throw new Error(`未知方案 ${name}`);
const all = Object.fromEntries(NAMES.map((name) => [name, []]));
// 轮在外、方案在内：各方案交错执行，后台进程的干扰会均摊，而不是全砸在某一个方案上
for (let round = 0; round < ROUNDS; round++) {
  for (const name of NAMES) {
    try {
      const result = await runRound(browser, name, VARIANTS[name], round);
      all[name].push(result);
      console.log(`${name} #${round + 1}: 就绪 ${fmt(result.ready)}${result.poolReady ? `（线程池 ${fmt(result.poolReady)} 才全部就绪）` : ''}${result.prep ? `（含打包 ${fmt(result.prep)}）` : ''} 首开 ${fmt(result.open)} 请求 ${result.requests} 再开 ${fmt(result.reopen)} 首次改 ${fmt(result.hmrFirst)} 稳态改 ${fmt(result.hmrSteady)} | 重启 就绪 ${fmt(result.restartReady)} 打开 ${fmt(result.restartOpen)} 请求 ${result.restartRequests} 编译 ${result.restartCompiled} 命中 ${result.restartHits} | 渲染${result.rendered ? '成功' : '失败'} 报错 ${result.errors}${result.firstError ? ` (${result.firstError.slice(0, 160)})` : ''} | 网络 ${fmt(result.info.firstRequest)}→${fmt(result.info.lastResponse)} 挂载 ${fmt(result.info.mountedAt)} 并发峰值 ${result.info.peakConcurrent} 单请求均值 ${fmt(result.info.avgServerMs, 1)}`);
    } catch (error) {
      console.log(`${name} #${round + 1} 失败：${error.stack?.split('\n').slice(0, 4).join(' | ')}`);
    }
  }
}
await browser.close();

const pick = (rounds, key) => median(rounds.map((round) => round[key]).filter((value) => value !== null && value !== undefined));
const pickOrNull = (rounds, key) => (rounds.every((round) => round[key] !== null) ? pick(rounds, key) : null);
console.log(`\n===== 首开方案对比（${COUNT} 个组件，${ROUNDS} 轮中位数，HILT_PACKAGES=${process.env.HILT_PACKAGES ?? '默认'}；可能有后台进程干扰）=====`);
console.log('方案            就绪ms  打包ms  首开ms  请求数  再开ms  首次改ms  稳态改ms  重启就绪ms  重启打开ms  重启请求  冷启动编译数  编译ms');
for (const name of NAMES) {
  const rounds = all[name];
  if (!rounds.length) continue;
  console.log(`${name.padEnd(14)} ${fmt(pick(rounds, 'ready')).padStart(7)} ${fmt(pick(rounds, 'prep')).padStart(7)} ${fmt(pick(rounds, 'open')).padStart(7)} ${fmt(pick(rounds, 'requests')).padStart(7)} ${fmt(pick(rounds, 'reopen')).padStart(7)} ${fmt(pickOrNull(rounds, 'hmrFirst')).padStart(9)} ${fmt(pickOrNull(rounds, 'hmrSteady')).padStart(9)} ${fmt(pick(rounds, 'restartReady') + pick(rounds, 'restartPrep')).padStart(11)} ${fmt(pick(rounds, 'restartOpen')).padStart(11)} ${fmt(pick(rounds, 'restartRequests')).padStart(9)} ${fmt(pick(rounds, 'compiled')).padStart(12)} ${fmt(pick(rounds, 'compileMs')).padStart(7)}`);
}
