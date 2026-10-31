// 缺陷 006：<input type="checkbox" value={null}>（或 undefined 经 fn 变成 null）客户端把 value 写成了 ""，服务端没有 value attribute（即 "on"）。
// 位置：03-publish/packages/runtime/attrs.js 的 attrValue：`value == null` 分支对 input 一律 `el.value = ''`；
//       checkbox / radio 的 value 属性是 value 模式 "default/on"，赋值会创建 value="" 的 attribute，提交表单的值从 "on" 变成 ""。
// node 18-plain/fuzz/bugs/006-checkbox-null-value-writes-empty-value-on-client.mjs
import { client, server, verdict } from '../lib/repro.mjs';

const html = await server(`
import { renderToString } from 'hilt';
export const render = () => renderToString(() => <input type="checkbox" value={null} />);
`);
const { result, errors } = await client(`
import { mount } from 'hilt';
const host = document.createElement('div');
document.body.append(host);
mount(() => <input type="checkbox" value={null} />, host);
const el = host.firstElementChild;
window.result = { value: el.value, attr: el.getAttribute('value') };
`);
const parsed = await client('window.result = null;', { html });
void parsed;
console.log('服务端', html, '客户端', result, errors);
verdict(result.value === 'on', 'null 的 checkbox value 保持默认 "on"', `客户端 value=${JSON.stringify(result.value)} attribute=${JSON.stringify(result.attr)}；服务端 ${html}`);
