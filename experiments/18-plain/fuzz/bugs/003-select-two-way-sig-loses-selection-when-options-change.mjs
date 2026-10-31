// 缺陷 003：<select value={sig}> 的选项由 For 渲染，选项列表整体换掉之后，选中项没有按 sig 的值重新对齐。
// 位置：18-plain/hilt/index.ts 的 twoWay() -> @hilt/attrs 的 bindInput：只在 sig 变化时写 el.value，选项变化不会触发；
//       传函数（单向）走 setAttr -> attrValue -> keepSelect（MutationObserver 监听 option 变化再对齐），传 Sig 的路径没有这一步。
// 现象：sig 是 'b'，选项从 [b, c] 换成 ['', b]，被选中的旧 b 选项被移除，浏览器退回选第一项（''），sig 仍是 'b'，界面和状态不一致；
//       同样的状态从头挂载是 'b'。选项异步到达（先挂载、后加载列表）是同一个问题。
// 修法：twoWay 对 select 同样装上 keepSelect 的对齐（或把对齐放进 bindInput）。
// node 18-plain/fuzz/bugs/003-select-two-way-sig-loses-selection-when-options-change.mjs
import { client, verdict } from '../lib/repro.mjs';

const { result, errors } = await client(`
import { For, flushSync, mount, sig } from 'hilt';
const make = async (picker) => {
  const pick = sig('b');
  const options = sig([{ id: 1, v: 'b' }, { id: 2, v: 'c' }]);
  const host = document.createElement('div');
  document.body.append(host);
  mount(() => <select value={picker(pick)}><For each={options} by={(o) => o.id}>{(o) => <option value={() => o().v}>{() => o().v}</option>}</For></select>, host);
  const select = host.firstElementChild;
  const out = { before: select.value };
  options.set([{ id: 3, v: '' }, { id: 4, v: 'b' }]);
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 0)); // keepSelect 的 MutationObserver 在微任务里对齐
  out.after = select.value;
  return out;
};
window.result = (async () => ({ sig: await make((pick) => pick), fn: await make((pick) => () => pick()) }))();
`);
console.log(JSON.stringify(result), errors);
verdict(result.sig.after === 'b', 'Sig 双向的 select 在选项变化后仍选中 sig 的值', `传 Sig：选项换掉后选中 ${JSON.stringify(result.sig.after)}（应为 "b"）；传函数（单向）是 ${JSON.stringify(result.fn.after)}`);
