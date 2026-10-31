// node 08-props/run.mjs：一万个组件，5 个 prop（3 个静态、2 个响应式）
import { fileURLToPath } from 'node:url';
import { bundle, heapAfterGc, launch, median, openPage } from '../lib/browser.mjs';

const COUNT = 10_000;
const ROUNDS = 7;
const code = await bundle(fileURLToPath(new URL('./entry.js', import.meta.url)));
const browser = await launch();
const probe = await openPage(browser, code);
const names = await probe.evaluate(() => window.names);
await probe.close();

console.log(`| 形态 | 挂载 ms | 更新一个 x1000 ms | 共享信号更新全部 ms | 每个组件 KB |`);
console.log(`| --- | --- | --- | --- | --- |`);
for (const name of names) {
  const runs = [];
  for (let round = 0; round < ROUNDS; round++) {
    const page = await openPage(browser, code);
    await page.evaluate(([n]) => window.bench(n, 1000), [name]);
    runs.push(await page.evaluate(([n, c]) => window.bench(n, c), [name, COUNT]));
    await page.close();
  }
  const pick = (key) => median(runs.map((run) => run[key])).toFixed(1);
  const page = await openPage(browser, code);
  const empty = await heapAfterGc(page);
  await page.evaluate(([n, c]) => window.hold(n, c), [name, COUNT]);
  const used = await heapAfterGc(page);
  await page.close();
  console.log(`| ${name} | ${pick('mount')} | ${pick('one')} | ${pick('all')} | ${((used - empty) / COUNT / 1024).toFixed(2)} |`);
}
await browser.close();
