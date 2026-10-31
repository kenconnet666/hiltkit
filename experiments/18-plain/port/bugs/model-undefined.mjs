// node 18-plain/port/bugs/model-undefined.mjs
// 缺陷：model(source, fallback) 把 undefined 当成“没给”：只读来源（值或读取函数）变回 undefined 时，本地仍停在上一个值。
// 对 Model<string | undefined>（Tabs 的 value：undefined = 没有选中，回到第一个）这是语义错误；传 Sig 的路径不受影响。
// 期望：来源是函数时，函数返回什么就跟什么，包括 undefined；只有“根本没传 source”才用 fallback。
import { open, verdict } from './lib.mjs';

const { browser, page, flush } = await open(`import { flushSync, model, mount, sig } from 'hilt';
const upstream = sig('b');
window.setUp = (v) => upstream.set(v); window.flushSync = flushSync;
function Probe() { const m = model(() => upstream(), undefined); return <p id="p">{() => String(m())}</p>; }
mount(() => <Probe />, document.body);`);
const text = () => page.evaluate(() => document.getElementById('p').textContent);
verdict('初值跟随来源', (await text()) === 'b', await text());
await page.evaluate(() => { window.setUp(undefined); window.flushSync(); });
verdict('来源变成 undefined，本地跟着变', (await text()) === 'undefined', await text());
await browser.close();
