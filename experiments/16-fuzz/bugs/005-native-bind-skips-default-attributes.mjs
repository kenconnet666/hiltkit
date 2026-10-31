// 缺陷 005（轻微）：原生元素的 value={_bind(x)} / checked={_bind(x)} 只写 property，不像单向的 value={x}（attrValue / attrState）
// 和服务端那样同步 value / checked 这两个 default attribute。结果同一份状态：服务端 HTML 与水合后的节点有
// value="…" / checked，纯客户端挂载出来的节点没有；表单 reset、[value] 选择器、defaultValue 因此不同。
// 位置：03-publish/packages/runtime/attrs.js 的 bindInput()（renderEffect 里直接 el.value = text / el[key] = value）。
// node 16-fuzz/bugs/005-native-bind-skips-default-attributes.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let text = _state<any>(init.text);
  let on = _state<any>(init.on);
  (globalThis as any).__apis[slot] = { apply() {}, snapshot: () => ({ text, on }) };
  return <div id="root"><input value={_bind(text)} /><input type="checkbox" checked={_bind(on)} /></div>;
});`;
const r = await runScenario({ source, init: { text: 'hi', on: true }, strictFormAttrs: true });
console.log('服务端 vs 纯客户端：', r.ssrVsFresh);
report(!r.ssrVsFresh, '服务端与客户端挂载同形', '_bind 的 value / checked 没有同步 default attribute');
