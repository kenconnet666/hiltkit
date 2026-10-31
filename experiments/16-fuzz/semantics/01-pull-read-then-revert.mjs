// 语义差异（不是缺陷，alien-signals 的取舍）：flush 之前读了一个被改过的 signal / computed，再把它改回原值，
// 依赖它的 effect 仍会重跑一次（读的那一刻把中间值提交了，依赖方已被标脏，之后无法撤销）。
// 内核方向的生成器因此把“拉取读”都放在一批写入的最后。node 16-fuzz/semantics/01-pull-read-then-revert.mjs
import { effect, flushSync, signal } from '../../03-publish/packages/runtime/reactive.js';

const count = signal(1);
let runs = 0;
effect(() => {
  count.value;
  runs++;
});
flushSync();
count.value = 2;
void count.value; // 中间有人读了一下
count.value = 1; // 又改回去
flushSync();
console.log('effect 运行次数（值最终没变，期望 1）：', runs);
