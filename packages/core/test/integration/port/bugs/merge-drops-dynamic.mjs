// node test/integration/port/bugs/merge-drops-dynamic.mjs
// 缺陷：组件用 merge({...}, rest) 转发 rest 时，使用方传来的 {...dynamic(...)} 丢了（dynamic 层挂在 symbol 键上，merge 只遍历 Object.keys）。
// 期望：merge 把 dynamic 层原样带到结果上（组件库的 ...rest 转发是主路径）。
import { open, verdict } from './lib.mjs';

const { browser, page } =
  await open(`import { dynamic, flushSync, merge, mount, sig } from 'hiltkit';
const extra = sig({ 'data-extra': 'yes' });
window.flushSync = flushSync; window.setExtra = (v) => extra.set(v);
function ViaMerge({ label, ...rest }) { return <i id="via-merge" {...merge({ class: 'x' }, rest)}>{label}</i>; }
function ViaSpread({ label, ...rest }) { return <i id="via-spread" {...rest}>{label}</i>; }
mount(() => <div><ViaMerge label="m" {...dynamic(() => extra())} /><ViaSpread label="s" {...dynamic(() => extra())} /></div>, document.body);`);
const extra = (id) =>
  page.evaluate((target) => document.getElementById(target).getAttribute('data-extra'), id);
verdict(
  '...rest 直接展开：dynamic 到达元素（对照）',
  (await extra('via-spread')) === 'yes',
  await extra('via-spread'),
);
verdict(
  '经 merge(…, rest) 转发：dynamic 到达元素',
  (await extra('via-merge')) === 'yes',
  await extra('via-merge'),
);
await browser.close();
