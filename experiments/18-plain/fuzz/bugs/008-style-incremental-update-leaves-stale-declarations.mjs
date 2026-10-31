// 缺陷 008：style 增量更新和“用当前值从头写”的结果不一样，两处：
//   a. 值变成浏览器认为非法的（color: 0、padding-left: 'a'），style.setProperty 被浏览器静默忽略，旧值留在元素上
//   b. 长短写交叠：{ margin-top: x, margin: '8px' } 里 margin-top 消失（x 变成 null），removeProperty('margin-top') 把 margin 简写里的那一边也抹掉；
//      或者简写变了而长写没变（旧值 === 新值，跳过不写），长写被新简写盖掉后没有写回
//   （一次性写入没有这两个问题；服务端把整串 style 写成属性，也没有）
// 位置：03-publish/packages/runtime/attrs.js 的 Host.setStyle / writeProperty（“只写变了的”假定各属性互相独立）。
//   这是 16-fuzz 的 bug 003 同一处，plain 路线同样会撞上。
// 修法思路：a. setProperty 之后若 getPropertyValue 为空就 removeProperty；b. 长短写有交叠的更新直接按新 Map 整体重写（或先全部移除再按序写入）。
// node 18-plain/fuzz/bugs/008-style-incremental-update-leaves-stale-declarations.mjs
import { client, verdict } from '../lib/repro.mjs';

const { result, errors } = await client(`
import { createElement, flushSync, mount, sig } from 'hilt';
const run = (build, change) => {
  const state = sig(build.initial);
  const host = document.createElement('div');
  document.body.append(host);
  mount(() => createElement('div', { style: () => build.style(state()) }), host);
  state.set(change);
  flushSync();
  const fresh = document.createElement('div');
  document.body.append(fresh);
  mount(() => createElement('div', { style: build.style(change) }), fresh);
  return { incremental: host.firstElementChild.style.cssText, fresh: fresh.firstElementChild.style.cssText };
};
window.result = {
  invalidValue: run({ initial: 'red', style: (c) => ({ color: c }) }, 0),
  invalidPadding: run({ initial: '1px', style: (v) => ({ paddingLeft: v }) }, 'a'),
  longhandRemoved: run({ initial: '1px', style: (v) => ({ marginTop: v, margin: '8px' }) }, null),
  shorthandChanged: run({ initial: '8px', style: (m) => ({ margin: m, marginBottom: '4px' }) }, '2px'),
};
`);
console.log(JSON.stringify(result, null, 1), errors);
const bad = Object.entries(result).filter(([, r]) => r.incremental !== r.fresh);
verdict(!bad.length, '增量更新等于从头写', bad.map(([name, r]) => `${name}: 增量 ${JSON.stringify(r.incremental)} ≠ 从头 ${JSON.stringify(r.fresh)}`).join('；'));
