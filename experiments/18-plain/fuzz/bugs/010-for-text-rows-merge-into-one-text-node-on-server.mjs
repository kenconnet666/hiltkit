// 缺陷 010：For 的行直接渲染成文本（<For each={tags}>{(t) => t}</For>）时，服务端把相邻两行的文本连着输出，
// 解析后合并成一个文本节点，水合认领不出每行自己的节点；第一次更新就抛 NotFoundError（insertBefore 的参照节点不在父节点里）。
// 位置：18-plain/hilt/server.ts 的 For 输出（行与行之间没有像数组里相邻文本那样放 <!---->）和 index.ts 的 For 水合认领（rowNodes / first）。
//       注意：这是 hilt/index.ts 当前这一版（902 行、有 server.ts）才出现的；之前一版同样的输入没有报错。
// 现象：页面报错（insertBefore / removeChild 的 NotFoundError），列表停在旧内容。
// node 18-plain/fuzz/bugs/010-for-text-rows-merge-into-one-text-node-on-server.mjs
import { client, server, verdict } from '../lib/repro.mjs';

const app = `
import { For, sig } from 'hilt';
export const list = [{ id: 0, label: 'b' }, { id: 6, label: 'c' }];
export const view = (items) => () => <For each={items}>{(item) => item.label}</For>;
`;
const html = await server(`
${app}
import { renderToString } from 'hilt';
export const render = () => renderToString(view(sig(list)));
`);
const { result, errors } = await client(
  `
${app}
import { flushSync, hydrate, mount, onError, sig } from 'hilt';
const seen = [];
onError((error) => seen.push(String(error)));
const items = sig(list);
const target = document.getElementById('app');
hydrate(view(items), target);
items.set([{ id: 0, label: 'c' }]);
flushSync();
window.result = { text: target.textContent, errors: seen };
`,
  { html: `<div id="app">${html}</div>` },
);
console.log('服务端', html, '客户端', result, errors);
verdict(!result.errors.length && result.text === 'c', '文本行的 For 水合后可以更新', `更新后文本 ${JSON.stringify(result.text)}（应为 "c"），报错 ${JSON.stringify(result.errors)}`);
