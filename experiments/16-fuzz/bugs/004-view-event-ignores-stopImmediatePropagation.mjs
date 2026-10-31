// 缺陷 004：多层 props 里同一个事件键，落到元素上时靠后的层调用 stopImmediatePropagation() 之后下层不再执行
// （attrs.js 的 fire()），但组件里读 props.onClick 得到的合并函数只认 preventDefault（rules.js 的 readHandlers()），
// 下层照样执行。同一份 props 两种读法，行为不一致；组件把 props.onClick 手动转交时就会踩到。
// node 16-fuzz/bugs/004-view-event-ignores-stopImmediatePropagation.mjs
import { fileURLToPath } from 'node:url';
import { runInBrowser } from '../lib/page.mjs';

const runtime = fileURLToPath(new URL('../../03-publish/packages/runtime/index.js', import.meta.url));
const { result } = await runInBrowser(
  `import { spread, merge, propsView } from ${JSON.stringify(runtime)};
   const calls = [];
   const props = merge({ onClick: () => calls.push('lower') }, { onClick: (event) => { calls.push('upper'); event.stopImmediatePropagation(); } });
   const el = document.createElement('button');
   spread(el, props);
   el.dispatchEvent(new MouseEvent('click'));
   const onElement = calls.splice(0);
   propsView(props).onClick(new MouseEvent('click'));
   window.result = { onElement, viaView: calls };`,
  import.meta.dirname,
);
console.log(JSON.stringify(result));
const bad = result.onElement.join() !== result.viaView.join();
console.log(bad ? 'FAIL 经 props 读到的合并处理函数没有在 stopImmediatePropagation 之后停下' : 'ok');
process.exitCode = bad ? 1 : 0;
