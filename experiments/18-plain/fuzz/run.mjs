// node 18-plain/fuzz/run.mjs [--seeds=N] [--only=kernel,list,attrs,hydrate] [--seed=种子,种子] [--from=起始序号] [--no-shrink] [--shrink-all] [--mixed]
// 可复现的随机测试：每个方向第 i 个用例的种子是 seedFor(方向, i)，固定不变；不做任何计时断言。
// 失败时打印 种子 + 失败类别 + 最小化后的用例，并写到 18-plain/fuzz/failures/<方向>-<种子>.json；
// 之后用 --only=<方向> --seed=<种子> 单独重放。
//   --seeds=N     每个方向跑 N 个（默认各方向自己的数量）
//   --from=K      从第 K 个序号开始
//   --mixed       内核方向：允许 renderEffect 嵌在用户 effect 里（bugs/009 的场景）
//   --inline=0|1  列表方向：强制 / 禁止在 For 回调体里直接写 onCleanup、effect（默认随机；1 会撞上 bugs/001）
//   --skip-ssr-compare  水合方向：跳过“服务端输出 vs 客户端从头挂载”的预检，直接看水合本身（已知 sx 类名不一致会掩盖别的问题时用）
// 相关脚本：selfcheck.mjs（变异自检，证明这些检查抓得到问题）、bugs/*.mjs（缺陷最小复现，FAIL = 缺陷还在）
//   --shrink-all  同一类失败每个种子都最小化（默认只缩第一个）
// “语义差异”（notes）不算失败，只统计：同一类只打印第一次出现的种子。
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { seedFor } from './lib/rng.mjs';
import { shrink } from './lib/shrink.mjs';

// 属性规则的开发期提示（[attr] javascript: 链接已拦截 之类）在随机输入下会刷屏，这里不关心
console.warn = () => {};
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
  const notes = new Map(); // 语义差异类别 -> { seeds, message }
  for (let i = 0; i < count; i++) {
    const seed = forcedSeeds ? forcedSeeds[i] : seedFor(name, from + i);
    let result;
    try {
      result = await direction.check(seed, { ...args });
    } catch (error) {
      result = { ok: false, kind: 'harness-crash', message: String(error.stack ?? error).split('\n').slice(0, 5).join(' | ') };
    }
    for (const note of result.notes ?? []) {
      const entry = notes.get(note.kind) ?? notes.set(note.kind, { seeds: new Set(), message: `seed=${seed} ${note.message}` }).get(note.kind);
      entry.seeds.add(seed);
    }
    if (result.ok) {
      passed++;
      continue;
    }
    totalFailed++;
    const list = failures.get(result.kind) ?? failures.set(result.kind, []).get(result.kind);
    list.push(seed);
    // 同一类失败只缩第一个，其余只记种子
    if (list.length > 1 && !args['shrink-all']) continue;
    let minimal = result.caseData;
    if (minimal && direction.recheck && !args['no-shrink']) {
      minimal = await shrink(result.caseData, (candidate) => direction.recheck(candidate), result.kind, direction.shrinkBudget ?? 300, { omit: direction.shrinkOmit !== false });
    }
    console.log(`FAIL ${name} seed=${seed} kind=${result.kind}`);
    console.log(`     ${String(result.message).slice(0, 700)}`);
    if (minimal) {
      await mkdir(`${root}failures`, { recursive: true });
      const path = `${root}failures/${name}-${seed}.json`;
      await writeFile(path, JSON.stringify({ seed, kind: result.kind, message: result.message, case: minimal }, null, 1));
      const text = JSON.stringify(minimal);
      console.log(`     最小化用例（${text.length} 字符）：${text.length > 1500 ? `${text.slice(0, 1500)}…` : text}`);
      console.log(`     已写入 ${path}`);
    }
  }
  await direction.teardown?.();
  const kinds = [...failures].map(([kind, seeds]) => `${kind}×${seeds.length}（如 seed=${seeds[0]}）`);
  console.log(`${passed === count ? 'ok  ' : 'FAIL'} ${direction.title}：${passed}/${count} 通过${kinds.length ? `；${kinds.join('、')}` : ''}`);
  for (const [kind, entry] of notes) console.log(`note ${direction.title} 语义差异 ${kind}×${entry.seeds.size}：${entry.message.slice(0, 400)}`);
  console.log();
  summary.push([direction.title, passed, count]);
}
console.log('汇总：');
for (const [title, passed, count] of summary) console.log(`  ${title}：${passed}/${count}（${((passed / count) * 100).toFixed(1)}%）`);
process.exitCode = totalFailed ? 1 : 0;
