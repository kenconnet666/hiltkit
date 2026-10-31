// 浏览器里跑的断言。window.runAll() 返回 { results, facts }：
//   results  { group, name, ok, actual, expected }    有期望值的断言
//   facts    { key: value }                            只记录观察结果（浏览器之间可能不同，由 run.mjs 对比）
import { dispose, flushSync, scope, signal, stats } from '../03-publish/packages/runtime/reactive.js';
import { modeOf, setAttr, setClass, setStyle, spread } from '../03-publish/packages/runtime/attrs.js';
import { TABLE, config, merge, omit, tierOf } from '../03-publish/packages/runtime/rules.js';
import { ssr, ssrAttr as renderAttr, ssrChild, ssrElement } from '../03-publish/packages/runtime/server.js';

// 用例的写法：signal 是读写函数，写完立刻生效；renderElement 返回字符串
const lib = {
  signal(initial) {
    const cell = signal(initial);
    return (...next) => {
      if (!next.length) return cell.value;
      cell.value = next[0];
      flushSync();
    };
  },
  effectScope(fn) {
    const node = scope(fn);
    return () => dispose(node);
  },
};
const renderElement = (tag, props, children = '') => ssrChild(ssrElement(tag, props, () => ssr([typeof children === 'function' ? children() : children])));

const results = [];
const facts = {};
let group = '';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  results.push({ group, name, ok: same(actual, expected), actual, expected });
}
const fact = (key, value) => (facts[`${group} / ${key}`] = value);

const SVGNS = 'http://www.w3.org/2000/svg';
const MATHNS = 'http://www.w3.org/1998/Math/MathML';
const XLINK = 'http://www.w3.org/1999/xlink';
const root = document.createElement('div');
document.body.append(root);
function make(tag, props = {}, kids = []) {
  const ns = tag.startsWith('svg:') ? SVGNS : tag.startsWith('math:') ? MATHNS : null;
  const name = ns ? tag.slice(tag.indexOf(':') + 1) : tag;
  const el = ns ? document.createElementNS(ns, name) : document.createElement(name);
  el.append(...kids); // 先有子节点再 spread：和编译产物一致（select 的 value 依赖 option）
  spread(el, props);
  return el;
}
const mount = (el) => (root.append(el), el);
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]).sort());
const warnings = [];
const realWarn = console.warn;

const tests = [];
const test = (g, fn) => tests.push([g, fn]);

// ---------------------------------------------------------------- 1. attribute 还是 property
test('1 attribute / property', () => {
  // value：写 property，同时镜像成 default attribute（和服务端解析出来的 DOM 同形）
  const input = make('input', { value: 'a' });
  check('input value：property 与 attribute 同形', [input.value, input.getAttribute('value')], ['a', 'a']);
  setAttr(input, 'value', 'b');
  check('input value 更新', [input.value, input.defaultValue], ['b', 'b']);
  const form = document.createElement('form');
  form.append(input);
  input.value = 'typed';
  form.reset();
  check('reset 回到最后一次绑定的值（客户端新建与服务端解析一致）', input.value, 'b');
  const area = make('textarea', { value: 'x' });
  check('textarea value：property 与默认文本同形', [area.value, area.defaultValue, area.textContent], ['x', 'x', 'x']);
  setAttr(input, 'value', null);
  check('value={null}：清空且没有 value attribute', [input.value, input.hasAttribute('value')], ['', false]);
  const number = make('input', { type: 'number', value: 0 });
  check('value={0} 是 "0"', number.value, '0');

  const check1 = make('input', { type: 'checkbox', checked: true });
  check('checked：property 与 attribute', [check1.checked, check1.hasAttribute('checked')], [true, true]);
  click(check1);
  check('用户点击后 property 变、attribute 不变', [check1.checked, check1.hasAttribute('checked')], [false, true]);
  setAttr(check1, 'checked', false);
  check('checked={false}', [check1.checked, check1.hasAttribute('checked')], [false, false]);

  const select = make('select', { value: 'b' }, [make('option', { value: 'a' }, ['A']), make('option', { value: 'b' }, ['B'])]);
  check('select value（option 已在）', select.value, 'b');
  const opt = make('option', { selected: true, value: 'z' });
  check('option selected', [opt.selected, opt.hasAttribute('selected')], [true, true]);

  const video = make('video', { muted: true });
  check('muted：property', video.muted, true);
  const tpl = document.createElement('template');
  tpl.innerHTML = '<video muted></video>';
  fact('模板克隆出的 <video muted> 的 muted property', [tpl.content.firstChild.cloneNode(true).muted, document.importNode(tpl.content, true).firstChild.muted]);
  const box = make('input', { type: 'checkbox', indeterminate: true });
  check('indeterminate：只有 property', [box.indeterminate, box.hasAttribute('indeterminate')], [true, false]);

  const btn = make('button', { disabled: true });
  check('disabled={true}', [btn.disabled, btn.getAttribute('disabled')], [true, '']);
  setAttr(btn, 'disabled', false);
  check('disabled={false}', [btn.disabled, btn.hasAttribute('disabled')], [false, false]);
  setAttr(btn, 'disabled', '');
  check("disabled=''（HTML 里的写法）是真", btn.disabled, true);
  setAttr(btn, 'disabled', null);
  check('disabled={null}', btn.disabled, false);
  const hidden = make('div', { hidden: 'until-found' });
  check('hidden="until-found" 原样', hidden.getAttribute('hidden'), 'until-found');
  fact('hidden="until-found" 的 .hidden', hidden.hidden);
  check('readonly 写 attribute', make('input', { readonly: true }).readOnly, true);
  check('inert', make('div', { inert: true }).inert, true);
  check('tabindex', [make('div', { tabindex: 0 }).tabIndex, make('div', { tabindex: -1 }).tabIndex], [0, -1]);
  check('tabindex={null} 移除', make('div', { tabindex: null }).hasAttribute('tabindex'), false);
  check('React 拼写 tabIndex 靠 attribute 大小写不敏感', make('div', { tabIndex: 3 }).tabIndex, 3);
  check('for', make('label', { for: 'x' }).htmlFor, 'x');
  check('colspan', make('td', { colspan: 2 }).colSpan, 2);

  const dl = mount(make('datalist', { id: 'dl-1' }));
  const withList = mount(make('input', { list: 'dl-1' }));
  check('list 写 attribute，property 解析成 datalist', withList.list === dl, true);
  fact('input.list 在严格模式下赋值', (() => { 'use strict'; try { withList.list = 'x'; return 'no throw'; } catch (error) { return error.name; } })());
  const f1 = mount(document.createElement('form'));
  f1.id = 'f-1';
  check('form 写 attribute', mount(make('input', { form: 'f-1' })).form === f1, true);

  const canvas = make('canvas', { width: 120, height: 60 });
  check('canvas width/height', [canvas.width, canvas.height], [120, 60]);
  const svgRoot = make('svg:svg', { width: 100, height: 50, viewBox: '0 0 10 20' });
  check('svg width/height/viewBox（property 只读，必须写 attribute）', [svgRoot.width.baseVal.value, svgRoot.height.baseVal.value, svgRoot.viewBox.baseVal.height, svgRoot.getAttribute('viewBox')], [100, 50, 20, '0 0 10 20']);
  check('img width/height', make('img', { width: 10, height: 20, alt: '' }).getAttribute('width'), '10');


  const pop = mount(make('div', { popover: true }));
  check('popover={true} -> ""', [pop.getAttribute('popover'), pop.popover], ['', 'auto']);
  pop.showPopover();
  check('popover 可以打开', pop.matches(':popover-open'), true);
  pop.hidePopover();
  setAttr(pop, 'popover', 'manual');
  check("popover='manual'", pop.popover, 'manual');
  setAttr(pop, 'popover', false);
  check('popover={false} 移除', pop.popover, null);

  // SVG / MathML
  const svg = make('svg:svg', { class: 'a b', 'aria-hidden': false, focusable: false });
  check('SVG class：attribute，classList 可用', [svg.getAttribute('class'), svg.classList.contains('b'), typeof svg.className], ['a b', true, 'object']);
  check('SVG aria-hidden={false} / focusable={false} 是 "false"', [svg.getAttribute('aria-hidden'), svg.getAttribute('focusable')], ['false', 'false']);
  const use = make('svg:use', { 'xlink:href': '#a' });
  check('xlink:href 走命名空间', [use.getAttributeNS(XLINK, 'href'), use.attributes[0].namespaceURI], ['#a', XLINK]);
  const math = make('math:math', { display: 'block', class: 'm' }, [make('math:mi', { mathvariant: 'normal' }, ['x'])]);
  check('MathML：attribute 与 class', [math.getAttribute('display'), math.classList.contains('m'), math.firstChild.getAttribute('mathvariant'), math.namespaceURI], ['block', true, 'normal', MATHNS]);
  check('SVG 上 innerHTML 仍是 property', (() => { const g = make('svg:g'); setAttr(g, 'innerHTML', '<circle r="1"/>'); return g.firstChild?.localName; })(), 'circle');
  check('SVG 上 value 不是 property', (() => { const g = make('svg:g', { value: 'x' }); return [g.value, g.getAttribute('value')]; })(), [undefined, 'x']);

  const div = make('div');
  setAttr(div, 'innerHTML', '<b>x</b>');
  check('innerHTML（显式写入）', div.firstChild.localName, 'b');
  setAttr(div, 'textContent', 'a<b');
  check('textContent', [div.childNodes.length, div.textContent], [1, 'a<b']);
  setAttr(div, 'textContent', null);
  check('textContent={null} 清空', div.textContent, '');

  // 自定义元素：有同名 property 就写 property
  customElements.define('x-prop', class extends HTMLElement {
    static observedAttributes = ['label'];
    calls = [];
    set label(v) { this._label = v; this.calls.push(['label', v]); }
    get label() { return this._label; }
    set data(v) { this._data = v; }
    get data() { return this._data; }
    attributeChangedCallback(n, o, v) { this.calls.push(['attr', n, v]); }
  });
  const payload = { a: 1 };
  const ce = make('x-prop', { data: payload, label: 'hi', 'data-x': 'y', extra: 'e' });
  check('自定义元素：对象写 property', ce.data === payload, true);
  check('自定义元素：有 property 的字符串键写 property', [ce.label, ce.calls.filter((c) => c[0] === 'label').length], ['hi', 1]);
  check('自定义元素：没有 property 的键写 attribute', [ce.getAttribute('extra'), ce.getAttribute('data-x')], ['e', 'y']);
  const late = make('x-late', { data: { k: 1 }, label: 'l' });
  let setterCalls = 0;
  customElements.define('x-late', class extends HTMLElement {
    static observedAttributes = ['label'];
    set data(v) { setterCalls++; this._data = v; }
    get data() { return this._data; }
    attributeChangedCallback() { setterCalls += 10; }
  });
  customElements.upgrade(late);
  fact('自定义元素晚定义：对象 property 的 setter 被调用次数 / 字符串走 attribute 触发 attributeChangedCallback 次数', [setterCalls % 10, Math.floor(setterCalls / 10)]);
});

// ---------------------------------------------------------------- 2. 取值语义表
const MATRIX_VALUES = [['undefined', undefined], ['null', null], ['false', false], ['true', true], ["''", ''], ['0', 0], ['NaN', NaN], ['{}', {}], ['fn', () => {}]];
const MATRIX_KEYS = [['title', 'div'], ['disabled', 'button'], ['aria-expanded', 'div'], ['data-x', 'div'], ['style', 'div'], ['class', 'div'], ['value', 'input'], ['hidden', 'div'], ['draggable', 'div'], ['translate', 'div']];
const seen = (el, key) => {
  if (key === 'value') return `${JSON.stringify(el.value)} attr=${el.getAttribute('value') === null ? '-' : JSON.stringify(el.getAttribute('value'))}`;
  const value = el.getAttribute(key);
  return value === null ? '-' : value.length > 18 ? `${JSON.stringify(value.slice(0, 15))}…` : JSON.stringify(value);
};
test('2 取值语义表', () => {
  const quiet = console.warn;
  console.warn = () => {};
  const table = {};
  for (const [key, tag] of MATRIX_KEYS) {
    table[key] = {};
    for (const [label, value] of MATRIX_VALUES) {
      const el = make(tag, { [key]: value });
      table[key][label] = seen(el, key);
    }
    const low = make(tag, merge({ [key]: key === 'style' ? 'color:red' : 'LOW' }, { [key]: undefined }));
    table[key]['undefined 盖在下层上'] = seen(low, key);
    const nulled = make(tag, merge({ [key]: key === 'style' ? 'color:red' : 'LOW' }, { [key]: null }));
    table[key]['null 盖在下层上'] = seen(nulled, key);
  }
  console.warn = quiet;
  facts['语义表'] = table;
  // 候选规则的关键格子
  check('aria-expanded={false} 是 "false"', table['aria-expanded'].false, '"false"');
  check('aria-expanded={true} 是 "true"', table['aria-expanded'].true, '"true"');
  check('data-x={false} 是 "false"', table['data-x'].false, '"false"');
  check('data-x={0} 是 "0"', table['data-x']['0'], '"0"');
  check('title={undefined} 不写', table.title.undefined, '-');
  check('title={null} 不写', table.title.null, '-');
  check('disabled={false}/null 不写，true 是 ""', [table.disabled.false, table.disabled.null, table.disabled.true], ['-', '-', '""']);
  check('undefined 落回下层（普通 / 布尔 / aria / style）', [table.title['undefined 盖在下层上'], table['aria-expanded']['undefined 盖在下层上'], table.style['undefined 盖在下层上']], ['"LOW"', '"LOW"', '"color: red;"']);
  check('null 盖住下层（普通 / 布尔 / aria）', [table.title['null 盖在下层上'], table['aria-expanded']['null 盖在下层上'], table.disabled['null 盖在下层上']], ['-', '-', '-']);
  check('draggable={false} 是 "false"', table.draggable.false, '"false"');
  check('translate={false} 是 "no"', table.translate.false, '"no"');
  check('hidden={false} 不写', table.hidden.false, '-');
  check('NaN 写成 "NaN"（类型层拦）', table.title.NaN, '"NaN"');
  check('对象、函数在普通属性上被忽略', [table.title['{}'], table.title.fn], ['-', '-']);
  check('class={false}/0/{} 不出力', [table.class.false, table.class['0'], table.class['{}']], ['-', '-', '-']);
  check("value={undefined} 不写，null 清空", [table.value.undefined, table.value.null], ['"" attr=-', '"" attr=-']);
});

// ---------------------------------------------------------------- 3. class
test('3 class', async () => {
  check('字符串 / 数组 / 对象 / 嵌套', make('div', { class: ['a', { b: true, c: false }, ['d', null, false, 'e']] }).className, 'a b d e');
  check('跨层从下往上拼接', make('div', merge({ class: 'a' }, { class: 'b' }, { class: ['c'] })).className, 'a b c');
  check('undefined / null / false 的层不出力', make('div', merge({ class: 'a' }, { class: undefined }, { class: null }, { class: false })).className, 'a');
  check('omit 隐藏 class', make('div', merge({ class: 'a' }, omit({ class: 'x' }, ['class']))).className, 'a');
  check('className 别名', make('div', merge({ class: 'a' }, { className: 'b' })).className, 'a b');

  // 第三方库 / 过渡动画加的类不能被冲掉
  const state = lib.signal('x');
  const el = make('div', { get class() { return ['base', state()]; } });
  el.classList.add('is-animating');
  state('y');
  check('动态变化：只换自己的词，外来的类保留', [...el.classList].sort(), ['base', 'is-animating', 'y']);
  state('z');
  el.classList.remove('is-animating');
  el.classList.add('lib-2');
  state('x');
  check('再变一次', [...el.classList].sort(), ['base', 'lib-2', 'x']);
  const wholesale = document.createElement('div');
  wholesale.className = 'base x';
  wholesale.classList.add('is-animating');
  wholesale.className = 'base y';
  fact('对照：className 整串写会冲掉外来的类', [...wholesale.classList]);
  const initial = document.createElement('div');
  initial.className = 'from-template';
  spread(initial, { class: 'mine' });
  check('元素上原来就有类（模板里的静态类）：保留', [...initial.classList].sort(), ['from-template', 'mine']);

  const svg = make('svg:rect', { class: ['a', { b: true }] });
  const svgState = lib.signal('p');
  const svg2 = make('svg:rect', { get class() { return svgState(); } });
  svgState('q');
  check('SVG：className 是对象，照样能写能增删', [svg.getAttribute('class'), typeof svg.className, [...svg2.classList]], ['a b', 'object', ['q']]);
  const single = make('div');
  setClass(single, { a: 1, b: 0 });
  setClass(single, 'c');
  check('setClass 单项绑定', single.className, 'c');

  config.sx = (...values) => ({ class: `sx-${values.join('-')}`, style: { '--sx-v': values.join('-') } });
  const sxEl = make('div', merge({ class: 'own', sx: 'a' }, { sx: 'b' }));
  config.sx = undefined;
  check('sx 钩子：各层 sx 交给引擎，class 拼在最后，行内变量垫底', [sxEl.className, sxEl.style.getPropertyValue('--sx-v')], ['own sx-a-b', 'a-b']);
});

// ---------------------------------------------------------------- 4. style
test('4 style', async () => {
  const color = (el) => el.style.color;
  let el = make('div', merge({ style: 'color:red;margin:1px' }, { style: { color: 'blue', backgroundColor: 'green' } }));
  check('字符串层 + 对象层：按属性合并，靠后的优先', [color(el), el.style.margin, el.style.backgroundColor], ['blue', '1px', 'green']);
  el = make('div', merge({ style: { color: 'blue', margin: '2px' } }, { style: 'color:red' }));
  check('对象层 + 字符串层', [color(el), el.style.margin], ['red', '2px']);
  check('camelCase 与 kebab-case 等价', same(attrs(make('div', { style: { backgroundColor: 'red', 'border-top-width': '2px' } })), attrs(make('div', { style: 'background-color:red;border-top-width:2px' }))), true);
  el = make('div', { style: { '--x': '1', '--Camel': '2', WebkitLineClamp: 2, msTransform: 'none' } });
  check('自定义属性大小写保留', [el.style.getPropertyValue('--x'), el.style.getPropertyValue('--Camel')], ['1', '2']);
  fact('Webkit 前缀 camelCase', [el.style.getPropertyValue('-webkit-line-clamp'), el.style.getPropertyValue('-ms-transform')]);
  el = make('div', { style: { color: 'red !important', width: '10px' } });
  check('!important（对象）', [el.style.getPropertyPriority('color'), el.style.getPropertyPriority('width')], ['important', '']);
  el = make('div', { style: 'color: blue !important' });
  check('!important（字符串）', el.style.getPropertyPriority('color'), 'important');
  warnings.length = 0;
  el = make('div', { style: { opacity: 0.5, zIndex: 3, lineHeight: 1.5, flexGrow: 2, width: 0 } });
  check('无单位数字原样：opacity / zIndex / lineHeight / flexGrow / 0', [el.style.opacity, el.style.zIndex, el.style.lineHeight, el.style.flexGrow, el.style.width], ['0.5', '3', '1.5', '2', '0px']);
  el = make('div', { style: { width: 100 } });
  check('width: 100 不补 px：浏览器忽略，开发期给出警告', [el.style.width, warnings.some((w) => w.includes('width'))], ['', true]);
  el = make('div', merge({ style: { color: 'red', margin: '1px' } }, { style: { color: null } }));
  check('null 移除并盖住下层', [color(el), el.style.margin], ['', '1px']);
  el = make('div', merge({ style: { color: 'red' } }, { style: { color: undefined } }));
  check('undefined 落回下层', color(el), 'red');
  el = make('div', { style: 'background:url("data:image/svg+xml;utf8,<svg xmlns=\'x\'/>");color:red' });
  check('字符串里括号和引号内的 ; : 不切分', [color(el), el.style.backgroundImage.startsWith('url(')], ['red', true]);
  check('整个 style 是 null / false / 数字：不出力', make('div', { style: null }).hasAttribute('style'), false);

  // 动态：只增删自己写过的属性
  const s = lib.signal({ color: 'red', margin: '1px' });
  el = make('div', { get style() { return s(); } });
  el.style.setProperty('--foreign', 'f');
  el.style.transform = 'scale(2)';
  s({ color: 'blue' });
  check('属性级 diff：删掉 margin，外来的 --foreign / transform 不动', [color(el), el.style.margin, el.style.getPropertyValue('--foreign'), el.style.transform], ['blue', '', 'f', 'scale(2)']);
  s('color:green');
  check('对象换成字符串', color(el), 'green');
  s(undefined);
  check('整个 style 变成 undefined：自己写的全清，外来的不动', [color(el), el.style.getPropertyValue('--foreign')], ['', 'f']);
  const setOnly = make('div');
  setStyle(setOnly, { color: 'red' });
  setStyle(setOnly, { margin: '1px' });
  check('setStyle 单项绑定', [setOnly.style.color, setOnly.style.margin], ['', '1px']);

  // 和引擎写的行内变量共存
  const sxValue = lib.signal('a');
  const styleValue = lib.signal({ color: 'red' });
  config.sx = (...values) => ({ class: `sx-${values[0]}`, style: values[0] === 'off' ? {} : { '--sx': values[0] } });
  el = make('div', { get sx() { return sxValue(); }, get style() { return styleValue(); } });
  const state = () => [el.style.getPropertyValue('--sx'), el.style.color, el.className];
  check('引擎变量与用户 style 并存', state(), ['a', 'red', 'sx-a']);
  styleValue({});
  check('用户 style 清空：不删引擎变量', state(), ['a', '', 'sx-a']);
  styleValue({ color: 'blue' });
  sxValue('b');
  check('引擎变量换值：不删用户 style', state(), ['b', 'blue', 'sx-b']);
  sxValue('off');
  check('引擎变量消失：用户 style 还在', state(), ['', 'blue', 'sx-off']);
  config.sx = undefined;
});

// ---------------------------------------------------------------- 5. 事件
const listenerLog = [];
const realAdd = EventTarget.prototype.addEventListener;
test('5 事件', async () => {
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    listenerLog.push([this.localName, type, options]);
    return realAdd.call(this, type, fn, options);
  };
  const log = [];
  const h = (name, extra) => (event) => { log.push(name); extra?.(event); };
  let el = mount(make('div', merge({ onClick: h('a') }, { onClick: h('b') })));
  click(el);
  check('每层都执行，靠后的先执行', log.splice(0), ['b', 'a']);
  el = mount(make('div', merge({ onClick: h('a') }, { onClick: h('b', (e) => e.preventDefault()) })));
  click(el);
  check('preventDefault 之后下层跳过', log.splice(0), ['b']);
  el = mount(make('div', merge({ onClick: h('a') }, { onClick: h('b', (e) => e.stopImmediatePropagation()) })));
  click(el);
  check('stopImmediatePropagation 之后下层跳过', log.splice(0), ['b']);
  el = mount(make('div', merge({ onClick: h('a') }, { onClick: null }, { onClick: undefined })));
  click(el);
  check('null / undefined 的层不影响其他层', log.splice(0), ['a']);
  listenerLog.length = 0;
  const wrapped = mount(make('div', merge({ onClick: h('a') }, { onClick: h('b') }, { onClick: h('c') })));
  check('三层一个原生监听', listenerLog.filter((l) => l[1] === 'click').length, 1);
  void wrapped;

  // 捕获 / once / passive 写在键名后缀里
  const parent = mount(make('div', { onClickCapture: h('capture'), onClick: h('bubble') }));
  const child = make('button', { onClick: h('target') });
  parent.append(child);
  click(child);
  check('Capture 后缀：捕获阶段先于目标', log.splice(0), ['capture', 'target', 'bubble']);
  el = mount(make('div', { onClickOnce: h('once') }));
  click(el);
  click(el);
  check('Once 后缀：只触发一次', log.splice(0), ['once']);
  el = mount(make('div', { onWheelPassive: (e) => e.preventDefault() }));
  const passive = el.dispatchEvent(new WheelEvent('wheel', { cancelable: true }));
  el = mount(make('div', { onWheel: (e) => e.preventDefault() }));
  const active = el.dispatchEvent(new WheelEvent('wheel', { cancelable: true }));
  check('Passive 后缀：preventDefault 无效（dispatchEvent 返回 true）；普通监听有效', [passive, active], [true, false]);
  listenerLog.length = 0;
  make('div', { onClickCapturePassive: () => {} });
  check('后缀可叠加', listenerLog.map((l) => [l[1], l[2]]), [['click', { passive: true, capture: true }]]);

  // 事件名映射
  listenerLog.length = 0;
  make('div', { onDblClick() {}, onKeyDown() {}, onPointerDown() {}, onContextMenu() {}, onAnimationEnd() {}, onTransitionEnd() {}, onFocusIn() {}, onBeforeInput() {}, onDragStart() {} });
  check('原生事件：onXxx 转小写', listenerLog.map((l) => l[1]), ['dblclick', 'keydown', 'pointerdown', 'contextmenu', 'animationend', 'transitionend', 'focusin', 'beforeinput', 'dragstart']);
  listenerLog.length = 0;
  warnings.length = 0;
  make('input', { onUpdate() {}, onValueChange() {}, onOpenChange() {}, onChange() {} });
  check('非原生事件落在原生元素上：照样按小写名监听（无害），开发期给警告', [listenerLog.map((l) => l[1]), warnings.length], [['update', 'valuechange', 'openchange', 'change'], 3]);
  const custom = mount(make('x-evt', { onMyEvent: h('kebab'), 'on:myEvent': h('exact'), onChange: h('native-name') }));
  custom.dispatchEvent(new CustomEvent('my-event'));
  custom.dispatchEvent(new CustomEvent('myEvent'));
  custom.dispatchEvent(new CustomEvent('change'));
  check('自定义元素：非原生名转连字符；on:名字 原样；原生名照旧', log.splice(0), ['kebab', 'exact', 'native-name']);
  const missing = [];
  const probe = document.createElement('div');
  for (const name of ['click', 'dblclick', 'keydown', 'pointerdown', 'toggle', 'beforetoggle', 'scrollend', 'animationend', 'transitionend', 'focusin', 'beforeinput', 'input', 'change', 'submit', 'load', 'error', 'contextmenu', 'wheel', 'touchstart', 'dragstart', 'fullscreenchange', 'securitypolicyviolation', 'pointerrawupdate', 'beforematch', 'cancel', 'close', 'selectionchange', 'formdata', 'slotchange', 'gotpointercapture', 'webkitanimationend', 'animationstart', 'animationcancel', 'transitionrun', 'transitioncancel', 'copy', 'paste', 'auxclick', 'command', 'visibilitychange']) {
    if (!(`on${name}` in probe)) missing.push(name);
  }
  fact('元素上没有 on<名字> IDL 属性的真实事件（IDL 探测会漏掉它们，要用 on:名字）', missing);

  // 处理函数换了不重新绑定
  const handler = lib.signal(h('first'));
  listenerLog.length = 0;
  el = mount(make('div', { get onClick() { return handler(); } }));
  click(el);
  handler(h('second'));
  click(el);
  check('getter 返回新函数：不重新绑定，下一次触发用新的', [log.splice(0), listenerLog.length], [['first', 'second'], 1]);
  // 字符串 / 小写 on* 永远不写成 attribute
  warnings.length = 0;
  window.__xss = 0;
  el = mount(make('div', { onClick: 'window.__xss=1', onclick: 'window.__xss=2' }));
  click(el);
  check('字符串处理函数：不监听也不写 attribute，不会执行', [window.__xss, el.hasAttribute('onclick')], [0, false]);
  // 动态键层里的事件
  const flag = lib.signal(true);
  el = mount(make('div', merge({ onClick: h('low') }, () => (flag() ? { onClick: h('A') } : { onClick: h('B') }))));
  click(el);
  flag(false);
  click(el);
  check('动态键层：事件跟着切换（读取在触发时）', log.splice(0), ['A', 'low', 'B', 'low']);
  EventTarget.prototype.addEventListener = realAdd;

  // ref：每层都拿到元素，卸载时拿到 null
  const refs = [];
  const stop = lib.effectScope(() => make('div', merge({ ref: (e) => refs.push(['lower', e && e.localName]) }, { ref: (e) => refs.push(['upper', e && e.localName]) })));
  stop();
  check('ref：每层都调用，下层先', refs.slice(0, 2), [['lower', 'div'], ['upper', 'div']]);
  check('ref：卸载时每层都拿到 null', refs.slice(2).map((r) => r[1]), [null, null]);
});

// ---------------------------------------------------------------- 6. 顺序敏感的属性
const snapshot = (el) => ({ value: el.value, type: el.type, attrs: attrs(el) });
/** 编译路径：键按 LATE 排好序，逐个 setAttr */
function compiled(tag, props, kids = []) {
  const el = document.createElement(tag);
  el.append(...kids);
  const keys = Object.keys(props).sort((a, b) => tierOf(TABLE[a] ?? 0) - tierOf(TABLE[b] ?? 0)); // 稳定排序
  for (const key of keys) setAttr(el, key, props[key]);
  return el;
}
test('6 顺序敏感', async () => {
  const range = { value: 150, min: 100, max: 200, type: 'range' };
  check('range：value 排在 min / max 之后', make('input', range).value, '150');
  const naive = document.createElement('input');
  naive.type = 'range';
  naive.value = '150';
  naive.min = '100';
  naive.max = '200';
  fact('对照：range 先写 value 再写 min / max 的结果', naive.value);
  check('动态键层路径同样排序', make('input', merge(() => range)).value, '150');
  check('getter 键也排序', (() => { const s = lib.signal(150); return make('input', { get value() { return s(); }, min: 100, max: 200, type: 'range' }).value; })(), '150');
  check('编译路径（排序后逐个 setAttr）与 spread 一致', same(snapshot(compiled('input', range)), snapshot(make('input', range))), true);
  const date = { value: '2020-01-31', type: 'date' };
  check('type 在 value 之前：date', make('input', date).value, '2020-01-31');
  const wrong = document.createElement('input');
  wrong.value = 'abc';
  wrong.type = 'number';
  fact('对照：value 先于 type=number 写入 "abc"', wrong.value);
  check('number 的非法值被消毒成空串', make('input', { value: 'abc', type: 'number' }).value, '');
  check('step 之后写 value', make('input', { value: '7', type: 'number', min: 0, max: 10, step: 5 }).value, '7');

  const options = () => [make('option', { value: 'a' }, ['A']), make('option', { value: 'b' }, ['B'])];
  check('select value：option 已经在', make('select', { value: 'b' }, options()).value, 'b');
  const lateSelect = make('select', { value: 'b' });
  fact('select value：option 还没来时', lateSelect.value);
  lateSelect.append(...options());
  await tick();
  check('select value：option 后来才出现，MutationObserver 对齐', lateSelect.value, 'b');
  lateSelect.replaceChildren(...options());
  await tick();
  check('select value：option 整体替换后仍对齐', lateSelect.value, 'b');
  const viaSelected = mount(make('select', {}, [make('option', { value: 'a' }, ['A']), make('option', { value: 'b', selected: true }, ['B'])]));
  check('option selected', viaSelected.value, 'b');
  const lateOption = document.createElement('select');
  lateOption.append(...options());
  lateOption.append(make('option', { value: 'c', selected: true }, ['C']));
  check('option selected 先设再插入也生效', lateOption.value, 'c');
  const video = make('video', { autoplay: true, muted: true, playsinline: true, controls: true, loop: true });
  check('video 布尔属性', [video.autoplay, video.muted, video.hasAttribute('playsinline'), video.controls, video.loop], [true, true, true, true, true]);
  fact('video.playsInline property（Firefox 没有，所以 playsinline 必须走 attribute）', video.playsInline);
});

// ---------------------------------------------------------------- 7. 安全
test('7 安全', async () => {
  window.__pwn = 0;
  const raw = mount(document.createElement('a'));
  raw.setAttribute('href', 'javascript:window.__pwn=1');
  click(raw);
  await tick();
  fact('对照：原生 setAttribute + 点击 javascript: 链接会执行', window.__pwn === 1);
  window.__pwn = 0;
  warnings.length = 0;
  const attempts = ['javascript:window.__pwn=2', '  JaVa\tScRiPt:window.__pwn=3', '\u0001javascript:window.__pwn=4'];
  for (const url of attempts) {
    const a = mount(make('a', { href: url }));
    click(a);
    check(`href 拦截：${JSON.stringify(url)}`, a.hasAttribute('href'), false);
  }
  await tick();
  check('拦截后没有执行', window.__pwn, 0);
  check('正常链接放行', ['https://x.test/', '/p', '#h', 'mailto:a@b.c', 'data:text/plain,hi', ''].map((u) => make('a', { href: u }).getAttribute('href')), ['https://x.test/', '/p', '#h', 'mailto:a@b.c', 'data:text/plain,hi', '']);
  check('iframe src / form action / button formaction 同样拦截', [make('iframe', { src: 'javascript:1' }).hasAttribute('src'), make('form', { action: 'javascript:1' }).hasAttribute('action'), make('button', { formaction: 'javascript:1' }).hasAttribute('formaction')], [false, false, false]);
  check('服务端同样拦截', renderAttr('href', 'javascript:alert(1)'), '');
  const viaSpread = make('div', { innerHTML: '<img src=x onerror=window.__pwn=5>', textContent: 'safe' });
  check('innerHTML 不能经 spread 写入（来源不可信时的入口）', viaSpread.querySelector('img'), null);
  const frame = make('iframe', { srcdoc: '<script>parent.__pwn=6<\/script>' });
  check('srcdoc 不能经 spread 写入', frame.hasAttribute('srcdoc'), false);
  check('服务端：innerHTML / srcdoc 不能经 spread 写入', [renderElement('div', { innerHTML: '<b>x</b>' }), renderElement('iframe', { srcdoc: 'x' })], ['<div></div>', '<iframe></iframe>']);
  const direct = make('div');
  setAttr(direct, 'innerHTML', '<b>ok</b>');
  check('显式写入（编译器对 JSX 里写出的 innerHTML）仍然可用', direct.innerHTML, '<b>ok</b>');
  check('服务端：on* 不输出', [renderAttr('onclick', 'x'), renderAttr('onClick', () => {})], ['', '']);
});

// ---------------------------------------------------------------- 8. SSR 一致性
const SSR_CASES = [
  ['div', merge({ class: ['a', { b: true }] }, { class: 'c', id: 'x' })],
  ['div', merge({ style: 'color:red;margin:1px' }, { style: { color: 'blue', backgroundColor: 'green', '--x': 1, opacity: 0.5 } })],
  ['div', { style: { color: 'red !important' } }],
  ['button', { disabled: true, type: 'button', 'aria-busy': false, 'data-n': 0 }],
  ['button', { disabled: false, hidden: 'until-found', popover: true }],
  ['button', merge({ disabled: true }, { disabled: false })],
  ['button', merge({ title: 'low' }, { title: undefined }, { id: 'i' })],
  ['button', merge({ title: 'low' }, { title: null })],
  ['input', { type: 'text', value: 'a"b&c<d', placeholder: 'p', readonly: true, maxlength: 5, tabindex: 0 }],
  ['input', { type: 'checkbox', checked: true, value: 'on-value' }],
  ['input', { type: 'checkbox', checked: false }],
  ['input', { value: 0, type: 'number' }],
  ['input', { value: 150, min: 100, max: 200, type: 'range' }],
  ['input', { value: '2020-01-31', type: 'date' }],
  ['input', { value: '', type: 'text' }],
  ['textarea', { value: 'plain' }],
  ['textarea', { value: '\nstarts with newline <b> & more' }],
  ['textarea', { value: '\n\ntwo newlines' }],
  ['select', { value: 'b' }, [['option', { value: 'a' }, 'A'], ['option', { value: 'b' }, 'B']]],
  ['select', { value: 'B2' }, [['option', {}, 'B1'], ['option', {}, 'B2']]],
  ['select', {}, [['option', { value: 'a' }, 'A'], ['option', { value: 'b', selected: true }, 'B']]],
  ['video', { muted: true, autoplay: true, playsinline: true, controls: true, loop: false }],
  ['label', { for: 'x', class: 'l' }],
  ['td', { colspan: 2, rowspan: 3 }],
  ['div', {}, [['input', { list: 'dl-ssr' }], ['datalist', { id: 'dl-ssr' }, [['option', { value: 'v' }, '']]]]],
  ['a', { href: 'https://x.test/?a=1&b="2"', target: '_blank', rel: 'noopener' }],
  ['a', { href: 'javascript:alert(1)', id: 'bad' }],
  ['img', { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', width: 10, height: 20, alt: '', loading: 'lazy' }],
  ['svg:svg', { viewBox: '0 0 10 20', class: 'icon', width: 10, 'aria-hidden': true, focusable: false }, [['svg:use', { 'xlink:href': '#a' }], ['svg:path', { d: 'M0 0L1 1', fill: 'none', 'stroke-width': 2 }]]],
  ['math:math', { display: 'block', class: 'm' }, [['math:mi', { mathvariant: 'normal' }, 'x']]],
  ['div', { 'aria-expanded': false, 'aria-hidden': true, 'data-x': false, draggable: false, spellcheck: false, translate: false, contenteditable: true }],
  ['div', { onClick() {}, ref() {}, children: 'ignored', title: 'kept' }],
  ['div', { title: 'a"b&c<d>e\'f' }],
  ['div', { textContent: 'a<b & c' }],
  ['div', { title: {}, id: () => {}, lang: Symbol('s'), dir: 'ltr' }],
  ['li', { value: 3 }],
  ['progress', { value: 0.5, max: 1 }],
  ['option', { value: 'v', selected: true, disabled: true }],
  ['x-foo', { title: 'custom', 'data-k': 'v', foo: 'bar', class: 'c' }],
  ['div', { sx: 'a', class: 'own' }],
  ['dialog', { open: true }],
  ['details', { open: true, class: 'd' }],
  ['p', { hidden: true, inert: true }],
];
function buildTree([tag, props, kids = []]) {
  const children = typeof kids === 'string' ? (kids ? [document.createTextNode(kids)] : []) : kids.map(buildTree);
  return make(tag, props, children);
}
function renderTree([tag, props, kids = []]) {
  const name = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
  return renderElement(name, props, () => (typeof kids === 'string' ? kids.replace(/&/g, '&amp;').replace(/</g, '&lt;') : kids.map(renderTree).join('')));
}
/** 能观察到的状态：attribute（class 按词、style 按声明规范化）+ 常见的 property */
function snap(node) {
  if (node.nodeType === 3) return node.data;
  const out = { tag: `${node.namespaceURI?.slice(-4)}:${node.localName}`, attrs: {}, kids: [...node.childNodes].map(snap) };
  for (const a of [...node.attributes].sort((x, y) => (x.name < y.name ? -1 : 1))) if (!(node.localName === 'option' && a.name === 'selected')) out.attrs[a.name] = a.name === 'class' ? [...node.classList].sort().join(' ') : a.name === 'style' ? node.style.cssText : a.value;
  for (const key of ['value', 'checked', 'selected', 'muted', 'disabled', 'hidden', 'selectedIndex', 'defaultValue']) if (key in node && node.namespaceURI?.endsWith('xhtml')) out[key] = node[key];
  return out;
}
function parse(html, tag) {
  const wrap = document.createElement('template');
  if (tag.startsWith('svg:')) wrap.innerHTML = `<svg>${html}</svg>`;
  else if (tag.startsWith('math:')) wrap.innerHTML = `<math>${html}</math>`;
  else wrap.innerHTML = html;
  const first = wrap.content.firstChild;
  return tag.startsWith('svg:') || tag.startsWith('math:') ? first.firstChild : first;
}
test('8 SSR 一致', () => {
  config.sx = (...values) => ({ class: `sx-${values.join('-')}`, style: { '--sx': values.join('-') } });
  const quiet = console.warn;
  console.warn = () => {};
  SSR_CASES.forEach((spec, index) => {
    const client = snap(buildTree(spec));
    const html = renderTree(spec);
    const server = snap(parse(html, spec[0]));
    const label = `#${index} ${spec[0]} ${html.length > 90 ? `${html.slice(0, 90)}…` : html}`;
    check(label, same(client, server) ? 'same' : { client, server }, 'same');
  });
  console.warn = quiet;
  config.sx = undefined;
  // 取值语义表的每一格：客户端写出来的 attribute 与服务端输出解析后的 attribute 相同
  const mismatch = [];
  for (const [key, tag] of MATRIX_KEYS) {
    for (const [label, value] of MATRIX_VALUES) {
      const client = seen(make(tag, { [key]: value }), key);
      const server = seen(parse(renderElement(tag, { [key]: value }), tag), key);
      if (client !== server) mismatch.push(`${key}={${label}}: 客户端 ${client}，服务端 ${server}`);
    }
  }
  check('取值语义表逐格：服务端与客户端一致', mismatch, []);
  const hasSelected = (el) => !!el.querySelector('option[selected]');
  const sel = ['select', { value: 'b' }, [['option', { value: 'a' }, 'A'], ['option', { value: 'b' }, 'B']]];
  fact('select value 在 option 上留下的 selected attribute（客户端 / 服务端；状态相同，只有 attribute 不同，form.reset 的落点不同）', [hasSelected(buildTree(sel)), hasSelected(parse(renderTree(sel), 'select'))]);
  // 服务端写不出来的：只有客户端有（挂载后补）
  const box = make('input', { type: 'checkbox', indeterminate: true });
  const ssrBox = parse(renderElement('input', { type: 'checkbox', indeterminate: true }), 'input');
  check('indeterminate 等只有 property 的键：服务端不输出，客户端挂载后补', [box.indeterminate, ssrBox.indeterminate, renderElement('input', { indeterminate: true })], [true, false, '<input>']);
  check('<textarea> 前导换行被解析器吞掉：服务端补一个换行后值相同', parse(renderElement('textarea', { value: '\nx' }), 'textarea').value, '\nx');
});

// ---------------------------------------------------------------- 动态键层、omit、undefined 落回
test('0 分层与动态键层', () => {
  const which = lib.signal(true);
  const a = { title: 'A', 'data-a': '1', class: 'ca' };
  const b = { title: 'B', 'data-b': '2' };
  const el = make('div', merge({ title: 'base', 'data-base': 'x', class: 'base' }, () => (which() ? a : b)));
  check('动态键层：初始', [attrs(el).title, attrs(el)['data-a'], attrs(el)['data-b'], el.className], ['A', '1', undefined, 'base ca']);
  which(false);
  check('动态键层：切换后键集合变化，消失的键落回下层或移除', [attrs(el).title, attrs(el)['data-a'], attrs(el)['data-b'], attrs(el)['data-base'], el.className], ['B', undefined, '2', 'x', 'base']);
  const t = lib.signal('x');
  const el2 = make('div', merge({ title: 'low' }, { get title() { return t(); } }));
  check('getter 键：undefined 落回下层', el2.title, 'x');
  t(undefined);
  check('getter 键变成 undefined 落回下层', el2.title, 'low');
  t(null);
  check('getter 键变成 null 移除（盖住下层）', el2.hasAttribute('title'), false);
  const rest = omit({ id: 'i', title: 't' }, ['title']);
  check('omit', attrs(make('div', merge({ role: 'r' }, rest))), { id: 'i', role: 'r' });
  const w = lib.signal(1);
  const before = stats.effects;
  make('div', merge({ a: 1, b: 2 }, { get c() { return w(); }, get d() { return w(); } }));
  check('静态键不起 effect，getter 键一个 effect 各一个', stats.effects - before, 2);
});

// ---------------------------------------------------------------- 运行
export async function runAll() {
  console.warn = (...args) => warnings.push(args.join(' '));
  for (const [name, fn] of tests) {
    group = name;
    try {
      await fn();
    } catch (error) {
      results.push({ group, name: '抛出异常', ok: false, actual: `${error.name}: ${error.message}\n${error.stack?.split('\n').slice(0, 3).join('\n')}`, expected: '不抛异常' });
    }
  }
  console.warn = realWarn;
  return { results, facts, modeSample: modeOf(document.body) };
}
window.runAll = runAll;
window.attrs = { spread, merge, setAttr };
