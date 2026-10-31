// hmr.mjs、open.mjs 共用：快照包的定位、编译插件、开发服务器、浏览器页面的计时探针。
// 运行时和编译器目录用环境变量 HILT_PACKAGES 指定（相对 experiments/），默认 03-publish/packages；
// 本目录的实验一律指向快照 03-publish/packages-v0，不受正在重写的 packages 影响。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

export const here = (path) => fileURLToPath(new URL(path, import.meta.url));
export const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 与浏览器页面同一套时间轴（epoch 毫秒，带小数），服务端和页面的时间戳可以直接相减 */
export const now = () => performance.timeOrigin + performance.now();

export const packagesDir = here(`../${process.env.HILT_PACKAGES ?? '03-publish/packages'}`);
export const runtimeDir = join(packagesDir, 'runtime');
export const { compile } = await import(pathToFileURL(join(packagesDir, 'compiler/index.mjs')).href);
const cssEntry = here('./css-entry.ts');
const engineDir = here('../04-css/engine');

export const resolveAlias = [
  { find: '@hilt/runtime', replacement: join(runtimeDir, 'index.js') },
  { find: '@hilt/css-hot', replacement: join(engineDir, 'hot.ts') },
  { find: '@hilt/css', replacement: cssEntry },
];

/** 编译一个 .tsx 模块。cacheDir 给了就按内容哈希缓存到磁盘（命中就不编译）；compileFn 可替换（线程池） */
export function cachedCompile(stats, { cacheDir, compileFn = compile } = {}) {
  return async (code, file, moduleId) => {
    const key = cacheDir && join(cacheDir, `${createHash('sha256').update(moduleId + code).digest('hex').slice(0, 20)}.js`);
    if (key && existsSync(key)) {
      stats.cacheHits++;
      return { code: readFileSync(key, 'utf8'), map: null };
    }
    const start = performance.now();
    const result = await compileFn(code, file, { hot: moduleId });
    stats.compileMs += performance.now() - start;
    stats.compiled++;
    if (key) writeFileSync(key, result.code);
    return result;
  };
}

/** 模块的热更新 id：相对项目根、正斜杠 */
export const moduleIdOf = (file, projectRoot) => file.replace(projectRoot, '').replaceAll('\\', '/');

/** 编译 .tsx 的 Vite 插件 */
export function hiltDev(stats, options = {}) {
  const compileModule = cachedCompile(stats, options);
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
      return compileModule(code, file, moduleIdOf(file, projectRoot));
    },
  };
}

export const newStats = () => ({ compiled: 0, compileMs: 0, cacheHits: 0 });

export async function serve(config, port) {
  const start = performance.now();
  const server = await createServer({ configFile: false, logLevel: process.env.HILT_LOG ?? 'silent', ...config, server: { port, strictPort: true, ...config.server } });
  await server.listen();
  return { server, ready: performance.now() - start };
}

export const launchBrowser = () => chromium.launch();

/** 打开页面，等 #app-text 出现。pageInit 在页面脚本之前注入 */
export async function openOnce(browser, port, { pageInit } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (pageInit) await page.addInitScript(pageInit);
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  const start = performance.now();
  await page.goto(`http://localhost:${port}/`, { timeout: 300000 });
  await page.waitForSelector('#app-text', { timeout: 300000 });
  const ms = performance.now() - start;
  return { page, context, ms, requests, errors };
}

/**
 * 页面里的计时探针：记 ws 消息到达、热更新提交完成的时间，供 hmr.mjs 拆段。
 * 注意：这段函数会被序列化后在浏览器里执行，不能引用外部变量。
 */
export function pageProbe() {
  const stamp = () => performance.timeOrigin + performance.now();
  window.__t = { ws: [], commits: [], longTasks: [] };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        const received = stamp();
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'update' || data.type === 'full-reload') window.__t.ws.push({ type: data.type, t: received, urls: data.updates?.map((update) => update.path) });
        } catch {}
      });
    }
  };
  window.__hiltHot = (entry) => window.__t.commits.push({ ...entry, t: stamp() });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__t.longTasks.push({ start: performance.timeOrigin + entry.startTime, ms: entry.duration });
  }).observe({ type: 'longtask', buffered: true });
}

/** 运行时探针（只给 HMR 拆段用，不改行为）：量 hotCommit 总耗时，以及它那句全表扫描单独占多少 */
export function runtimeProbePlugin({ variant = 'baseline' } = {}) {
  const scanLine = 'const records = [...hotRecords.values()].filter((record) => record.id.startsWith(`${id}#`));';
  return {
    name: 'hilt-runtime-probe',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/runtime/index.js')) return null;
      if (!code.includes(scanLine)) throw new Error('hotCommit 的全表扫描那行变了，探针需要更新');
      let out = code;
      if (variant === 'bucketed') {
        // 按模块分桶：hotComponent 注册时把 record 放进 hotBuckets[moduleId]，hotCommit 直接取桶
        out = out.replace('hotRecords.set(id, record);', 'hotRecords.set(id, record);\n  const bucketKey = id.slice(0, id.lastIndexOf("#"));\n  let bucket = hotBuckets.get(bucketKey);\n  if (!bucket) hotBuckets.set(bucketKey, (bucket = []));\n  bucket.push(record);');
        out = out.replace('const hotRecords = new Map();', 'const hotRecords = new Map();\nconst hotBuckets = new Map();');
        out = out.replace(scanLine, 'const records = hotBuckets.get(id) ?? [];');
      }
      out = out.replace(
        'export function hotCommit(id, otherExports, hot) {',
        `export function hotCommit(id, otherExports, hot) {
  const __s0 = performance.now();
  try {
    return hotCommit0(id, otherExports, hot);
  } finally {
    (window.__t.commitMs ??= []).push(performance.now() - __s0);
  }
}
function hotCommit0(id, otherExports, hot) {`,
      );
      // 校准：把"找出这个模块的 records"那一步单独重复 n 次取平均（performance.now 精度只有 0.1 ms），不占用计时轮次
      const scan = variant === 'bucketed' ? 'hotBuckets.get(id) ?? []' : '[...hotRecords.values()].filter((record) => record.id.startsWith(`${id}#`))';
      out += `\nwindow.__t.calibrate = (id, n) => {
  const s = performance.now();
  for (let i = 0; i < n; i++) void (${scan});
  return { ms: (performance.now() - s) / n, records: hotRecords.size };
};\n`;
      return { code: out, map: null };
    },
  };
}

/** 用 inspector 只对 fn 执行期间采样 CPU（当前进程，包含 Vite 服务端），返回 .cpuprofile 对象 */
export async function profile(fn) {
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 200 });
  await session.post('Profiler.start');
  try {
    await fn();
  } finally {
    var { profile: result } = await session.post('Profiler.stop');
    session.disconnect();
  }
  return result;
}

/** 汇总 cpuprofile：按"自身时间"归到 文件/函数，和按路径片段分类（chokidar / readdirp / vite / rolldown / node 内部…） */
export function summarizeProfile(result, { top = 15 } = {}) {
  const nodes = new Map(result.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const dt = result.timeDeltas;
  for (let i = 0; i < result.samples.length; i++) self.set(result.samples[i], (self.get(result.samples[i]) ?? 0) + (dt[i] ?? 0));
  const byFunction = new Map();
  const byGroup = new Map();
  const groupOf = (url) => {
    if (!url) return '(native/idle)';
    if (url.startsWith('node:')) return 'node 内部';
    const normalized = url.replaceAll('\\', '/');
    const match = normalized.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
    return match ? match[1] : normalized.split('/').slice(-2).join('/');
  };
  let total = 0;
  for (const [id, us] of self) {
    const { callFrame } = nodes.get(id);
    if (callFrame.functionName === '(idle)' || callFrame.functionName === '(program)') continue;
    total += us;
    const key = `${callFrame.functionName || '(anon)'} ${groupOf(callFrame.url)}:${callFrame.lineNumber + 1}`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + us);
    byGroup.set(groupOf(callFrame.url), (byGroup.get(groupOf(callFrame.url)) ?? 0) + us);
  }
  const fmt = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, us]) => `${(us / 1000).toFixed(1).padStart(8)} ms  ${k}`);
  return { totalMs: total / 1000, groups: fmt(byGroup), functions: fmt(byFunction) };
}
