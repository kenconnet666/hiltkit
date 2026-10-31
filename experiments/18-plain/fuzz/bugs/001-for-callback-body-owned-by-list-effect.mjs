// 缺陷 001：For 的回调体里直接写的 onCleanup / effect / model 不属于“行”，属于整个 For 的渲染 effect。
// 位置：18-plain/hilt/index.ts 的 For -> createRow：`const content = rowValue(...)`（即回调）在 `scope(...)` 之外执行，
//       此时 activeOwner 是 For 自己的 renderEffect；每次 each 变化它重跑，名下所有 onCleanup 执行、子 effect 被销毁。
// 现象：行 1 还在列表里，只是在它前面插入了一行，行 1 回调体里登记的 onCleanup 就执行了，effect 也不再响应。
//       放进子组件里（<Row />）就没事——因为组件是在 scope 里执行的。
// 影响：{(item) => { const stop = model(...); onCleanup(...); effect(...); return <li/>; }} 这种写法在第一次列表变化后就失效。
// 对照：Solid 的 For 回调在每行自己的 root 里执行。修法：把回调的调用挪进 scope(() => ...) 里。
// node 18-plain/fuzz/bugs/001-for-callback-body-owned-by-list-effect.mjs
import { client, verdict } from '../lib/repro.mjs';

const { result, errors } = await client(`
import { For, effect, flushSync, mount, onCleanup, sig } from 'hilt';
const list = sig([1]);
const log = [];
const seen = sig(0);
const dep = sig(0);
mount(() => (
  <ul>
    <For each={list}>
      {(id) => {
        onCleanup(() => log.push('cleanup ' + id));
        effect(() => log.push('effect ' + id + ' dep=' + dep()));
        return <li>{id}</li>;
      }}
    </For>
  </ul>
), document.body);
log.push('--- 在前面插入一行');
list.set([2, 1]);
flushSync();
log.push('--- 改 dep');
dep.set(1);
flushSync();
window.result = log;
`);
console.log(JSON.stringify(result), errors);
const wrongCleanup = result.slice(result.indexOf('--- 在前面插入一行')).some((line) => line === 'cleanup 1');
const effectDead = !result.includes('effect 1 dep=1');
verdict(!wrongCleanup && !effectDead, '行内回调体的 onCleanup / effect 跟着行走', `留下的行 1 被清理了（${wrongCleanup}），行 1 的 effect 之后不再响应 dep（${effectDead}）`);
