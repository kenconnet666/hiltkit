// 缺陷 006：懒加载组件在 hydrate() 之前已经加载完（Lazy.preload() 或同一个 lazy 的上一个实例已经加载），
// 水合时走 `if (loaded) return component(loaded, props)`，没有跳过服务端为这一段输出的 <!--[--> 标记，
// children 是元素时模板把注释节点当成元素认领，抛 TypeError，页面停在服务端输出（children 只是文本时碰巧不报错）。
// 不用显式 preload 也会踩到：同一个 lazy 在树里出现两次，先水合的那个把 loaded 置真，后水合的（比如在另一个推迟接管的内容里、或自己嵌套自己）就走这条路。
// 位置：03-publish/packages/runtime/index.js 的 lazy() 里 Lazy：`hydrating && !loaded && isMark(cursor, '[')` 才走 deferHydration，
// loaded 为真时既不跳标记也不认领 [ ]。
// node 16-fuzz/bugs/006-lazy-preloaded-before-hydrate.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
import { lazy } from '@hilt/runtime';
const Card = _component(({ children }: any) => <div>{children}</div>);
const LazyCard = lazy(() => Promise.resolve({ default: Card }), { hydrate: 'load' });
export const lazies = [LazyCard];
export const Root = _component(({ slot }: any) => {
  (globalThis as any).__apis[slot] = { apply() {}, snapshot: () => ({}) };
  return <div id="root"><LazyCard><section>hello</section></LazyCard></div>;
});`;
const ok = await runScenario({ source, preload: false });
const bad = await runScenario({ source, preload: true });
console.log('不预加载：', { error: ok.hydrateError, mutations: ok.mutations, sameNodes: ok.sameNodes });
console.log('预加载后水合：', { error: bad.hydrateError, mutations: bad.mutations, sameNodes: bad.sameNodes });
report(!bad.hydrateError && !bad.mutations.length && bad.sameNodes, '预加载后也能无改动水合', '预加载过的懒组件水合时抛错或改了 DOM');
