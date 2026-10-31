// 变异自检：把运行时故意改坏一处，确认对应方向的检查真的抓得到。node 16-fuzz/selfcheck.mjs [kernel|list|hydrate]
// 抓不到的变异说明检查太弱（或这处改动本来就不影响语义）。变异体放在 16-fuzz/.mut/，跑完删除。
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const runtime = `${here}../03-publish/packages/runtime`;
const only = process.argv[2];

/** [方向, 说明, 文件, 原文, 改成, 种子数] */
const MUTANTS = [
  ['kernel', '重跑时不跑上一次的清理', 'reactive.js', 'if (effect.cleanups) runCleanups(effect);', '/* 删掉 */'],
  ['kernel', '用户 effect 和 DOM 绑定同一个队列', 'reactive.js', '(effect.flags & RENDER ? renderQueue : userQueue).push(effect);', 'userQueue.push(effect);'],
  ['kernel', '不保证外层先于内层', 'reactive.js', 'if (parent === undefined || !(parent.flags & Watching)) {', 'if (true) {'],
  ['kernel', '外层重跑不销毁内层', 'reactive.js', 'if (!dep.kind) unlink(current, effect);', '/* 删掉 */'],
  ['kernel', '销毁后标志不清零', 'reactive.js', 'function disposeNode(node) {\n  node.flags = None;', 'function disposeNode(node) {'],
  ['kernel', '值没变也重跑（Pending 当 Dirty）', 'reactive.js', 'flags & Pending && checkDirty(effect.deps, effect)', 'flags & Pending'],
  ['kernel', '销毁不跑清理', 'reactive.js', 'if (node.cleanups) runCleanups(node);\n}\nfunction purgeDeps', '}\nfunction purgeDeps'],
  ['list', '每次重排都移动所有行', 'index.js', 'if (!keep.has(i)) parent.insertBefore(node, anchor);', 'parent.insertBefore(node, anchor);'],
  ['list', '删掉的行不销毁作用域', 'index.js', '      parent.removeChild(liveNode(row.node));\n      dispose(row.scope);', '      parent.removeChild(liveNode(row.node));'],
  ['list', '同 key 的行不更新 item', 'index.js', 'if (row.item) row.item.value = item;', ''],
  ['list', '同 key 的行不更新下标', 'index.js', '        row.index.value = index;\n        if (row.item)', '        if (row.item)'],
  ['list', '清空时不销毁行', 'index.js', '      for (const row of rows.values()) dispose(row.scope);\n      rows = new Map();', '      rows = new Map();'],
  ['hydrate', '水合时 attrStr 仍然写 DOM', 'attrs.js', 'export function attrStr(el, name, value, mode = 0) {\n  if (hydrating) return;', 'export function attrStr(el, name, value, mode = 0) {'],
  ['hydrate', '水合时 insert 不认领文本', 'index.js', "  if (cursor?.nodeType === 3) cursor = cursor.nextSibling;\n}", '}'],
  ['hydrate', '动态段结束标记找错', 'index.js', "else if (isMark(node, ']') && depth-- === 0) return node;", "else if (isMark(node, ']')) return node;"],
];
const SEEDS = { kernel: 300, list: 150, hydrate: 40 };
let missed = 0;
for (const [direction, name, file, from, to] of MUTANTS) {
  if (only && only !== direction) continue;
  const source = await readFile(`${runtime}/${file}`, 'utf8');
  if (!source.includes(from)) {
    console.log(`SKIP ${direction} ${name}（运行时源码已变，找不到要改的那段）`);
    continue;
  }
  await rm(`${here}.mut`, { recursive: true, force: true });
  await mkdir(`${here}.mut`, { recursive: true });
  await cp(runtime, `${here}.mut/runtime`, { recursive: true });
  await writeFile(`${here}.mut/runtime/${file}`, source.replace(from, to));
  const env = { ...process.env };
  if (direction === 'kernel') env.FUZZ_REACTIVE = pathToFileURL(`${here}.mut/runtime/reactive.js`).href;
  else env.FUZZ_RUNTIME_DIR = `${here}.mut/runtime`;
  const run = spawnSync('node', [`${here}run.mjs`, `--only=${direction}`, `--seeds=${SEEDS[direction]}`, '--no-shrink'], { encoding: 'utf8', env, timeout: 600_000 });
  const line = run.stdout.split('\n').find((text) => /^(ok|FAIL)\s+\S+：/.test(text)) ?? run.stderr.split('\n').find(Boolean) ?? '(无输出)';
  const caught = /^FAIL/.test(line);
  if (!caught) missed++;
  console.log(`${caught ? '抓到' : '漏掉'} [${direction}] ${name}：${line.slice(0, 160)}`);
}
await rm(`${here}.mut`, { recursive: true, force: true });
process.exitCode = missed ? 1 : 0;
