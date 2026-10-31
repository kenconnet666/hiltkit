// 成本分解：CDP CPU 采样（挂载那一段，按函数自耗时）+ 堆采样（挂载后 GC，按分配点函数汇总存活字节）。
//   node 07-instance/profile.mjs [--scenario a|b] [--patch '{"scope":false}'] [--top 22]
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../lib/browser.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const scenario = flag('scenario', 'a');
const patch = JSON.parse(flag('patch', '{}'));
const top = +flag('top', 22);
const SCENARIO_COUNT = { a: 10_000, b: 5_000, direct: 10_000, directB: 5_000 };

// 不压缩：函数名要能读
const code = await bundle(fileURLToPath(new URL('./entry.js', import.meta.url)), { minify: false, keepNames: true });
const browser = await launch();

function aggregate(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0));
  const byName = new Map();
  let total = 0;
  for (const [id, time] of self) {
    const { callFrame } = nodes.get(id);
    const name = `${callFrame.functionName || '(anonymous)'}  ${callFrame.url ? callFrame.url.split('/').pop() : ''}:${callFrame.lineNumber}`;
    byName.set(name, (byName.get(name) ?? 0) + time);
    total += time;
  }
  return { byName, total };
}

{
  const page = await openPage(browser, code);
  await page.evaluate((p) => window.setup(p), patch);
  await page.evaluate((s) => void window.bench(s, 1000), scenario); // 热身
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
  await cdp.send('Profiler.start');
  await page.evaluate((s) => void window.keep(s), scenario);
  const { profile } = await cdp.send('Profiler.stop');
  const { byName, total } = aggregate(profile);
  console.log(`\n== CPU 自耗时：场景 ${scenario} ${JSON.stringify(patch)}，总采样 ${(total / 1000).toFixed(0)} ms ==`);
  for (const [name, time] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`${(time / 1000).toFixed(1).padStart(7)} ms ${((time / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
  }
  await page.close();
}

{
  const page = await openPage(browser, code);
  await page.evaluate((p) => window.setup(p), patch);
  await page.evaluate((s) => void window.bench(s, 500), scenario);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false });
  await page.evaluate((s) => void window.keep(s), scenario);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const byName = new Map();
  let total = 0;
  const walk = (node) => {
    const { callFrame } = node;
    const name = `${callFrame.functionName || '(anonymous)'}  ${callFrame.url ? callFrame.url.split('/').pop() : ''}:${callFrame.lineNumber}`;
    byName.set(name, (byName.get(name) ?? 0) + node.selfSize);
    total += node.selfSize;
    node.children.forEach(walk);
  };
  walk(profile.head);
  const n = SCENARIO_COUNT[scenario];
  console.log(`\n== 堆（存活字节，按分配点函数；采样估计）：场景 ${scenario}，总计 ${(total / n / 1024).toFixed(2)} KB / 实例 ==`);
  for (const [name, size] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`${(size / n).toFixed(0).padStart(6)} B/实例 ${((size / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
  }
  await page.close();
}
await browser.close();
