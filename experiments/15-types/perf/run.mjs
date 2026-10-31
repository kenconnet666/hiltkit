// 对每个 (组件数, 变体) 串行跑 tsc --noEmit --extendedDiagnostics，每个组合 3 轮取中位数，汇总成表。
// 用法：node perf/run.mjs [--n=300,1000] [--variants=base,lite-props,...] [--rounds=3] [--tsc=7.1|7.0|6]
//   先 node perf/gen.mjs <N> 生成。机器上有别的进程时数字会抖：表里同时给出 3 轮的最小/最大 Check time。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIANTS } from './variants.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sizes = arg('n', '300').split(',').map(Number);
const variants = arg('variants', Object.keys(VARIANTS).join(',')).split(',');
const rounds = Number(arg('rounds', '3'));
const TSC = { '7.1': '../13-ts/node_modules/typescript/bin/tsc', '7.0': '../13-ts/node_modules/ts70/bin/tsc', '6': '../13-ts/node_modules/ts6/bin/tsc' };
const tsc = resolve(root, TSC[arg('tsc', '7.1')]);
const extra = arg('args', '').split(' ').filter(Boolean); // 例如 --args=--singleThreaded 或 --args=--checkers=8

const metric = (text, key) => {
  const m = new RegExp(`^${key}:\\s+([\\d.]+)(K|s)?`, 'm').exec(text);
  return m ? Number(m[1]) : NaN;
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`TS ${arg('tsc', '7.1')}${extra.length ? ` ${extra.join(' ')}` : ''}，${rounds} 轮中位数（Check time 括号内为最小~最大）`);
console.log('| 组件数 | 变体 | 错误 | Total s | Check s | 内存 MB | 实例化 | 类型 | 符号 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const n of sizes) {
  for (const variant of variants) {
    const config = resolve(root, `perf/out/${n}/tsconfig.${variant}.json`);
    if (!existsSync(config)) {
      console.log(`| ${n} | ${variant} | 缺少 ${config} |`);
      continue;
    }
    const runs = [];
    for (let i = 0; i < rounds; i++) {
      const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', config, '--extendedDiagnostics', ...extra], { encoding: 'utf8', maxBuffer: 1 << 28 });
      const text = result.stdout + result.stderr;
      runs.push({
        errors: (text.match(/error TS\d+/g) ?? []).length,
        total: metric(text, 'Total time'),
        check: metric(text, 'Check time'),
        memory: metric(text, 'Memory used') / 1024,
        instantiations: metric(text, 'Instantiations'),
        types: metric(text, 'Types'),
        symbols: metric(text, 'Symbols'),
      });
    }
    const checks = runs.map((r) => r.check);
    console.log(
      `| ${n} | ${variant} | ${runs[0].errors} | ${median(runs.map((r) => r.total)).toFixed(2)} | ${median(checks).toFixed(2)} (${Math.min(...checks).toFixed(2)}~${Math.max(...checks).toFixed(2)}) | ${median(runs.map((r) => r.memory)).toFixed(0)} | ${median(runs.map((r) => r.instantiations))} | ${median(runs.map((r) => r.types))} | ${median(runs.map((r) => r.symbols))} |`,
    );
  }
}
