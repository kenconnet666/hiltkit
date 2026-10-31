// 缺陷 014（轻微）：原生元素 checked={_bind(x)} / value={_bind(x)}，用户操作写回了新值，同一个 tick 里（flush 之前）程序又把 x 改回原值，
// signal 的净变化为零，bindInput 的 renderEffect 不重跑，DOM 停在用户改的值，和状态不一致（受控输入变成了“失控”）。
// 位置：03-publish/packages/runtime/attrs.js 的 bindInput()：只靠 signal 通知回写 DOM，没有在写回之后对账
// （_bindable 的 set 里有 queueMicrotask 对账，原生 _bind 没有）。
// node 16-fuzz/bugs/014-native-bind-desync-on-same-tick-revert.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let on = _state<any>(init.on);
  (globalThis as any).__apis[slot] = { apply(name: string, v: any) { on = v; }, snapshot: () => ({ on }) };
  return <input data-bind="0" type="checkbox" checked={_bind(on)} />;
});`;
// 初始 true；用户点一下（false），再点一下并在同一个 tick 里把状态设回 false
const r = await runScenario({ source, init: { on: true }, rounds: [[{ t: 'type', n: 0, v: '' }], [{ t: 'type', n: 0, v: '' }, { t: 'set', name: 'on', v: false }]], strictFormAttrs: true });
console.log('第二轮 水合 vs 纯客户端：', r.rounds[1].diff, JSON.stringify(r.rounds[1].snapshot));
report(!r.rounds[1].diff, 'DOM 与状态一致', '状态是 false，复选框还勾着');
