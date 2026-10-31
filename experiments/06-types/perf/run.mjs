// 对每个变体跑 tsc --extendedDiagnostics（TS 7 原生版与 TS 6 JS 版各一次），汇总成表。
// 用法：node perf/run.mjs [变体名...]   （先 node perf/gen.mjs 生成）
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['full', 'simple-elements', 'no-token-styles', 'simple-styles', 'simple-both'];
const compilers = [
  ['TS7', 'node_modules/typescript/bin/tsc'],
  ['TS6', 'node_modules/typescript6/bin/tsc'],
];
const pick = (text, key) => {
  const m = new RegExp(`^${key}:\\s+([\\d.]+)(K|s)?`, 'm').exec(text);
  return m ? (m[2] === 'K' ? (+m[1] / 1024).toFixed(0) + ' MB' : m[1] + (m[2] ?? '')) : '?';
};
console.log('| 变体 | 编译器 | 错误数 | Check time | Total time | 内存 | 实例化 | 类型 | 符号 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const variant of variants) {
  const cfg = `perf/out/tsconfig.${variant}.json`;
  if (!existsSync(cfg)) { console.error('缺少', cfg); continue; }
  for (const [name, bin] of compilers) {
    const r = spawnSync('node', [bin, '--noEmit', '-p', cfg, '--extendedDiagnostics'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const text = r.stdout + r.stderr;
    const errors = (text.match(/error TS\d+/g) ?? []).length;
    console.log(`| ${variant} | ${name} | ${errors} | ${pick(text, 'Check time')} | ${pick(text, 'Total time')} | ${pick(text, 'Memory used')} | ${pick(text, 'Instantiations')} | ${pick(text, 'Types')} | ${pick(text, 'Symbols')} |`);
    if (errors && process.env.SHOW) console.log(text.split('\n').filter((l) => /error TS/.test(l)).slice(0, 5).join('\n'));
  }
}
