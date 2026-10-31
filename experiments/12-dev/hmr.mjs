// node 12-dev/hmr.mjs [组件数=300] [每轮样本数=12] [轮数=3] [运行时变体=baseline|bucketed]
// 环境变量：HMR_WATCH=chokidar|native（文件监听，默认 chokidar 即 Vite 默认）、HMR_LAYOUT=flat|folders（组件库目录布局）、
//          HMR_CACHE=1（编译结果缓存到 root 内目录，同 run.mjs）、HMR_GAP=毫秒（两次改动的间隔，默认 150，同 run.mjs 的节奏）
// 把热更新延迟拆段：写文件 → Vite 文件监听 → hotUpdate 钩子 → hot.send → 浏览器收到 ws
//   → 浏览器请求新模块 → 服务端返回 → hotCommit 开始（模块执行完）→ hotCommit 结束 → 页面可见。
// 服务端和页面的时间戳同一条时间轴（performance.timeOrigin + performance.now()），可以直接相减。
// 需要 HILT_PACKAGES 指向快照（见 common.mjs）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from './gen.mjs';
import { nativeWatch } from './native-watch.mjs';
import { hiltDev, here, launchBrowser, median, newStats, now, openOnce, pageProbe, resolveAlias, runtimeProbePlugin, serve, sleep } from './common.mjs';

const COUNT = Number(process.argv[2] ?? 300);
const SAMPLES = Number(process.argv[3] ?? 12);
const RUNS = Number(process.argv[4] ?? 3);
const VARIANT = process.argv[5] ?? 'baseline';
const WATCH = process.env.HMR_WATCH ?? 'chokidar';
const LAYOUT = process.env.HMR_LAYOUT ?? 'flat';
const CACHE = process.env.HMR_CACHE === '1';
const GAP = Number(process.env.HMR_GAP ?? 150);
const TAG = `${COUNT}-${VARIANT}-${WATCH}-${LAYOUT}${CACHE ? '-cache' : ''}${GAP === 150 ? '' : `-gap${GAP}`}`;
const root = here(`./.gen/hmr-${COUNT}`);
const PORT = 5411;

/** 服务端探针：记监听事件、hotUpdate 钩子、hot.send、模块请求的起止 */
function serverProbe(log) {
  return {
    name: 'server-probe',
    configureServer(server) {
      server.watcher.on('change', (file) => log.watcher.push({ file, t: now() }));
      // Vite 内部几步的起止（watchChange → moduleGraph.onFileChange → hotUpdate），用来定位 vite-pre-hook 里的耗时
      const container = server.environments.client.pluginContainer;
      const watchChange = container.watchChange.bind(container);
      container.watchChange = async (...args) => {
        const start = now();
        try {
          return await watchChange(...args);
        } finally {
          log.inner.push({ name: 'watchChange', start, end: now() });
        }
      };
      // 每个插件自己的 watchChange 耗时（累计到 log.plugin），定位谁慢
      for (const plugin of server.environments.client.plugins) {
        const hook = plugin.watchChange;
        if (!hook) continue;
        const fn = typeof hook === 'function' ? hook : hook.handler;
        const wrapped = async function (...args) {
          const start = now();
          try {
            return await fn.apply(this, args);
          } finally {
            log.plugin[plugin.name] = (log.plugin[plugin.name] ?? 0) + (now() - start);
            log.pluginSeq.push([plugin.name, now() - start]);
          }
        };
        if (typeof hook === 'function') plugin.watchChange = wrapped;
        else hook.handler = wrapped;
      }
      const graph = server.environments.client.moduleGraph;
      const onFileChange = graph.onFileChange.bind(graph);
      graph.onFileChange = (...args) => {
        const start = now();
        try {
          return onFileChange(...args);
        } finally {
          log.inner.push({ name: 'onFileChange', start, end: now() });
        }
      };
      const hot = server.environments.client.hot;
      const send = hot.send.bind(hot);
      hot.send = (payload, ...rest) => {
        if (payload?.type === 'update' || payload?.type === 'full-reload') log.send.push({ type: payload.type, t: now() });
        return send(payload, ...rest);
      };
      server.middlewares.use((req, res, next) => {
        const start = now();
        if (req.url.includes('?t=') || req.url.includes('&t=')) res.on('finish', () => log.requests.push({ url: req.url, start, end: now() }));
        next();
      });
    },
    hotUpdate: { order: 'pre', handler: ({ file }) => void log.hotUpdate.push({ file, t: now() }) },
  };
}

const browser = await launchBrowser();
const pageInit = () => {
  performance.setResourceTimingBufferSize(100000);
};
const results = { style: [], component: [], page: [] };

for (let run = 0; run < RUNS; run++) {
  const generated = generate(root, COUNT, { layout: LAYOUT });
  mkdirSync(join(root, '.hilt-cache'), { recursive: true });
  const log = { watcher: [], hotUpdate: [], send: [], requests: [], inner: [], plugin: {}, pluginSeq: [] };
  const stats = newStats();
  const { server, ready } = await serve(
    {
      root,
      server: WATCH === 'native' ? { watch: { ignored: [`${generated.lib.replaceAll(String.fromCharCode(92), '/')}/**`] } } : undefined,
      resolve: { alias: resolveAlias },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [...(WATCH === 'native' ? [nativeWatch({ dirs: [generated.lib] })] : []), runtimeProbePlugin({ variant: VARIANT }), hiltDev(stats, { cacheDir: CACHE ? join(root, '.hilt-cache') : undefined }), serverProbe(log)],
    },
    PORT,
  );
  const opened = await openOnce(browser, PORT, { pageInit: [pageProbe, pageInit].map((fn) => `(${fn})();`).join('\n') });
  // 等 Vite 把后台预转换做完、页面空闲
  await sleep(1500);
  const { page } = opened;
  const target = generated.used[1];
  const targetFile = generated.fileOf(target);
  const appFile = join(root, 'src/App.tsx');
  const original = { target: readFileSync(targetFile, 'utf8'), app: readFileSync(appFile, 'utf8') };
  const edits = {
    style: { file: targetFile, source: original.target, mutate: (n) => original.target.replace("padding: '4px'", `padding: '${10 + (n % 30)}px'`), done: ([id, n]) => getComputedStyle(document.getElementById(id)).paddingTop === `${10 + (n % 30)}px`, args: (n) => [target, n] },
    component: { file: targetFile, mutate: (n) => original.target.replace('{label}{children}', `{label}改${n}{children}`), done: ([id, n]) => document.getElementById(id).textContent.includes(`改${n}`), args: (n) => [target, n] },
    page: { file: appFile, mutate: (n) => original.app.replace('应用文字', `应用文字${n}`), done: ([, n]) => document.getElementById('app-text').textContent === `应用文字${n}`, args: (n) => [target, n] },
  };

  let counter = 1;
  for (const [kind, edit] of Object.entries(edits)) {
    // 预热 3 次不计入（首次 import 新 URL、JIT）
    for (let i = 0; i < SAMPLES + 3; i++) {
      const n = counter++;
      const marks = { inner: log.inner.length, watcher: log.watcher.length, hotUpdate: log.hotUpdate.length, send: log.send.length, requests: log.requests.length };
      const before = await page.evaluate(() => ({ ws: window.__t.ws.length, commits: window.__t.commits.length, commitMs: (window.__t.commitMs ?? []).length }));
      const t0 = now();
      writeFileSync(edit.file, edit.mutate(n));
      const t1 = now();
      await page.waitForFunction(`(${edit.done})(${JSON.stringify(edit.args(n))})`, undefined, { polling: 'raf', timeout: 30000 });
      const tDone = now();
      await sleep(GAP);
      const pageSide = await page.evaluate(
        ([before, fileName]) => {
          const t = window.__t;
          const modules = performance.getEntriesByType('resource').filter((entry) => entry.name.includes(fileName) && entry.name.includes('t='));
          const last = modules.at(-1);
          const epoch = (value) => performance.timeOrigin + value;
          return {
            ws: t.ws.slice(before.ws),
            commits: t.commits.slice(before.commits),
            commitMs: (t.commitMs ?? []).slice(before.commitMs),
            module: last && { requestStart: epoch(last.requestStart), responseStart: epoch(last.responseStart), responseEnd: epoch(last.responseEnd), transfer: last.transferSize },
          };
        },
        [before, kind === 'page' ? 'App.tsx' : `${target}.tsx`],
      );
      if (i < 3) continue;
      const watcher = log.watcher.slice(marks.watcher).find((entry) => entry.file.replaceAll('\\', '/').endsWith(edit.file.replaceAll('\\', '/').split('/').at(-1)));
      const hotUpdate = log.hotUpdate[marks.hotUpdate];
      const send = log.send[marks.send];
      const request = log.requests.slice(marks.requests).find((entry) => entry.url.includes(kind === 'page' ? 'App.tsx' : `${target}.tsx`));
      const ws = pageSide.ws[0];
      const commit = pageSide.commits.at(-1);
      if (!(watcher && hotUpdate && send && request && ws && commit && pageSide.module)) {
        console.log('缺数据，跳过样本', kind, { watcher: !!watcher, hotUpdate: !!hotUpdate, send: !!send, request: !!request, ws: !!ws, commit: !!commit, module: !!pageSide.module });
        continue;
      }
      const commitMs = pageSide.commitMs.at(-1);
      const commitStart = commit.t - commitMs;
      results[kind].push({
        run,
        total: tDone - t0,
        write: t1 - t0,
        watch: watcher.t - t1,
        'vite-pre-hook': hotUpdate.t - watcher.t,
        'vite-update': send.t - hotUpdate.t,
        'ws-transit': ws.t - send.t,
        'client-to-request': pageSide.module.requestStart - ws.t,
        'server-respond': pageSide.module.responseEnd - pageSide.module.requestStart,
        'server-handle': request.end - request.start,
        'exec-to-commit': commitStart - pageSide.module.responseEnd,
        'inner-watchChange': (log.inner.slice(marks.inner).find((e) => e.name === 'watchChange')?.end ?? NaN) - (log.inner.slice(marks.inner).find((e) => e.name === 'watchChange')?.start ?? NaN),
        'inner-onFileChange': (log.inner.slice(marks.inner).find((e) => e.name === 'onFileChange')?.end ?? NaN) - (log.inner.slice(marks.inner).find((e) => e.name === 'onFileChange')?.start ?? NaN),
        'wc-end-to-hotUpdate': hotUpdate.t - (log.inner.slice(marks.inner).find((e) => e.name === 'onFileChange')?.end ?? NaN),
        'watcher-events': log.watcher.slice(marks.watcher).filter((e) => e.file.endsWith(edit.file.split(/[\/]/).at(-1))).length,
        commit: commitMs,
        'commit-to-visible': tDone - commit.t,
      });
    }
    await sleep(300);
  }
  // 校准：commit 里全表扫描那一步单独量
  const calibration = await page.evaluate(([id]) => window.__t.calibrate?.(id, 2000), [`/src/lib/${LAYOUT === 'folders' ? `${target}/` : ''}${target}.tsx`]);
  for (const [name, ms] of Object.entries(log.plugin)) (results.plugin ??= {})[name] = (results.plugin[name] ?? 0) + ms;
  results.calibration = [...(results.calibration ?? []), calibration];
  await opened.context.close();
  await server.close();
  // 每轮复原源文件由下一轮 generate 重建
  void ready;
}
await browser.close();

const lines = [];
const out = (text) => {
  console.log(text);
  lines.push(text);
};
out(`\n===== HMR 拆段（${COUNT} 个组件，运行时 ${VARIANT}，监听 ${WATCH}，布局 ${LAYOUT}，缓存 ${CACHE ? '写入 root 内' : '无'}，间隔 ${GAP} ms，${RUNS} 轮 × ${SAMPLES} 样本，HILT_PACKAGES=${process.env.HILT_PACKAGES ?? '默认'}；可能有后台进程干扰）=====`);
const keys = ['total', 'inner-watchChange', 'inner-onFileChange', 'wc-end-to-hotUpdate', 'watcher-events', 'watch', 'vite-pre-hook', 'vite-update', 'ws-transit', 'client-to-request', 'server-respond', 'server-handle', 'exec-to-commit', 'commit', 'commit-to-visible'];
for (const kind of ['style', 'component', 'page']) {
  const samples = results[kind];
  out(`\n--- 改${{ style: '样式', component: '组件', page: '页面' }[kind]}（${samples.length} 个有效样本）中位数 ms ---`);
  out(keys.map((key) => `${key}=${median(samples.map((s) => s[key])).toFixed(1)}`).join('  '));
  const perRun = [];
  for (let run = 0; run < RUNS; run++) perRun.push(median(samples.filter((s) => s.run === run).map((s) => s.total)).toFixed(0));
  out(`各轮 total 中位数：${perRun.join(' / ')}`);
}
out(`\nhotCommit 里"找出本模块 records"一步（重复 2000 次平均）：${results.calibration.map((c) => `${(c.ms * 1000).toFixed(1)} µs（${c.records} 条记录）`).join('，')}`);
out(`各插件 watchChange 累计耗时(ms)，所有样本合计：${JSON.stringify(Object.fromEntries(Object.entries(results.plugin ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +v.toFixed(1)])))}`);
mkdirSync(join(root, '..', 'out'), { recursive: true });
writeFileSync(join(root, '..', 'out', `hmr-${TAG}.json`), JSON.stringify(results));
writeFileSync(join(root, '..', 'out', `hmr-${TAG}.txt`), lines.join('\n'));
