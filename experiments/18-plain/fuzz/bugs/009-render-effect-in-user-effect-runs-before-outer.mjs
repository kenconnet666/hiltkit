// 缺陷 009（内核，继承自 16-fuzz 的 bug 001，18-plain 同样用这份 reactive.js，--mixed 内核方向会撞上）：
// 嵌在用户 effect 里的 renderEffect，外层重跑时内层仍会先跑一次，读到外层条件已经不成立的数据。
// 位置：03-publish/packages/runtime/reactive.js 的 notify()：链式入队保证“外层先于内层”，
//       但外层是用户 effect（进 userQueue）、内层是 renderEffect（进 renderQueue）时，flush 先清 renderQueue，内层排在外层前面。
// plain 路线里的触发方式：在 effect(() => { ... }) 里 mount / renderValue 一段内容（门户、挂到别处的浮层）。
// node 18-plain/fuzz/bugs/009-render-effect-in-user-effect-runs-before-outer.mjs
import { effect, flushSync, onError, renderEffect, signal } from '../../../03-publish/packages/runtime/reactive.js';

const errors = [];
onError((error) => errors.push(error.message));
const open = signal(true);
const user = signal({ name: 'x' });
const seen = [];
effect(() => {
  if (!open.value) return;
  // 只有 open 为真时才该存在的绑定：读 user.value.name
  renderEffect(() => seen.push(user.value.name));
});
flushSync();
open.value = false;
user.value = null; // 同一批里外层条件和内层数据一起变
flushSync();
console.log('内层运行记录', seen, '报错', errors);
if (errors.length) {
  console.log('FAIL 外层条件已不成立，内层 renderEffect 仍被执行并读到 null');
  process.exitCode = 1;
} else console.log('ok');
