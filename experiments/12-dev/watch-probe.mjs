// node 12-dev/watch-probe.mjs [组件数=1000] [样本数=15]
// 定位 Vite 8 里"文件变化 → hotUpdate 钩子"之间随模块数增长的那段（pluginContainer.watchChange）。
// 对比几种被改动的文件：模块图里的库文件 / 库目录里但没被引用的文件 / 另一个目录里的单独模块 / 非模块文件，
// 以及模块图是空的（没打开页面）还是满的（打开过页面）。
import { fsCalls } from './fs-count.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from './gen.mjs';
import { hiltDev, here, launchBrowser, median, newStats, now, openOnce, profile, resolveAlias, serve, sleep, summarizeProfile } from './common.mjs';

const COUNT = Number(process.argv[2] ?? 1000);
const SAMPLES = Number(process.argv[3] ?? 15);
const root = here(`./.gen/watch-${COUNT}`);
const generated = generate(root, COUNT);
// 另一个目录里的单独模块，被 App 引用；库目录里再放一个没被任何人引用的文件
mkdirSync(join(root, 'src/solo'), { recursive: true });
const soloFile = join(root, 'src/solo/Solo.tsx');
writeFileSync(soloFile, "export const Solo = _component(() => <i id=\"solo\">solo</i>);\n");
const unusedFile = join(generated.lib, 'Unused.tsx');
writeFileSync(unusedFile, "export const Unused = _component(() => <i>unused</i>);\n");
const noteFile = join(root, 'src/note.txt');
writeFileSync(noteFile, 'note');
const appFile = join(root, 'src/App.tsx');
writeFileSync(appFile, `import { Solo } from './solo/Solo';\n${readFileSync(appFile, 'utf8')}`.replace('<p id="app-text">应用文字</p>', '<p id="app-text">应用文字</p>\n      <Solo />'));

const log = { watchChange: [], hotUpdate: [], change: [] };
function probe() {
  return {
    name: 'watch-probe',
    configureServer(server) {
      const container = server.environments.client.pluginContainer;
      const watchChange = container.watchChange.bind(container);
      container.watchChange = async (...args) => {
        const start = now();
        try {
          return await watchChange(...args);
        } finally {
          log.watchChange.push({ file: args[0], start, end: now() });
        }
      };
      server.watcher.on('change', (file) => log.change.push({ file, t: now() }));
    },
  };
}

const { server } = await serve({ root, resolve: { alias: resolveAlias }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [hiltDev(newStats()), probe()] }, 5421);

async function sample(label, file, make) {
  const watchChangeMs = [];
  const eventDelay = [];
  const calls = [];
  for (let i = 0; i < SAMPLES + 3; i++) {
    const before = { ...fsCalls };
    const marks = { w: log.watchChange.length, c: log.change.length };
    const t0 = now();
    writeFileSync(file, make(i));
    const deadline = now() + 3000;
    while (log.watchChange.length === marks.w && now() < deadline) await sleep(1);
    await sleep(150);
    const wc = log.watchChange.slice(marks.w).find((entry) => entry.file.replaceAll('\\', '/') === file.replaceAll('\\', '/'));
    const ev = log.change.slice(marks.c).find((entry) => entry.file.replaceAll('\\', '/') === file.replaceAll('\\', '/'));
    if (i < 3 || !wc || !ev) continue;
    calls.push(fsCalls.stat + fsCalls.lstat + fsCalls.readdir - before.stat - before.lstat - before.readdir);
    watchChangeMs.push(wc.end - wc.start);
    eventDelay.push(ev.t - t0);
  }
  console.log(`${label.padEnd(34)} watchChange ${median(watchChangeMs).toFixed(1).padStart(6)} ms   写文件→监听事件 ${median(eventDelay).toFixed(1).padStart(6)} ms   fs 调用 ${median(calls)} 次/次改动  (${watchChangeMs.length} 样本)`);
}
const targets = [
  ['库里被引用的组件(src/lib)', join(generated.lib, `${generated.used[1]}.tsx`), (i) => `${readTarget}\n// ${i}\n`],
  ['库目录里没人引用的文件', unusedFile, (i) => `export const Unused = _component(() => <i>unused${i}</i>);\n`],
  ['另一个目录里的单独模块', soloFile, (i) => `export const Solo = _component(() => <i id="solo">solo${i}</i>);\n`],
  ['非模块文件 src/note.txt', noteFile, (i) => `note${i}`],
];
const readTarget = readFileSync(targets[0][1], 'utf8');

console.log(`\n===== watchChange 定位（${COUNT} 个组件；可能有后台进程干扰）=====`);
console.log('--- 模块图是空的（还没打开页面）---');
for (const [label, file, make] of targets) await sample(label, file, make);

const browser = await launchBrowser();
const opened = await openOnce(browser, 5421);
await sleep(1500);
console.log(`--- 模块图是满的（页面已打开，${opened.requests.length} 个请求）---`);
for (const [label, file, make] of targets) await sample(label, file, make);
if (process.env.HILT_PROF) {
  // 只对"改库里的组件"采样 CPU，看这段时间主线程在忙什么
  const result = await profile(() => sample('(采样中)库里被引用的组件', targets[0][1], targets[0][2]));
  const summary = summarizeProfile(result);
  console.log(`\nCPU 采样（主线程自身时间合计 ${summary.totalMs.toFixed(0)} ms，共 ${SAMPLES + 3} 次改动）`);
  console.log(['按包：', ...summary.groups, '按函数：', ...summary.functions].join('\n'));
}
await opened.context.close();
await browser.close();
await server.close();
