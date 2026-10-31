// 缺陷 005：<textarea value={null}>（或函数返回 null）服务端输出的文本是 "null"，客户端是空串。
// 位置：03-publish/packages/runtime/server.js 的 renderAttrs：`if (tag === 'textarea') inner = escapeText(value)`，
//       escapeText 里 String(null) = 'null'；value 为 undefined 时 scan 已经跳过，所以只有 null 中招。
// 影响：水合时 textarea 的子文本 "null" 留在 DOM 里，el.value 却被 hydrate 当作 ''（页面看到的是 "null" 字样直到用户改动）。
// node 18-plain/fuzz/bugs/005-textarea-null-value-renders-null-on-server.mjs
import { server, verdict } from '../lib/repro.mjs';

const html = await server(`
import { renderToString } from 'hilt';
export const render = () => ({
  literal: renderToString(() => <textarea value={null} />),
  fn: renderToString(() => <textarea value={() => null} />),
  undef: renderToString(() => <textarea value={undefined} />),
});
`);
console.log(html);
verdict(!/null/.test(html.literal + html.fn), 'null 的 textarea 值输出为空', `value={null}: ${html.literal}  value={() => null}: ${html.fn}（undefined: ${html.undef}）`);
