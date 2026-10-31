// 缺陷 012：条件分支里的片段 / 多个子节点（编译成“函数数组”），分支在更新时才第一次创建，里面的组件读不到 context：
// useId() 抛 TypeError（getContext()[IDS] 是 undefined），inject() 拿到默认值而不是 provide 的值。首次渲染（水合或挂载）时正常。
// 原因：insert() 在 withContext(saved, …) 里只求了 read()，随后的 toNodes(value) 在外面；数组里的函数项在 toNodes 里
// 才起嵌套的 insert，它取 getContext() 作为 saved，更新是在 flush 里跑的，此时全局 context 是 ROOT_CONTEXT。
// 位置：03-publish/packages/runtime/index.js 的 insert()：`const nodes = toNodes(value)` 应该也在 saved 的 context 里。
// node 16-fuzz/bugs/012-context-lost-in-fragment-on-update.mjs
import { report, runScenario } from '../lib/scenario.mjs';

const source = `
import { createContext, inject, provide, useId } from '@hilt/runtime';
const Theme = createContext('none');
const Leaf = _component(() => <i class="leaf">{inject(Theme)}</i>);
const Labelled = _component(() => { const id = useId(); return <label for={id}>x</label>; });
const Provider = _component(({ children }: any) => { provide(Theme, 'dark'); return <section>{children}</section>; });
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let open = _state<any>(init.open);
  (globalThis as any).__apis[slot] = { apply(name: string, v: any) { open = v; }, snapshot: () => ({ open }) };
  return <div id="root"><Provider>{open && <><Leaf /><Labelled /></>}</Provider></div>;
});`;
const r = await runScenario({ source, init: { open: false }, rounds: [[{ t: 'set', name: 'open', v: true }]] });
console.log('展开后 水合 vs 纯客户端：', r.rounds[0].diff);
console.log('页面错误：', r.errors);
report(!r.rounds[0].diff && !r.errors.length, '更新时创建的片段读得到 context', '更新时才创建的片段里 inject 拿不到值 / useId 抛错');
