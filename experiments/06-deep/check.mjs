// 语义断言：node 06-deep/check.mjs        （EAGER=1 时按 Svelte 的方式任何读都建 signal，结果应完全一致）
import { effect, signal, flushSync, onError, untrack } from '../03-publish/packages/runtime/reactive.js';
import { state, snapshot, raw, strictEquals, options } from '../03-publish/packages/runtime/state.js';

if (process.env.EAGER) options.lazySignals = false;
let failed = 0;
let passed = 0;
const effectErrors = [];
onError((error) => effectErrors.push(error));

function check(name, fn) {
  const stops = [];
  watching = stops;
  try {
    fn();
    if (effectErrors.length) throw effectErrors.splice(0)[0];
    passed++;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n       ${String(error?.stack ?? error).split('\n').slice(0, 3).join('\n       ')}`);
  } finally {
    stops.forEach((stop) => stop());
  }
}
let watching = [];

/** 建一个 effect，记录每次的返回值；runs 为含首次的执行次数 */
function watch(fn) {
  const log = [];
  watching.push(effect(() => void log.push(fn())));
  return log;
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual, (_, v) => (v === undefined ? '__undefined__' : v));
  const b = JSON.stringify(expected, (_, v) => (v === undefined ? '__undefined__' : v));
  if (a !== b) throw new Error(`${label} 期望 ${b}，实际 ${a}`);
}
const is = (actual, expected, label = '') => {
  if (actual !== expected) throw new Error(`${label} 期望 ${String(expected)}，实际 ${String(actual)}`);
};
function throws(fn, ErrorType, label = '') {
  try {
    fn();
  } catch (error) {
    if (ErrorType && !(error instanceof ErrorType) && error?.name !== ErrorType.name) throw new Error(`${label} 抛了 ${error?.name}，期望 ${ErrorType.name}`);
    return error;
  }
  throw new Error(`${label} 期望抛错，但没有`);
}

// ================================================================ 1. 基本响应性
console.log('\n# 1 基本响应性');
check('读 / 写属性', () => {
  const p = state({ a: 1 });
  const log = watch(() => p.a);
  p.a = 2;
  flushSync();
  eq(log, [1, 2]);
});
check('嵌套对象', () => {
  const p = state({ n: { m: { x: 1 } } });
  const log = watch(() => p.n.m.x);
  p.n.m.x = 5;
  flushSync();
  eq(log, [1, 5]);
});
check('替换嵌套对象：旧对象不再触发，新对象触发', () => {
  const p = state({ n: { x: 1 } });
  const old = p.n;
  const log = watch(() => p.n.x);
  p.n = { x: 10 };
  flushSync();
  old.x = 99;
  flushSync();
  p.n.x = 11;
  flushSync();
  eq(log, [1, 10, 11]);
});
check('新增 / 删除属性 + 读不存在的属性', () => {
  const p = state({});
  const log = watch(() => p.c);
  p.c = 1;
  flushSync();
  delete p.c;
  flushSync();
  eq(log, [undefined, 1, undefined]);
});
check('in 运算符', () => {
  const p = state({});
  const log = watch(() => 'k' in p);
  p.k = 1;
  flushSync();
  delete p.k;
  flushSync();
  eq(log, [false, true, false]);
});
check('Object.keys / for...in / Object.entries 跟随增删键', () => {
  const p = state({ a: 1 });
  const keys = watch(() => Object.keys(p).join());
  const forIn = watch(() => {
    const out = [];
    for (const k in p) out.push(k);
    return out.join();
  });
  const entries = watch(() => JSON.stringify(Object.entries(p)));
  p.b = 2;
  flushSync();
  delete p.a;
  flushSync();
  eq(keys, ['a', 'a,b', 'b']);
  eq(forIn, ['a', 'a,b', 'b']);
  eq(entries, ['[["a",1]]', '[["a",1],["b",2]]', '[["b",2]]']);
});
check('Object.keys 的 effect 不被已有键的值变化触发', () => {
  const p = state({ a: 1 });
  const log = watch(() => Object.keys(p).join());
  p.a = 2;
  flushSync();
  is(log.length, 1);
});
check('for...of（数组）、JSON.stringify、展开', () => {
  const p = state({ list: [1, 2], o: { x: 1 } });
  const ofLog = watch(() => {
    const out = [];
    for (const v of p.list) out.push(v);
    return out.join();
  });
  const json = watch(() => JSON.stringify(p));
  const spread = watch(() => ({ ...p.o }).x);
  const arrSpread = watch(() => [...p.list].length);
  p.list.push(3);
  p.o.x = 2;
  flushSync();
  eq(ofLog, ['1,2', '1,2,3']);
  eq(json[1], '{"list":[1,2,3],"o":{"x":2}}');
  eq(spread, [1, 2]);
  eq(arrSpread, [2, 3]);
});
check('只读 a 的 effect 不被写 b 触发', () => {
  const p = state({ a: 1, b: 1 });
  const log = watch(() => p.a);
  p.b = 2;
  flushSync();
  is(log.length, 1);
  p.a = 2;
  flushSync();
  is(log.length, 2);
});
check('写相同值不触发；NaN 写 NaN 不触发', () => {
  const p = state({ a: 1, n: NaN });
  const a = watch(() => p.a);
  const n = watch(() => p.n);
  p.a = 1;
  p.n = NaN;
  flushSync();
  is(a.length, 1);
  is(n.length, 1);
});
check('untrack 里读不订阅', () => {
  const p = state({ a: 1 });
  const log = watch(() => untrack(() => p.a));
  p.a = 2;
  flushSync();
  is(log.length, 1);
});

// ================================================================ 2. 数组
console.log('\n# 2 数组');
check('下标写入 / length', () => {
  const arr = state([1, 2, 3]);
  const at1 = watch(() => arr[1]);
  const len = watch(() => arr.length);
  arr[1] = 20;
  flushSync();
  eq(at1, [2, 20]);
  is(len.length, 1);
  arr[5] = 9; // 越界写：length 变，中间是空洞
  flushSync();
  eq(len, [3, 6]);
  arr.length = 1; // 截断：下标 1 的订阅者要看到 undefined
  flushSync();
  eq(len, [3, 6, 1]);
  eq(at1, [2, 20, undefined]);
});
check('push：读 length 的 effect 只跑一次（含首次共 2 次）', () => {
  const arr = state([]);
  const log = watch(() => arr.length);
  arr.push(1);
  flushSync();
  eq(log, [0, 1]);
  arr.push(2, 3, 4);
  flushSync();
  eq(log, [0, 1, 4]);
});
check('effect 里 push 不死循环、不自订阅', () => {
  const arr = state([]);
  let runs = 0;
  watching.push(effect(() => {
    runs++;
    arr.push(runs);
  }));
  flushSync();
  is(runs, 1);
  is(arr.length, 1);
});
for (const [name, op, expected] of [
  ['pop', (a) => a.pop(), [1, 2]],
  ['shift', (a) => a.shift(), [2, 3]],
  ['unshift', (a) => a.unshift(0), [0, 1, 2, 3]],
  ['splice 删除', (a) => a.splice(1, 1), [1, 3]],
  ['splice 插入', (a) => a.splice(1, 0, 9, 8), [1, 9, 8, 2, 3]],
  ['sort', (a) => a.sort((x, y) => y - x), [3, 2, 1]],
  ['reverse', (a) => a.reverse(), [3, 2, 1]],
]) {
  check(`${name}：结果正确，join / length / 下标 effect 各只跑一次`, () => {
    const arr = state([1, 2, 3]);
    const joined = watch(() => arr.join());
    const len = watch(() => arr.length);
    const first = watch(() => arr[0]);
    op(arr);
    flushSync();
    eq(snapshot(arr), expected, '内容');
    is(joined.length, 2, 'join 次数');
    eq(joined[1], expected.join(), 'join 值');
    eq(len.at(-1), expected.length, 'length 值');
    eq(first.at(-1), expected[0], '下标 0');
    is(len.length, expected.length === 3 ? 1 : 2, 'length 次数');
    is(first.length, expected[0] === 1 ? 1 : 2, '下标 0 次数');
  });
}
check('pop / shift / splice 的返回值是代理元素，splice 返回数组里也是', () => {
  const arr = state([{ n: 1 }, { n: 2 }, { n: 3 }]);
  const popped = arr.pop();
  is(typeof popped.n, 'number');
  is(raw(popped) !== popped, true, 'pop 出来的是代理');
  const removed = arr.splice(0, 1);
  is(raw(removed[0]) !== removed[0], true, 'splice 出来的是代理');
});
check('map / filter / forEach / find / reduce 能追踪（元素字段 + 结构）', () => {
  const arr = state([{ n: 1 }, { n: 2 }]);
  const mapped = watch(() => arr.map((x) => x.n).join());
  const filtered = watch(() => arr.filter((x) => x.n > 1).length);
  const each = watch(() => {
    let sum = 0;
    arr.forEach((x) => (sum += x.n));
    return sum;
  });
  const found = watch(() => arr.find((x) => x.n === 2)?.n);
  const reduced = watch(() => arr.reduce((acc, x) => acc + x.n, 0));
  arr[0].n = 10; // 字段变化
  flushSync();
  arr.push({ n: 3 }); // 结构变化
  flushSync();
  arr[1] = { n: 20 }; // 下标替换
  flushSync();
  eq(mapped, ['1,2', '10,2', '10,2,3', '10,20,3']);
  eq(filtered, [1, 2, 3, 3], 'filter 值（下标替换也重跑，值没变）');
  eq(each.at(-1), 33);
  eq(reduced.at(-1), 33);
  eq(found.at(-1), undefined);
});
check('splice 改很多下标，读多个下标 + length 的 effect 只跑一次', () => {
  const arr = state([1, 2, 3, 4, 5]);
  const log = watch(() => `${arr[0]}${arr[1]}${arr[2]}${arr[3]}${arr[4]}|${arr.length}`);
  arr.splice(0, 2, 9);
  flushSync();
  eq(log, ['12345|5', '9345undefined|4']);
});
check('回调拿到的是代理，sort 比较器拿到代理，元素与 arr[i] 同一身份', () => {
  const arr = state([{ n: 2 }, { n: 1 }]);
  let seen;
  arr.forEach((x, i) => i === 0 && (seen = x));
  is(seen === arr[0], true);
  const sorted = arr.sort((a, b) => {
    is(raw(a) !== a, true, '比较器参数是代理');
    return a.n - b.n;
  });
  is(sorted === arr, true, 'sort 返回代理本身');
  eq(snapshot(arr), [{ n: 1 }, { n: 2 }]);
});
check('toSorted / toReversed / slice / concat / at / entries / keys 结果元素是代理', () => {
  const arr = state([{ n: 2 }, { n: 1 }]);
  is(arr.toSorted((a, b) => a.n - b.n)[0] === arr[1], true);
  is(arr.toReversed()[0] === arr[1], true);
  is(arr.slice(1)[0] === arr[1], true);
  is(arr.concat([{ n: 3 }])[0] === arr[0], true);
  is(arr.at(-1) === arr[1], true);
  is([...arr.entries()][1][1] === arr[1], true);
  eq([...arr.keys()], [0, 1]);
});
check('Array.from / Array.prototype 通用方法走陷阱也正确', () => {
  const arr = state([1, 2, 3]);
  eq(Array.from(arr), [1, 2, 3]);
  eq(Array.prototype.map.call(arr, (x) => x * 2), [2, 4, 6]);
  eq(Array.prototype.lastIndexOf.call(arr, 3), 2);
});
check('数组下标 / length 订阅：shift 让所有下标 effect 都更新', () => {
  const arr = state(['a', 'b', 'c']);
  const logs = [0, 1, 2].map((i) => watch(() => arr[i]));
  arr.shift();
  flushSync();
  eq(logs.map((l) => l.at(-1)), ['b', 'c', undefined]);
});

// ================================================================ 3. 身份
console.log('\n# 3 身份');
check('p.a === p.a；同一原对象包两次得到同一代理', () => {
  const o = { x: 1 };
  const p = state({ a: o });
  is(p.a === p.a, true);
  is(state(o) === state(o), true);
  is(p.a === state(o), true, '嵌套读出的代理 === 单独包的代理');
});
check('list.includes(o) / indexOf(o) / lastIndexOf(o) 成立（Vue 做法）', () => {
  const o = {};
  const list = state([{}, o]);
  is(list.includes(o), true);
  is(list.indexOf(o), 1);
  is(list.lastIndexOf(o), 1);
  is(list.includes(list[1]), true, '传代理也行');
  is(list.indexOf(list[1]), 1);
  is(list.includes({}), false);
  is(list.indexOf(NaN), -1);
});
check('list[0] === o 仍然是 false（无法解决，只能开发期提示）', () => {
  const o = {};
  const list = state([o]);
  is(list[0] === o, false);
  is(list[0] === state(o), true, '统一拿代理比较是成立的');
  is(raw(list[0]) === o, true);
});
check('strictEquals：开发期对“代理 vs 原对象”给警告，普通不等 / 相等不警告', () => {
  const o = {};
  const list = state([o]);
  const warnings = [];
  const prev = options.warn;
  options.warn = (m) => warnings.push(m);
  try {
    is(strictEquals(list[0], o), false);
    is(warnings.length, 1);
    is(strictEquals(list[0], list[0]), true);
    is(strictEquals(o, {}), false);
    is(strictEquals(1, 1), true);
    is(warnings.length, 1);
  } finally {
    options.warn = prev;
  }
});
check('写入存原对象：p.x = p.y 后 raw 里 x、y 是同一个原对象，不含代理', () => {
  const inner = { v: 1 };
  const p = state({ y: inner, x: null });
  p.x = p.y;
  const r = raw(p);
  is(r.x === inner && r.y === inner, true);
  is(r.x === r.y, true);
  is(raw(r.x) === r.x, true, 'raw 里不是代理');
  is(p.x === p.y, true, '经代理读仍是同一个代理');
  // 第三方库拿 raw 做 structuredClone：含代理会抛 DataCloneError
  structuredClone(r);
});
check('不同 state 之间互相赋值：存的是原对象，两边共享同一份数据与同一代理', () => {
  const a = state({ child: null });
  const b = state({ child: { v: 1 } });
  a.child = b.child;
  is(raw(a).child === raw(b).child, true);
  is(a.child === b.child, true);
  const log = watch(() => a.child.v);
  b.child.v = 2;
  flushSync();
  eq(log, [1, 2]);
});
check('数组里 push 代理：原数组存原对象', () => {
  const o = { v: 1 };
  const list = state([]);
  list.push(state(o));
  is(raw(list)[0] === o, true);
  list.unshift(state(o));
  is(raw(list).every((x) => x === o), true);
  list[2] = state(o);
  is(raw(list)[2] === o, true);
});
check('state(state(o)) === state(o)；raw(state(o)) === o；raw(非代理) 原样', () => {
  const o = { a: 1 };
  is(state(state(o)) === state(o), true);
  is(raw(state(o)) === o, true);
  is(raw(o) === o, true);
  is(raw(1), 1);
  is(raw(null), null);
});
check('初始值里含代理（state({a: state(x)})）：raw 树里会带着代理——已知坑', () => {
  const inner = state({ v: 1 });
  const outer = state({ a: inner });
  is(outer.a === inner, true, '读出仍是同一代理，行为正确');
  is(raw(outer).a === inner, true, '但 raw 里是代理（只有“写入”才 raw 化，初始值不扫描）');
});

// ================================================================ 4. 不代理的值
console.log('\n# 4 不代理的值');
class FakeElement {
  constructor() {
    this.nodeType = 1;
    this.children = [];
  }
}
class Point {
  constructor() {
    this.x = 1;
  }
}
const nullProto = Object.assign(Object.create(null), { a: 1 });
const passThrough = [
  ['DOM 元素（假类，原型不在白名单）', new FakeElement()],
  ['Date', new Date()],
  ['class 实例', new Point()],
  ['Promise', Promise.resolve(1)],
  ['Function', () => {}],
  ['冻结对象', Object.freeze({ a: { b: 1 } })],
  ['不可扩展对象', Object.preventExtensions({ a: 1 })],
  ['密封对象', Object.seal({ a: 1 })],
  ['RegExp', /x/],
  ['WeakMap', new WeakMap()],
  ['Uint8Array', new Uint8Array(2)],
  ['Array 子类', new (class Stack extends Array {})()],
  ['Error', new Error('x')],
  ['Object.create(proto)', Object.create({ inherited: 1 })],
];
for (const [name, value] of passThrough) {
  check(`state(${name}) 原样返回；作为属性读出也是原样`, () => {
    is(state(value), value);
    const p = state({ v: value });
    is(p.v, value);
  });
}
check('null 原型对象：会被代理（字典对象，与 lodash isPlainObject 一致）', () => {
  const p = state(nullProto);
  is(p !== nullProto, true);
  is(Object.getPrototypeOf(p), null);
  const log = watch(() => p.a);
  p.a = 2;
  flushSync();
  eq(log, [1, 2]);
});
check('Object.prototype 本身不会被代理（p.__proto__）', () => {
  const p = state({});
  is(p.__proto__ === Object.prototype, true);
});
check('class 实例内部修改不是响应式的（按引用保留的代价）', () => {
  const pt = new Point();
  const p = state({ pt });
  const log = watch(() => p.pt.x);
  pt.x = 2;
  flushSync();
  is(log.length, 1);
  p.pt = new Point(); // 整体替换才会通知
  flushSync();
  is(log.length, 2);
});
check('Map：get / has / set / delete / size / 迭代 / forEach / clear 响应', () => {
  const m = state(new Map([['a', 1]]));
  const get = watch(() => m.get('a'));
  const getB = watch(() => m.get('b'));
  const has = watch(() => m.has('b'));
  const size = watch(() => m.size);
  const keys = watch(() => [...m.keys()].join());
  const entries = watch(() => JSON.stringify([...m]));
  const each = watch(() => {
    let out = '';
    m.forEach((v, k) => (out += k + v));
    return out;
  });
  m.set('b', 2);
  flushSync();
  m.set('a', 10);
  flushSync();
  m.delete('a');
  flushSync();
  eq(get, [1, 10, undefined]);
  eq(getB, [undefined, 2]);
  eq(has, [false, true]);
  eq(size, [1, 2, 2, 1]); // 改已有键的值也会重跑 size（整体信号较粗，Vue 同样）
  eq(keys.at(-1), 'b');
  eq(entries.at(-1), '[["b",2]]');
  eq(each.at(-1), 'b2');
  m.clear();
  flushSync();
  eq(size.at(-1), 0);
  eq(getB.at(-1), undefined);
  eq(has.at(-1), false);
});
check('Map：get(a) 的 effect 不被写 b 触发；值写相同不触发', () => {
  const m = state(new Map([['a', 1]]));
  const log = watch(() => m.get('a'));
  m.set('b', 1);
  m.set('a', 1);
  flushSync();
  is(log.length, 1);
});
check('Map：值是深层代理，对象键按身份工作，传代理键也能查到', () => {
  const key = { id: 1 };
  const m = state(new Map([[key, { n: 1 }]]));
  const log = watch(() => m.get(key).n);
  m.get(key).n = 2;
  flushSync();
  eq(log, [1, 2]);
  is(m.has(state(key)), true, '代理键');
  is(m.get(state(key)) === m.get(key), true);
  const [[k]] = [...m];
  is(k === state(key), true, '迭代出的键是代理');
  is(raw(m).has(key), true, '原 Map 里存的是原对象键');
});
check('Set：add / has / delete / size / 迭代 / 去重', () => {
  const s = state(new Set([1]));
  const has = watch(() => s.has(2));
  const size = watch(() => s.size);
  const list = watch(() => [...s].join());
  s.add(2);
  s.add(2);
  flushSync();
  s.delete(1);
  flushSync();
  eq(has, [false, true]);
  eq(size, [1, 2, 1]);
  eq(list, ['1', '1,2', '2']);
});
check('Set：元素是对象时 has 传原对象 / 代理都行；forEach 与 entries 拿到代理', () => {
  const o = { n: 1 };
  const s = state(new Set([o]));
  is(s.has(o), true);
  is(s.has(state(o)), true);
  s.forEach((v) => is(v === state(o), true));
  is([...s.entries()][0][0] === state(o), true);
});
check('Map / Set 与原生的互操作：instanceof、toString、new Map(proxy)、Array.from、原对象', () => {
  const m = state(new Map([['a', 1]]));
  const s = state(new Set([1]));
  is(m instanceof Map, true);
  is(Object.prototype.toString.call(m), '[object Map]');
  is(Object.prototype.toString.call(s), '[object Set]');
  eq([...new Map(m)], [['a', 1]]);
  eq(Array.from(s), [1]);
  structuredClone(raw(m));
  throws(() => Map.prototype.get.call(m, 'a'), TypeError, '原型方法直接 call 代理（brand check）');
});

// ================================================================ 5. 第三方库交互
console.log('\n# 5 第三方库交互');
const isPlainObject = (v) => {
  if (typeof v !== 'object' || v === null || Object.prototype.toString.call(v) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype;
};
check('structuredClone(proxy) 抛 DataCloneError；structuredClone(raw(p)) / snapshot(p) 可以', () => {
  const p = state({ a: { b: [1, 2] }, m: new Map([[1, { x: 1 }]]) });
  const error = throws(() => structuredClone(p), DOMException);
  is(error.name, 'DataCloneError');
  eq(structuredClone(raw(p)).a, { b: [1, 2] });
  eq(structuredClone(snapshot(p)).a, { b: [1, 2] });
  throws(() => structuredClone(state([1])), DOMException);
  throws(() => structuredClone(state(new Map())), DOMException);
});
check('JSON.stringify / Object.assign / 展开 / Array.isArray / isPlainObject / instanceof', () => {
  const p = state({ a: 1, n: { b: 2 }, list: [1] });
  is(JSON.stringify(p), '{"a":1,"n":{"b":2},"list":[1]}');
  eq(Object.assign({}, p).n.b, 2);
  const target = state({});
  Object.assign(target, { z: 1 });
  const log = watch(() => target.z);
  Object.assign(target, { z: 2 });
  flushSync();
  eq(log, [1, 2]);
  is(Array.isArray(p.list), true);
  is(Array.isArray(p), false);
  is(isPlainObject(p), true, 'lodash 风格：对象代理是 plain');
  is(isPlainObject(state(new Map())), false);
  is(isPlainObject(new Point()), false);
  is(p instanceof Object, true);
  is(Object.getPrototypeOf(p) === Object.prototype, true);
});
check('console.log / util.inspect 看到的是原对象，不触发 get 陷阱', async () => {
  const { inspect } = await import('node:util');
  const p = state({ a: { b: 1 } });
  const text = inspect(p);
  is(text, '{ a: { b: 1 } }');
});
check('访问器属性：不在创建时求值；getter 里的 this 是代理（this.x 被追踪）', () => {
  let calls = 0;
  const o = {
    a: 1,
    b: 2,
    get sum() {
      calls++;
      return this.a + this.b;
    },
  };
  const p = state(o);
  is(calls, 0, '创建时不求值');
  const log = watch(() => p.sum);
  p.a = 10;
  flushSync();
  eq(log, [3, 12]);
  is(raw(p) === o, true);
  is(typeof Object.getOwnPropertyDescriptor(raw(p), 'sum').get, 'function', 'raw 上仍是访问器');
});
check('访问器：getter 返回的对象也会被包成代理（与 Vue 一致，Svelte 不包）', () => {
  const inner = { v: 1 };
  const p = state({ get item() { return inner; } });
  is(p.item === state(inner), true);
});
check('Object.defineProperty 经代理：不通知（未实现 defineProperty 陷阱）——已知限制', () => {
  const p = state({ a: 1 });
  const log = watch(() => p.a);
  Object.defineProperty(p, 'a', { value: 2, writable: true, enumerable: true, configurable: true });
  flushSync();
  is(p.a, 2);
  is(log.length, 1, '没有重跑');
});
check('Object.freeze(代理) 之后读对象属性会 TypeError（Proxy 不变量）——已知限制', () => {
  const p = state({ a: { b: 1 } });
  Object.freeze(p);
  throws(() => p.a, TypeError);
});
check('defineProperty 定义的 不可写+不可配置 对象属性：读时 TypeError（Vue 同样）——已知限制', () => {
  const o = {};
  Object.defineProperty(o, 'k', { value: { x: 1 }, writable: false, configurable: false });
  throws(() => state(o).k, TypeError);
  const p = state({});
  Object.defineProperty(raw(p), 'n', { value: 5, writable: false, configurable: false });
  is(p.n, 5, '基本类型的只读属性没问题');
});
check('代理在别的对象的原型链上：写入落在子对象，不通知父代理', () => {
  const parent = state({ a: 1 });
  const child = Object.create(parent);
  const log = watch(() => parent.a);
  child.a = 2;
  flushSync();
  is(log.length, 1);
  is(raw(parent).a, 1);
  is(Object.hasOwn(child, 'a'), true);
});
check('snapshot：基本结构、去代理、与原数据隔离', () => {
  const p = state({ a: 1, list: [{ n: 1 }], nested: { deep: { x: 1 } } });
  const s = snapshot(p);
  eq(s, { a: 1, list: [{ n: 1 }], nested: { deep: { x: 1 } } });
  is(raw(s.list[0]) === s.list[0], true, '里面没有代理');
  is(s.list !== raw(p).list, true, '是拷贝');
  p.list[0].n = 2;
  is(s.list[0].n, 1, '之后的修改不影响快照');
  structuredClone(s);
});
check('snapshot：Date / Map / Set 被拷贝，class 实例按引用保留', () => {
  const date = new Date(0);
  const pt = new Point();
  const p = state({ date, map: new Map([[{ k: 1 }, { v: 1 }]]), set: new Set([{ s: 1 }]), pt, fn: () => 1 });
  const s = snapshot(p);
  is(s.date !== date && s.date.getTime() === 0, true, 'Date 拷贝');
  is(s.map instanceof Map && s.map !== raw(p).map, true);
  eq([...s.map.values()], [{ v: 1 }]);
  is(raw([...s.map.values()][0]) === [...s.map.values()][0], true);
  eq([...s.set], [{ s: 1 }]);
  is(s.pt === pt, true, 'class 实例按引用');
  is(s.fn === raw(p).fn, true, '函数按引用');
});
check('snapshot：循环引用与共享引用保持结构', () => {
  const a = { name: 'a' };
  a.self = a;
  const shared = { s: 1 };
  const p = state({ a, x: shared, y: shared });
  const s = snapshot(p);
  is(s.a.self === s.a, true, '循环');
  is(s.a !== a, true);
  is(s.x === s.y, true, '共享');
  const arr = [];
  arr.push(arr);
  const sa = snapshot(state(arr));
  is(sa[0] === sa, true);
});
check('snapshot：null 原型保留；非代理输入也行；基本类型原样；frozen 对象被拷成可写', () => {
  const s = snapshot(nullProto);
  is(Object.getPrototypeOf(s), null);
  eq(snapshot(1), 1);
  const frozen = snapshot(Object.freeze({ a: { b: 1 } }));
  is(Object.isFrozen(frozen), false);
  eq(snapshot(JSON.parse('{"__proto__":{"x":1}}')).__proto__, { x: 1 });
});
check('snapshot 在 effect 里调用 = 深度订阅', () => {
  const p = state({ a: { list: [{ n: 1 }], m: new Map([[1, 1]]) } });
  const log = watch(() => JSON.stringify(snapshot(p), (k, v) => (v instanceof Map ? [...v] : v)));
  p.a.list[0].n = 2;
  flushSync();
  p.a.list.push({ n: 3 });
  flushSync();
  p.a.m.set(2, 2);
  flushSync();
  is(log.length, 4);
});

// ================================================================ 6. 活对象规则
console.log('\n# 6 活对象（访问器）与规则的交互');
function makeBag() {
  const count = signal(0);
  let reads = 0;
  let writes = 0;
  const bag = {
    get count() {
      reads++;
      return count.value;
    },
    set count(v) {
      writes++;
      count.value = v;
    },
    label: 'x',
  };
  return { bag, count, stats: () => ({ reads, writes }) };
}
check('state(bag)：不求值，保留访问器；读经 getter 追踪背后的 signal', () => {
  const { bag, count, stats } = makeBag();
  const p = state(bag);
  is(stats().reads, 0, '创建时不求值');
  const log = watch(() => p.count);
  count.value = 5; // 外部直接写符文
  flushSync();
  eq(log, [0, 5]);
  p.count = 7; // 经代理写 → 调用 setter
  flushSync();
  eq(log, [0, 5, 7]);
  is(stats().writes, 1);
  is(raw(p) === bag, true);
  is(typeof Object.getOwnPropertyDescriptor(raw(p), 'count').set, 'function', 'raw 上仍是访问器');
});
check('state(bag) 里普通属性与访问器共存：写 label 不触发 count 的 effect', () => {
  const { bag } = makeBag();
  const p = state(bag);
  const log = watch(() => p.count);
  p.label = 'y';
  flushSync();
  is(log.length, 1);
});
check('snapshot(bag)：访问器被求值成数据属性（快照不是活的）', () => {
  const { bag, count } = makeBag();
  count.value = 3;
  for (const input of [bag, state(bag)]) {
    const s = snapshot(input);
    const desc = Object.getOwnPropertyDescriptor(s, 'count');
    is('value' in desc, true, '数据属性');
    is(s.count, 3);
    count.value = 4;
    is(s.count, 3, '之后不变');
    count.value = 3;
  }
});
check('展开 / JSON.stringify / Object.assign 经代理都求值', () => {
  const { bag, count } = makeBag();
  count.value = 9;
  const p = state(bag);
  eq({ ...p }.count, 9);
  is(JSON.stringify(p), '{"count":9,"label":"x"}');
});
check('_state({ count })：参数是初始值，普通数据属性，与符文脱钩', () => {
  const count = signal(1);
  const p = state({ count: count.value });
  const log = watch(() => p.count);
  count.value = 2;
  flushSync();
  is(log.length, 1);
  p.count = 3;
  flushSync();
  eq(log, [1, 3]);
});

// ================================================================ 7. 与上一层 signal 的关系
console.log('\n# 7 与 signal 的关系');
check('const form = signal(state({a:1})); form = {a:2} → 再包一层 state', () => {
  const form = signal(state({ a: 1 }));
  const log = watch(() => form.value.a);
  form.value.a = 5; // 改字段：细粒度
  flushSync();
  form.value = state({ a: 2 }); // 整体替换：编译产物在写入时再包一次
  flushSync();
  form.value.a = 3; // 新对象仍是深层响应
  flushSync();
  eq(log, [1, 5, 2, 3]);
});
check('整体替换后，旧对象的写入不再影响订阅者', () => {
  const first = state({ a: 1 });
  const form = signal(first);
  const log = watch(() => form.value.a);
  form.value = state({ a: 2 });
  flushSync();
  first.a = 99;
  flushSync();
  eq(log, [1, 2]);
});
check('不包 state 直接写原对象：不再是深层响应（说明编译产物必须再包）', () => {
  const form = signal(state({ a: 1 }));
  const log = watch(() => form.value.a);
  form.value = { a: 2 };
  flushSync();
  form.value.a = 3;
  flushSync();
  eq(log, [1, 2]);
});
check('写入同一原对象的代理：state(raw) 返回同一代理，signal 不重复通知', () => {
  const o = { a: 1 };
  const form = signal(state(o));
  const log = watch(() => form.value);
  form.value = state(o);
  flushSync();
  is(log.length, 1);
});

console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
