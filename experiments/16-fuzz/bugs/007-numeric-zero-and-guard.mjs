// 缺陷 007：{count && <b/>}、{count && 'n'} 在 count 为 0 时，服务端输出 "0"（直接求值，和 JS 语义一致），
// 客户端被编译器的条件守卫改写成 `!!count ? … : null`，什么都不渲染。同一份源码两个产物结果不同：
// 服务端 HTML 有 "0"，水合时多出的文本节点没人认领（或被留下），纯客户端挂载没有 "0"。
// 位置：03-publish/packages/compiler/index.mjs 的 conditionGuard()（客户端产物把 && 改成三元，服务端产物 compileElementServer 不改）。
// node 16-fuzz/bugs/007-numeric-zero-and-guard.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let count = _state<any>(init.count);
  (globalThis as any).__apis[slot] = { apply() {}, snapshot: () => ({ count }) };
  return <p id="root">items:{count && 'n'}<b>x</b></p>;
});`;
const r = await runScenario({ source, init: { count: 0 } });
console.log('服务端 HTML：', r.html);
console.log('服务端 vs 纯客户端：', r.ssrVsFresh);
report(!r.ssrVsFresh, '服务端与客户端一致', 'count 为 0 时服务端输出 "0"，客户端不输出');
