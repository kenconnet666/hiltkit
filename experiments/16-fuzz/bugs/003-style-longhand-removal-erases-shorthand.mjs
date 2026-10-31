// 缺陷 003：style 里简写（margin）和长写（margin-top）分在不同层时，撤掉长写会 removeProperty('margin-top')，
// 把简写同时给出的 margin-top 一起删了；从头渲染的结果是 margin-top 仍是简写的值。
// 位置：03-publish/packages/runtime/attrs.js 的 Host.setStyle() 的 removeProperty 分支（只按属性名逐个删，不考虑简写展开）。
// 例：基础样式 margin: 8px，使用方 style={{ marginTop: open ? '0' : undefined }}，open 变回 false 后上边距丢了。
// node 16-fuzz/bugs/003-style-longhand-removal-erases-shorthand.mjs
import { fileURLToPath } from 'node:url';
import { runInBrowser } from '../lib/page.mjs';

const runtime = fileURLToPath(new URL('../../03-publish/packages/runtime/index.js', import.meta.url));
const { result } = await runInBrowser(
  `import { spread, merge, signal, flushSync } from ${JSON.stringify(runtime)};
   const open = signal(true);
   const layers = merge({ style: { margin: '8px' } }, { get style() { return open.value ? { marginTop: '0px' } : {}; } });
   const el = document.createElement('div');
   spread(el, layers);
   const beforeTop = el.style.marginTop;
   open.value = false;
   flushSync();
   const fresh = document.createElement('div');
   spread(fresh, layers);
   window.result = { open: beforeTop, afterIncremental: el.style.marginTop, fresh: fresh.style.marginTop };`,
  import.meta.dirname,
);
console.log(JSON.stringify(result));
const bad = result.afterIncremental !== result.fresh;
console.log(bad ? 'FAIL 增量更新后 margin-top 丢了（从头渲染是 8px）' : 'ok');
process.exitCode = bad ? 1 : 0;
