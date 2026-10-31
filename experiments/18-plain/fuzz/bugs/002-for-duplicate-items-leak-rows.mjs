// 缺陷 002：没给 by 的 For，列表里有重复的值（['a', 'a', 'b']）时，重复的那一行从此脱离管理：
//   后续更新不会移动、删除它，也不会销毁它的作用域（onCleanup 永远不执行），DOM 里残留旧行。
// 位置：18-plain/hilt/index.ts 的 For：`rows` 是 Map<key, row>，键是元素本身；重复键让第二次 set 覆盖第一次，
//       但第一行的节点已经渲染进 DOM，`order` / `rows` 里再也找不到它。（带 by 且键重复同理，那是使用方的错，但同样不该残留）
// 影响：标签、选项这类“值可能重复”的列表（<For each={tags}>）很常见。
// 对照：Solid 的 For 按下标处理重复项；Vue 要求 key 唯一并在开发期警告。至少该警告，或者没给 by 时重复项不要丢行。
// node 18-plain/fuzz/bugs/002-for-duplicate-items-leak-rows.mjs
import { client, verdict } from '../lib/repro.mjs';

const { result, errors } = await client(`
import { For, flushSync, mount, onCleanup, sig } from 'hilt';
const list = sig(['a', 'a', 'b']);
const log = [];
const Row = ({ t }) => { onCleanup(() => log.push('cleanup ' + t)); return <li>{t}</li>; };
const host = document.createElement('div');
document.body.append(host);
mount(() => <ul><For each={list}>{(t) => <Row t={t} />}</For></ul>, host);
const steps = { initial: host.textContent };
for (const next of [['a', 'b'], ['b'], []]) {
  list.set(next);
  flushSync();
  steps[JSON.stringify(next)] = host.textContent;
}
window.result = { steps, log };
`);
console.log(JSON.stringify(result), errors);
const want = { initial: 'aab', '["a","b"]': 'ab', '["b"]': 'b', '[]': '' };
const ok = JSON.stringify(result.steps) === JSON.stringify(want);
verdict(ok, '重复项的列表更新正确', `列表变成 [] 之后 DOM 里还剩 ${JSON.stringify(result.steps['[]'])}（应为空），清理记录 ${JSON.stringify(result.log)}`);
