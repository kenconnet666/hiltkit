// 语义差异（设计如此，开发期有 warnings 提示）：组件体只执行一次。组件直接 `return children`，而 children 是
// 一个非 JSX 的动态值（<Pass>{a && 'x'}</Pass>，编译成 getter）时，组件体里读到的是当时的值，之后不再更新；
// children 是 JSX 或多个子节点时是内容函数，没有这个问题。水合方向的生成器因此给 Pass 至少两个子节点。
// node 16-fuzz/semantics/02-component-body-reads-once.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
const Pass = _component(({ children }: any) => children);
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let on = _state<any>(init.on);
  (globalThis as any).__apis[slot] = { apply(name: string, v: any) { on = v; }, snapshot: () => ({ on }) };
  return <p id="root"><Pass>{on && 'shown'}</Pass></p>;
});`;
const r = await runScenario({ source, init: { on: false }, rounds: [[{ t: 'set', name: 'on', v: true }]] });
console.log('改状态后 水合 vs 纯客户端：', r.rounds[0].diff);
report(true, '（语义差异，仅演示）', '');
