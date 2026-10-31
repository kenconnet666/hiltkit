// node 16-fuzz/run.mjs [--seeds=N] [--only=kernel,list,attrs,hydrate] [--seed=原始种子] [--from=起始序号] [--no-shrink] [--verbose]
// 可复现的随机测试：每个方向的第 i 个用例的种子是 seedFor(方向, i)，固定不变。
// 失败时打印 种子 + 失败类别 + 最小化后的用例，并写到 16-fuzz/failures/<方向>-<种子>.json；
// 之后用 --only=<方向> --seed=<种子> 单独重放。不做任何计时断言。
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { seedFor } from './lib/rng.mjs';
import { shrink } from './lib/shrink.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);
const only = typeof args.only === 'string' ? args.only.split(',') : undefined;
const forcedSeeds = args.seed !== undefined ? String(args.seed).split(',').map(Number) : undefined;
const from = Number(args.from ?? 0);
const root = fileURLToPath(new URL('.', import.meta.url));

const DIRECTIONS = [
  ['kernel', './kernel.mjs'],
  ['list', './list.mjs'],
  ['attrs', './attrs.mjs'],
  ['hydrate', './hydrate.mjs'],
];

let totalFailed = 0;
const summary = [];
for (const [name, file] of DIRECTIONS) {
  if (only && !only.includes(name)) continue;
  const { direction } = await import(file);
  const count = forcedSeeds ? forcedSeeds.length : Number(args.seeds ?? direction.defaultSeeds);
  await direction.setup?.();
  console.log(`## ${direction.title}（${count} 个种子）`);
  let passed = 0;
  const failures = new Map(); // 类别 -> [种子]
  for (let i = 0; i < count; i++) {
    const seed = forcedSeeds ? forcedSeeds[i] : seedFor(name, from + i);
    let result;
    try {
      result = await direction.check(seed, { ...args });
    } catch (error) {
      result = { ok: false, kind: 'harness-crash', message: String(error.stack ?? error).split('\n').slice(0, 5).join(' | ') };
    }
    if (result.ok) {
      passed++;
      continue;
    }
    totalFailed++;
    const list = failures.get(result.kind) ?? failures.set(result.kind, []).get(result.kind);
    list.push(seed);
    // 同一类失败只缩第一个（水合的每次重放要几百毫秒），其余只记种子
    if (list.length > 1 && !args['shrink-all'] && !args.verbose) continue;
    let minimal = result.caseData;
    if (minimal && direction.recheck && !args['no-shrink']) {
      minimal = await shrink(result.caseData, (candidate) => direction.recheck(candidate), result.kind, direction.shrinkBudget ?? 300);
    }
    console.log(`FAIL ${name} seed=${seed} kind=${result.kind}`);
    console.log(`     ${String(result.message).slice(0, 600)}`);
    if (minimal) {
      await mkdir(`${root}failures`, { recursive: true });
      const path = `${root}failures/${name}-${seed}.json`;
      await writeFile(path, JSON.stringify({ seed, kind: result.kind, message: result.message, case: minimal }, null, 1));
      const text = JSON.stringify(minimal);
      console.log(`     最小化用例（${text.length} 字符）：${text.length > 1200 ? `${text.slice(0, 1200)}…` : text}`);
      console.log(`     已写入 ${path}`);
    }
  }
  await direction.teardown?.();
  const kinds = [...failures].map(([kind, seeds]) => `${kind}×${seeds.length}（如 seed=${seeds[0]}）`);
  console.log(`${passed === count ? 'ok  ' : 'FAIL'} ${direction.title}：${passed}/${count} 通过${kinds.length ? `；${kinds.join('、')}` : ''}\n`);
  summary.push([direction.title, passed, count]);
}
console.log('汇总：');
for (const [title, passed, count] of summary) console.log(`  ${title}：${passed}/${count}（${((passed / count) * 100).toFixed(1)}%）`);
process.exitCode = totalFailed ? 1 : 0;
