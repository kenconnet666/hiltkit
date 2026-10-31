// 回归门：所有用例跑在同一份运行时和编译器上。node run-all.mjs [名字片段]
// 只数 ok / FAIL，不看计时。计时基准单独跑。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUITES = [
  ['内核', '01-reactive/core-check.mjs'],
  ['深代理', '06-deep/check.mjs'],
  ['属性语义（三浏览器）', '09-attr/run.mjs', 'tests'],
  ['发布形态', '03-publish/run.mjs'],
  ['sx 合并', '03-publish/sx/run.mjs'],
  ['生命周期', '03-publish/lifecycle/run.mjs'],
  ['符文', '03-publish/runes/run.mjs'],
  ['列表', '03-publish/runes/list-run.mjs'],
  ['绑定', '03-publish/runes/bind-run.mjs'],
  ['props', '03-publish/runes/props-run.mjs'],
  ['水合', '03-publish/ssr/run.mjs'],
  ['依赖注入', '03-publish/di/run.mjs'],
  ['父子流转', '03-publish/flow/run.mjs'],
  ['懒加载', '03-publish/lazy/run.mjs'],
  ['真实组件迁移', '11-port/run.mjs'],
  ['CSS', '10-css/run.mjs', '--only=sx,recipe,conditions,theme,priority,ssr,dev,size'],
  ['集成', '14-integrated/run.mjs'],
];
const root = fileURLToPath(new URL('.', import.meta.url));
const filter = process.argv[2];
let totalOk = 0;
let totalFail = 0;
const broken = [];
for (const [name, file, ...args] of SUITES) {
  if (filter && !name.includes(filter) && !file.includes(filter)) continue;
  const { stdout, stderr, status, error } = spawnSync('node', [file, ...args], { cwd: root, encoding: 'utf8', timeout: 400_000, maxBuffer: 1 << 28 });
  const output = `${stdout}\n${stderr}`;
  const lines = output.split('\n');
  const fails = lines.filter((line) => /^\s*FAIL\b/.test(line));
  let ok = lines.filter((line) => /^\s*ok\b/.test(line)).length;
  // 属性语义和深代理只打总数
  const summary = output.match(/通过 (\d+)，失败 (\d+)/);
  if (summary) ok = Number(summary[1]);
  const perBrowser = [...output.matchAll(/(\d+)\s*\/\s*(\d+) 通过/g)];
  if (name.startsWith('属性') && perBrowser.length) ok = perBrowser.reduce((sum, match) => sum + Number(match[1]), 0);
  const crashed = status !== 0 && !fails.length;
  console.log(`${crashed || fails.length ? 'FAIL' : 'ok  '} ${name}：${ok} 条通过${fails.length ? `，${fails.length} 条失败` : ''}${crashed ? `，退出码 ${status}${error ? ` ${error.message}` : ''}` : ''}`);
  for (const line of fails) console.log(`     ${line.trim().slice(0, 300)}`);
  if (crashed) console.log(lines.filter((line) => /rror/.test(line)).slice(0, 6).map((line) => `     ${line.trim().slice(0, 300)}`).join('\n'));
  totalOk += ok;
  totalFail += fails.length;
  if (crashed || fails.length) broken.push(name);
}
console.log(`\n合计 ${totalOk} 条通过，${totalFail} 条失败${broken.length ? `；有问题：${broken.join('、')}` : ''}`);
process.exitCode = broken.length ? 1 : 0;
