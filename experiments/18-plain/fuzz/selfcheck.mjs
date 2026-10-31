// 变异自检：把被测实现故意改坏一处，确认对应方向的检查真的抓得到。node 18-plain/fuzz/selfcheck.mjs [kernel|list|attrs|hydrate]
// 漏掉的变异说明检查太弱（或这处改动本来就不影响语义）。变异体放在 18-plain/fuzz/.mut/，跑完删除；不碰原文件。
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const plain = `${here}..`;
const runtimeDir = `${plain}/../03-publish/packages/runtime`;
const only = process.argv[2];

/** [方向, 说明, 文件(runtime/* 或 hilt/*), 原文, 改成, 种子数] */
const MUTANTS = [
  ['kernel', '重跑时不跑上一次的清理', 'runtime/reactive.js', 'if (effect.cleanups) runCleanups(effect);', '/* 删掉 */', 300],
  ['kernel', '用户 effect 和 DOM 绑定同一个队列', 'runtime/reactive.js', '(effect.flags & RENDER ? renderQueue : userQueue).push(effect);', 'userQueue.push(effect);', 300],
  ['kernel', '外层重跑不销毁内层', 'runtime/reactive.js', 'if (!dep.kind) unlink(current, effect);', '/* 删掉 */', 300],
  ['kernel', '销毁后标志不清零', 'runtime/reactive.js', 'function disposeNode(node) {\n  node.flags = None;', 'function disposeNode(node) {', 300],
  ['kernel', '值没变也重跑（Pending 当 Dirty）', 'runtime/reactive.js', 'flags & Pending && checkDirty(effect.deps, effect)', 'flags & Pending', 300],
  ['list', '每次重排都移动所有行', 'hilt/index.ts', 'const keep = longestIncreasing(list.map((row) => before2.get(row) ?? -1));', 'const keep = new Set<number>();', 150],
  ['list', '删掉的行不销毁作用域', 'hilt/index.ts', '            for (const node of rowNodes(row)) target.removeChild(node);\n            dispose(row.scope);', '            for (const node of rowNodes(row)) target.removeChild(node);', 150],
  ['list', '同键的行不更新 item', 'hilt/index.ts', 'if (row.item) row.item.value = item;', '', 150],
  ['list', '同键的行不更新下标', 'hilt/index.ts', '              row.index.value = index;\n', '', 150],
  ['list', '删掉的行不移出 DOM', 'hilt/index.ts', '            for (const node of rowNodes(row)) target.removeChild(node);\n            dispose', '            dispose', 150],
  ['attrs', 'merge 的 class 不拼接', 'hilt/index.ts', "else if (key === 'class') out.class = [previous, value];", "else if (key === 'class') out.class = value;", 150],
  ['attrs', 'merge 的事件下层先执行', 'hilt/index.ts', 'value(event);\n          if (!event.defaultPrevented) previous(event);', 'previous(event);\n          if (!event.defaultPrevented) value(event);', 150],
  ['attrs', '卸载时 ref 不清空', 'hilt/index.ts', 'onCleanup(() => value(null));', '', 150],
  ['attrs', '服务端不展开 class 里的函数', 'hilt/server.ts', "key === 'class' || key === 'style' ? settle(value) :", "key === 'class' || key === 'style' ? value :", 150],
  ['hydrate', '水合时 attrStr 仍然写 DOM', 'runtime/attrs.js', 'export function attrStr(el, name, value, mode = 0) {\n  if (hydrating) return;', 'export function attrStr(el, name, value, mode = 0) {', 100],
  ['hydrate', '水合时不认领文本', 'hilt/index.ts', "    if (textValue !== '' && cursor?.nodeType === 3) cursor = cursor.nextSibling;", '', 100],
  ['hydrate', '动态段结束标记找错（不数嵌套）', 'hilt/index.ts', "else if (isMark(node, ']') && depth-- === 0) return node;", "else if (isMark(node, ']')) return node;", 100],
  ['hydrate', '服务端动态段不输出结束标记', 'hilt/server.ts', 'return `<!--[-->${toHtml(inner)}<!--]-->`;', 'return `<!--[-->${toHtml(inner)}`;', 100],
  ['hydrate', '水合时 For 不认领行', 'hilt/index.ts', 'row.last = cursor ? cursor.previousSibling : end.previousSibling;', 'row.last = row.first;', 100],
];
/** 没改动的实现在同样的种子上通过多少（已知缺陷也会失败，变异体要比它更差才算抓到） */
const baselines = new Map();
function passed(env, direction, seeds) {
  const run = spawnSync('node', [`${here}run.mjs`, `--only=${direction}`, `--seeds=${seeds}`, '--no-shrink'], { encoding: 'utf8', env, timeout: 900_000 });
  const line = run.stdout.split('\n').find((text) => /^(ok|FAIL)\s+\S+：/.test(text)) ?? run.stderr.split('\n').find(Boolean) ?? '(无输出)';
  return { line, passed: Number(/：(\d+)\/\d+ 通过/.exec(line)?.[1] ?? -1) };
}
let missed = 0;
for (const [direction, name, file, from, to, seeds] of MUTANTS) {
  if (only && only !== direction) continue;
  const original = file.startsWith('runtime/') ? `${runtimeDir}/${file.slice(8)}` : `${plain}/${file}`;
  const source = await readFile(original, 'utf8');
  if (!source.includes(from)) {
    console.log(`SKIP ${direction} ${name}（源码已变，找不到要改的那段）`);
    continue;
  }
  await rm(`${here}.mut`, { recursive: true, force: true });
  await mkdir(`${here}.mut/hilt`, { recursive: true });
  await cp(runtimeDir, `${here}.mut/runtime`, { recursive: true });
  await cp(`${plain}/hilt`, `${here}.mut/hilt`, { recursive: true });
  await writeFile(`${here}.mut/${file}`, source.replaceAll(from, to));
  const mut = (path) => `${here}.mut/${path}`.replace(/\\/g, '/');
  const alias = {
    hilt: mut('hilt/index.ts'),
    'hilt/jsx-runtime': mut('hilt/jsx-runtime.ts'),
    'hilt/jsx-dev-runtime': mut('hilt/jsx-runtime.ts'),
    'hilt/css': mut('hilt/css.ts'),
    '@hilt/reactive': mut('runtime/reactive.js'),
    '@hilt/attrs': mut('runtime/attrs.js'),
    '@hilt/rules': mut('runtime/rules.js'),
    '@hilt/server': mut('runtime/server.js'),
    '@hilt/state': mut('runtime/state.js'),
    '@hilt/runtime': mut('runtime/index.js'),
  };
  const env = { ...process.env, FUZZ_ALIAS: JSON.stringify(alias), FUZZ_REACTIVE: pathToFileURL(mut('runtime/reactive.js')).href };
  const key = `${direction}:${seeds}`;
  if (!baselines.has(key)) baselines.set(key, passed({ ...process.env }, direction, seeds));
  const base = baselines.get(key);
  const { line, passed: got } = passed(env, direction, seeds);
  const caught = got < base.passed;
  if (!caught) missed++;
  console.log(`${caught ? '抓到' : '漏掉'} [${direction}] ${name}：基线通过 ${base.passed}，变异体 ${got}/${seeds}；${line.replace(/^.*?通过/, '').slice(0, 120)}`);
}
await rm(`${here}.mut`, { recursive: true, force: true });
process.exitCode = missed ? 1 : 0;
