// 开销：window.bench(rounds) 返回 { 标题: { 标签: 毫秒 } }，每项取 rounds 轮的中位数。
//  1. 写一万个元素各 10 个属性：运行时查表、编译期选好写法，对比直接 setAttribute
//  2. 合并后的 spread：静态键、getter 键、动态键层
import { attrBool, attrStr, setAttr, setClass, spread } from '../03-publish/packages/runtime/attrs.js';
import { flushSync, signal } from '../03-publish/packages/runtime/reactive.js';
import { merge } from '../03-publish/packages/runtime/rules.js';

const N = 10_000;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fresh = (tag = 'div') => Array.from({ length: N }, () => document.createElement(tag));

/** 每轮新元素（不计时）；fn 对每个元素做事；返回中位数毫秒 */
function time(rounds, prepare, run) {
  const samples = [];
  for (let r = -1; r < rounds; r++) {
    const state = prepare();
    const start = performance.now();
    run(state);
    const ms = performance.now() - start;
    if (r >= 0) samples.push(ms);
  }
  return +median(samples).toFixed(2);
}

const TEN = [['id', 'x'], ['class', 'a b'], ['title', 't'], ['role', 'button'], ['tabindex', 0], ['data-i', 1], ['aria-label', 'l'], ['aria-expanded', false], ['disabled', true], ['hidden', false]];

function setAttrBench(rounds) {
  const rows = {};
  rows['直接 setAttribute（下限，语义不对：hidden=false 会写成 "false"）'] = time(rounds, fresh, (els) => {
    for (const el of els) for (const [k, v] of TEN) el.setAttribute(k, v);
  });
  rows['手写对的语义（className、布尔分支）'] = time(rounds, fresh, (els) => {
    for (const el of els) {
      el.id = 'x';
      el.className = 'a b';
      el.setAttribute('title', 't');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', 0);
      el.setAttribute('data-i', 1);
      el.setAttribute('aria-label', 'l');
      el.setAttribute('aria-expanded', false);
      el.setAttribute('disabled', '');
    }
  });
  rows['setAttr（运行时查表）'] = time(rounds, fresh, (els) => {
    for (const el of els) for (const [k, v] of TEN) setAttr(el, k, v);
  });
  rows['编译期选好写法（attrStr / attrBool / setClass 直接调用）'] = time(rounds, fresh, (els) => {
    for (const el of els) {
      attrStr(el, 'id', 'x');
      setClass(el, 'a b');
      attrStr(el, 'title', 't');
      attrStr(el, 'role', 'button');
      attrStr(el, 'tabindex', 0);
      attrStr(el, 'data-i', 1);
      attrStr(el, 'aria-label', 'l');
      attrStr(el, 'aria-expanded', false);
      attrBool(el, 'disabled', true);
      attrBool(el, 'hidden', false);
    }
  });
  return rows;
}

const noop = () => {};
function spreadBench(rounds) {
  const rows = {};
  rows['静态（merge + spread，每个 7 个键含 class 拼接与 1 个事件）'] = time(rounds, fresh, (els) => {
    for (let i = 0; i < els.length; i++) {
      spread(els[i], merge({ class: 'btn', type: 'button', role: 'button', 'data-scope': 'x' }, { id: `i${i}`, title: 't', class: 'extra', onClick: noop }, { 'aria-busy': false }));
    }
  });
  const signalsFor = () => Array.from({ length: N }, () => signal('a'));
  const prepare = () => ({ els: fresh(), sigs: signalsFor() });
  const reactive = ({ els, sigs }) => {
    for (let i = 0; i < els.length; i++) {
      const s = sigs[i];
      spread(els[i], merge({ class: 'btn', type: 'button', role: 'button' }, { id: `i${i}`, get title() { return s.value; }, get 'aria-label'() { return s.value; }, onClick: noop }));
    }
  };
  rows['2 个 getter 键'] = time(rounds, prepare, reactive);
  const samples = [];
  for (let r = -1; r < rounds; r++) {
    const state = prepare();
    reactive(state);
    flushSync();
    const start = performance.now();
    for (const s of state.sigs) s.value = s.value === 'a' ? 'b' : 'a';
    flushSync();
    if (r >= 0) samples.push(performance.now() - start);
  }
  rows['更新：一万个元素各 2 个属性'] = +median(samples).toFixed(2);
  const flag = signal(true);
  const A = { title: 'A', 'data-a': '1' };
  const B = { title: 'B', 'data-b': '2' };
  rows['动态键层（{...(cond ? a : b)}，每个一个 effect）'] = time(rounds, fresh, (els) => {
    for (let i = 0; i < els.length; i++) spread(els[i], merge({ class: 'btn', role: 'button' }, () => (flag.value ? A : B)));
  });
  return rows;
}

window.bench = (rounds) => ({ '10k 元素 × 10 属性': setAttrBench(rounds), 'spread：10k 元素': spreadBench(rounds) });
