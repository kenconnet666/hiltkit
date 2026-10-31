// 缺陷 010（轻微）：<select value="a"> 里有两个 value 相同的 <option>，服务端给每个匹配的 option 都写 selected，
// HTML 解析器留下最后一个；客户端 el.value = 'a' 选中的是第一个。同一份状态两边选中的选项不同。
// 位置：03-publish/packages/runtime/server.js 的 ssrElement()：`String(value ?? inner) === String(currentSelect.value)` 每个 option 都命中，
// 没有“只标第一个”；对照客户端 attrs.js 的 attrValue / keepSelect（el.value = text，选第一个匹配项）。
// node 16-fuzz/bugs/010-select-duplicate-option-values.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let pick = _state<any>(init.pick);
  (globalThis as any).__apis[slot] = { apply(name: string, v: any) { pick = v; }, snapshot: () => ({ pick }) };
  return <div id="root"><select value={_bind(pick)}><option value="a">first</option><option value="b">b</option><option value="a">second</option></select></div>;
});`;
const r = await runScenario({ source, init: { pick: 'a' } });
console.log('服务端 HTML：', r.html);
console.log('服务端 vs 纯客户端：', r.ssrVsFresh);
report(!r.ssrVsFresh, '选中项一致', '重复 value 的 option：服务端选中最后一个，客户端选中第一个');
