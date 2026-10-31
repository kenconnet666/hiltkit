// 缺陷 011：<select value={_bind(x)}> 的选项由 .map 生成时，纯客户端挂载后选中的是第一项而不是 x 对应的那项。
// 原因：bindInput() 的 renderEffect 在选项还没插入时就 el.value = x（没有匹配项，落到第一项），之后选项才进文档，没人再对齐；
// 单向的 value={x} 走 attrValue()，里面有 keepSelect() 观察器负责对齐，_bind 没有。服务端输出带 selected，水合后看起来对，
// 所以只有纯客户端挂载（或选项后来才出现）才错。
// 位置：03-publish/packages/runtime/attrs.js 的 bindInput()（select 的分支应像 attrValue 一样 keepSelect）。
// node 16-fuzz/bugs/011-select-bind-with-mapped-options.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let pick = _state<any>(init.pick);
  const rows = _state<any>(init.rows);
  (globalThis as any).__apis[slot] = { apply() {}, snapshot: () => ({ pick, rows: _state.snapshot(rows) }) };
  return <div id="root"><select value={_bind(pick)}><option value="a">A</option>{rows.map((r: any) => <option value={'m' + r.id}>{r.id}</option>)}</select></div>;
});`;
const r = await runScenario({ source, init: { pick: 'm3', rows: [{ id: 1 }, { id: 3 }] } });
console.log('服务端 HTML：', r.html);
console.log('服务端 vs 纯客户端：', r.ssrVsFresh);
report(!r.ssrVsFresh, '纯客户端选中 m3', 'pick=m3 时纯客户端挂载选中了第一项 a');
