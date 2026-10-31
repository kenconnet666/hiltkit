// node 03-publish/runes/run.mjs
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../../lib/browser.mjs';
import { hiltBuild } from '../rows/build.mjs';

const code = await bundle(fileURLToPath(new URL('./entry.tsx', import.meta.url)), { ...hiltBuild, minify: false });
const browser = await launch();
const page = await openPage(browser, code);
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const flush = () => page.evaluate(() => window.flushSync());
const log = () => page.evaluate(() => ({ ...window.log }));
const ev = (fn, arg) => page.evaluate(fn, arg);

check('正常的组件体没有诊断（_state 初始值、props 传递都不算）', (await ev(() => window.warnings.length)) === 0, await ev(() => window.warnings.slice(0, 2)));

// 粒度
const before = await log();
await ev(() => window.setTone('green'));
await flush();
const after = await log();
const rerun = (key) => after[key] - before[key];
console.log(`info 改 tone 一个字段：读取函数写法 size 效果重跑 ${rerun('read.size')} 次、tone 重跑 ${rerun('read.tone')} 次；活对象写法 size 重跑 ${rerun('live.size')} 次、tone 重跑 ${rerun('live.tone')} 次`);
check('活对象：只重跑读到这个字段的 effect', rerun('live.size') === 0 && rerun('live.tone') === 1, { after });

// 返回值
check('return {count}：初值', (await log()).counterSeen === 1);
await ev(() => window.counter.inc());
await flush();
check('return {count}：方法改了，外面看到', (await log()).counterSeen === 2, await log());
check('return {doubled}：派生也活', (await ev(() => window.counter.doubled)) === 4);
await ev(() => {
  window.counter.count = 10;
});
await flush();
check('return {count}：外面能写回', (await log()).counterSeen === 10 && (await ev(() => window.counter.doubled)) === 20, await log());

// context
check('provide({color})：初值', (await ev(() => document.getElementById('ctx').textContent)) === 'red');
await ev(() => window.setColor('blue'));
await flush();
check('provide({color})：下层跟着变', (await ev(() => document.getElementById('ctx').textContent)) === 'blue');

// 快照
await ev(() => window.fire());
await ev(() => window.setShot(2));
await flush();
await ev(() => window.fire());
const shots = await ev(() => window.pending.map((item) => item.shot));
check('嵌套函数里的字面量是当时的值', shots.join() === '1,2', shots);
const liveDescriptor = await ev(() => typeof Object.getOwnPropertyDescriptor(window.pending[0], 'shot').get);
check('嵌套函数里的字面量是普通属性', liveDescriptor === 'undefined', liveDescriptor);

// 初始值
await ev(() => window.setSize('lg'));
await flush();
check('_state({size}) 是初始值，不跟 prop 走', (await ev(() => window.readForm().size)) === 'sm', await ev(() => window.readForm()));
check('const 派生放进对象：活', (await ev(() => window.derivedBag.label)) === 'lg!', await ev(() => window.derivedBag.label));
const setterOnDerived = await ev(() => typeof Object.getOwnPropertyDescriptor(window.derivedBag, 'label').set);
check('const 派生放进对象：没有 setter', setterOnDerived === 'undefined', setterOnDerived);

// 元素引用
check('ref={el} 不用第二个符文', (await log()).elSeen === 'SECTION', await log());
check('属性也跟着 prop', (await ev(() => document.getElementById('comp').getAttribute('data-size'))) === 'lg');

// 诊断
check('诊断：_untrack 明确只要初始值，不报', (await ev(() => window.mountGood())) === 0, await ev(() => window.warnings.slice(-1)));
const bad = await ev(() => window.mountBad());
check('诊断：解构组合式函数的返回值被查到（编译器做不到）', bad === 1, bad);
const stack = await ev(() => window.warnings.at(-1));
console.log(`info 诊断时的调用栈：\n${stack.split('\n').slice(1, 4).join('\n')}`);

await browser.close();
