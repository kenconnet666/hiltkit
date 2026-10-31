// 缺陷 007：merge 对 style 的合并（一律先转成对象再展开）和 rules.js 文档的分层语义、以及不经 merge 的 style 写法不一致。四处：
//   a. 字符串里的分号和冒号在括号里也被切开：background:url(data:image/png;base64,xx) 被切碎，丢掉整条声明
//   b. 字符串里的属性名没有转小写：'COLOR : Red' 合并后变成非法属性名，整条丢掉（单独写 style="COLOR : Red" 是好的）
//   c. 同一属性在对象里既有 camelCase 又有 kebab-case 时，对象展开保留的是“先出现的位置”：
//      merge({ marginTop: 1 }, { 'margin-top': 2 }, { marginTop: 3 }) 最终是 2px，应当是最上层的 3px
//   d. 上层对象里的 undefined 盖掉了下层的值（rules.js：对象里 undefined 落回下层）：
//      merge({ style: { color: 'red' } }, { style: { color: undefined } }) 丢了 red
// 位置：18-plain/hilt/index.ts 的 merge 的 style 分支和 toStyle。
// 修法思路：不要展平成一个对象，像 class 那样保留层（[previous, value]），交给落元素时的 styleOf 逐层处理（已经有 rules.js 的实现）。
// node 18-plain/fuzz/bugs/007-merge-style-string-and-object-semantics.mjs
import { client, verdict } from '../lib/repro.mjs';

const { result, errors } = await client(`
import { createElement, merge, mount } from 'hilt';
const style = (props) => {
  const host = document.createElement('div');
  document.body.append(host);
  mount(() => createElement('div', props), host);
  const el = host.firstElementChild;
  return { color: el.style.color, marginTop: el.style.marginTop, bg: el.style.backgroundImage };
};
window.result = {
  urlString: style(merge({ style: 'color:red' }, { style: 'background-image:url(data:image/png;base64,xx)' })).bg,
  urlStringAlone: style({ style: 'background-image:url(data:image/png;base64,xx)' }).bg,
  upperName: style(merge({ style: 'COLOR : Red' }, { style: 'margin-top:1px' })).color,
  upperNameAlone: style({ style: 'COLOR : Red' }).color,
  camelKebab: style(merge({ style: { marginTop: '1px' } }, { style: { 'margin-top': '2px' } }, { style: { marginTop: '3px' } })).marginTop,
  undefinedFallsBack: style(merge({ style: { color: 'red' } }, { style: { color: undefined } })).color,
};
`);
console.log(JSON.stringify(result), errors);
const problems = [];
if (result.urlString !== result.urlStringAlone) problems.push(`a. 括号里的分号被切开：merge 后 background-image=${JSON.stringify(result.urlString)}（单独写是 ${JSON.stringify(result.urlStringAlone)}）`);
if (result.upperName !== 'red') problems.push(`b. 大写属性名：merge 后 color=${JSON.stringify(result.upperName)}（单独写是 ${JSON.stringify(result.upperNameAlone)}）`);
if (result.camelKebab !== '3px') problems.push(`c. camel/kebab 混用：margin-top=${JSON.stringify(result.camelKebab)}，应为 "3px"`);
if (result.undefinedFallsBack !== 'red') problems.push(`d. 上层 undefined：color=${JSON.stringify(result.undefinedFallsBack)}，应落回 "red"`);
verdict(!problems.length, 'merge 的 style 语义正确', problems.join('；'));
