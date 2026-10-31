// 缺陷 009：不带 key 的列表，数据里有重复的元素（字符串 / 数字列表里最常见：['a', 'a']，或同一个对象放两次），
// 行按“元素本身”当 key 放进 Map，第二行把第一行顶掉：第一行的节点永远没插进文档（客户端挂载只有 1 行，服务端输出 2 行），
// 也没有任何提示。带 key 但 key 重复同理（那是用户的错，但同样静默丢行）。
// 位置：03-publish/packages/runtime/index.js 的 For() 的 reconcile：`next.set(key, row)` / `rows.set(...)` 覆盖了同 key 的行，
// order 只含 Map 里剩下的行。
// node 16-fuzz/bugs/009-list-duplicate-items-drop-rows.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let names = _state<any>(init.names);
  (globalThis as any).__apis[slot] = { apply(name: string, v: any) { if (v.t === 'push') names.push(v.v); }, snapshot: () => ({ names: _state.snapshot(names) }) };
  return <ul id="root">{names.map((n: string) => <li>{n}</li>)}</ul>;
});`;
const r = await runScenario({ source, init: { names: ['a', 'a', 'b'] }, rounds: [[{ t: 'list', name: 'names', op: { t: 'push', v: 'a' } }]] });
console.log('服务端 HTML：', r.html);
console.log('服务端 vs 纯客户端：', r.ssrVsFresh);
console.log('push 之后 水合 vs 纯客户端：', r.rounds[0].diff);
report(!r.ssrVsFresh, '重复元素的行数一致', "['a','a','b'] 在客户端少渲染了一行（服务端 3 行）");
