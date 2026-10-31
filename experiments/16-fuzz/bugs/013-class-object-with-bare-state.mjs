// 缺陷 013（编译器）：class={{ active: on }} 这类“对象字面量的属性值直接是符文变量”的写法，被活对象规则改成带 getter 的对象，
// 但 mayBeReactive() 把对象方法（getter）当成函数、判定“不读响应式数据”，于是这条 setClass 不包 renderEffect，只在创建时写一次，
// 之后 on 变了 class 不更新（style={{ color: on }}、data-x={{...}.q} 同理）。属性值换成表达式（!!on、on ? a : b）就正常。
// 位置：03-publish/packages/compiler/index.mjs：makeLiveProperty()（JSX 属性里的对象字面量也被改写）+ mayBeReactive()
// （ObjectMethod 提前返回 false），两处合起来让单值写法（setClass / setStyle / attrStr）丢了 effect。
// node 16-fuzz/bugs/013-class-object-with-bare-state.mjs
import { compile } from '../../03-publish/packages/compiler/index.mjs';
import { report, runScenario } from '../lib/scenario.mjs';

const body = `<b class={{ active: on }} />`;
const out = (await compile(`export const A = _component(() => { let on = _state(false); return ${body}; });`, 'a.tsx', { generate: 'client' })).code;
console.log(out.split('\n').filter((line) => /setClass|renderEffect/.test(line)).join('\n'));
const source = `
export const Root = _component(({ slot }: any) => {
  const init = (globalThis as any).__init;
  let on = _state<any>(init.on);
  (globalThis as any).__apis[slot] = { apply(name: string, v: any) { on = v; }, snapshot: () => ({ on }) };
  return <div id="root">${body}</div>;
});`;
const r = await runScenario({ source, init: { on: false }, rounds: [[{ t: 'set', name: 'on', v: true }]] });
console.log('改状态后 水合 vs 纯客户端：', r.rounds[0].diff);
report(!r.rounds[0].diff, 'class 随状态更新', 'class={{ active: on }} 在 on 变化后没有更新');
