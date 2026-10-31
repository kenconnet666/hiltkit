// node 03-publish/runes/bind-run.mjs
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../../lib/browser.mjs';
import { compile } from '../packages/compiler/index.mjs';
import { hiltBuild } from '../rows/build.mjs';

const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);

console.log('--- 编译期：写不回去的直接报错 ---');
const rejects = async (source) => {
  try {
    await compile(source, 'x.tsx');
    return null;
  } catch (error) {
    return error.message;
  }
};
const inComponent = (body, jsx, params = '') => `const A = _component(({ ${params} }) => { ${body}; return ${jsx}; });`;
const cases = [
  ['表达式', inComponent('let x = _state("")', '<input value={_bind(x ?? "")} />'), '表达式'],
  ['字面量', inComponent('', '<input value={_bind("a")} />'), '表达式'],
  ['函数调用', inComponent('let x = _state("")', '<input value={_bind(String(x))} />'), '表达式'],
  ['const 派生', inComponent('let x = _state(""); const d = _derived(x)', '<input value={_bind(d)} />'), 'const'],
  ['const 状态', inComponent('const x = _state(1)', '<input value={_bind(x)} />'), 'const'],
  ['普通变量', inComponent('let x = 1', '<input value={_bind(x)} />'), '不是响应式'],
  ['只读 prop', inComponent('', '<input value={_bind(size)} />', 'size'), '_bindable(默认值)'],
  ['只读 prop 带默认值', inComponent('', '<input value={_bind(size)} />', 'size = "md"'), '_bindable(默认值)'],
];
for (const [label, source, expected] of cases) {
  const message = await rejects(source);
  check(`拒绝：${label}`, message?.includes(expected), message);
}
const allowed = [
  ['let 状态', inComponent('let x = _state("")', '<input value={_bind(x)} />')],
  ['可覆盖的派生', inComponent('let x = _state(""); let d = _derived(x)', '<input value={_bind(d)} />')],
  ['_bindable 声明的 prop', inComponent('', '<input value={_bind(value)} />', 'value = _bindable("")')],
  ['_bindable.raw 声明的 prop', inComponent('', '<input value={_bind(value)} />', 'value = _bindable.raw("")')],
  ['对象属性', inComponent('const f = _state({ a: 1 })', '<input value={_bind(f.a)} />')],
  ['数组元素', inComponent('const f = _state([{ a: 1 }])', '<input value={_bind(f[0].a)} />')],
];
for (const [label, source] of allowed) check(`允许：${label}`, (await rejects(source)) === null, await rejects(source));
const stateProp = await rejects(`const A = _component(({ value = _state('') }) => <i>{value}</i>);`);
check('prop 写 _state 报错，并给出两种改法', stateProp?.includes('_bindable(默认值)') && stateProp?.includes('let current = _state(value)'), stateProp);
const misplaced = await rejects(inComponent('let x = _state(""); const y = _bind(x)', '<i />'));
check('写在 JSX 属性以外报错', misplaced?.includes('只能直接写在 JSX 属性上'), misplaced);

const code = await bundle(fileURLToPath(new URL('./bind-entry.tsx', import.meta.url)), { ...hiltBuild, minify: false });
const browser = await launch();
const page = await openPage(browser, code);
const settle = async () => {
  await page.evaluate(() => window.flushSync());
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
  await page.evaluate(() => window.flushSync());
};
const value = (id) => page.inputValue(id);
const text = (id) => page.locator(id).innerText();
const read = () => page.evaluate(() => window.api.read());
const api = async (name, arg) => {
  await page.evaluate(([n, a]) => window.api[n](a), [name, arg]);
  await settle();
};
const run = async (name, arg) => {
  await page.evaluate(([n, a]) => window[n](a), [name, arg]);
  await settle();
};
const fill = async (id, next) => {
  await page.fill(id, next);
  await settle();
};

console.log('--- 组件 ---');
check('不传：用默认值', (await value('#free')) === '默认');
await fill('#free', '改了');
check('不传：组件自己的状态', (await value('#free')) === '改了');
check('_bind：初值来自父级', (await value('#bound')) === '父');
await fill('#bound', '子改');
check('_bind：子改父', (await read()).bound === '子改');
await api('setBound', '父改');
check('_bind：父改子', (await value('#bound')) === '父改');
check('只传值：初值', (await value('#initial')) === '只给初值');
await fill('#notify', '新');
check('_bind + 回调：写回', (await read()).notifying === '新', await read());
check('_bind + 回调：也通知', (await page.evaluate(() => window.log.notified.join())) === '新', await page.evaluate(() => window.log.notified));
await fill('#reject', '想改');
check('不用 _bind、回调不采纳：组件退回', (await value('#reject')) === '稳' && (await read()).rejected === '稳', await value('#reject'));

console.log('--- 转交 ---');
check('经 rest 落到原生元素：初值', (await value('#forward')) === '转');
await fill('#forward', '转2');
check('经 rest 落到原生元素：写回', (await read()).forwarded === '转2', await read());
await fill('#forward2', '二2');
check('两层转交：写回', (await read()).forwarded2 === '二2', await read());

console.log('--- 和 _state 一样的语义 ---');
await run('ownTagsAdd', 'b');
check('默认值深代理：push 后更新', (await text('#ownTags')) === 'a,b', await text('#ownTags'));
await run('ownTagsReplace', ['c']);
await run('ownTagsAdd', 'd');
check('整体替换后还是深代理', (await text('#ownTags')) === 'c,d', await text('#ownTags'));
await run('ownRowsPush');
check('_bindable.raw：push 不更新', (await text('#ownRows')) === '1', await text('#ownRows'));
await run('ownRowsReplace', [2, 3]);
check('_bindable.raw：整体替换才更新', (await text('#ownRows')) === '2,3', await text('#ownRows'));
await run('boundTagsAdd', 'y');
check('绑定时 push：父子共用一个深代理', (await text('#boundTags')) === 'x,y' && (await read()).boundTags.join() === 'x,y', await read());
await run('boundTagsReplace', ['z']);
check('绑定时整体替换：写回父级', (await read()).boundTags.join() === 'z', await read());
check('默认值可以用前面的 prop', (await text('#once')) === '2', await text('#once'));
await api('setSeed', 50);
check('其他 prop 变了不冲掉自己的状态', (await text('#once')) === '2', await text('#once'));
await page.click('#once');
await settle();
check('自己的状态能改，组件体只跑一次', (await text('#once')) === '3' && (await page.evaluate(() => window.log.built)) === 1, await page.evaluate(() => window.log.built));

console.log('--- 原生元素 ---');
check('value：初值', (await value('#plain')) === 'p');
await fill('#plain', 'p2');
check('value：写回', (await read()).plain === 'p2');
check('单向的 value 跟着变，就是原生属性', (await value('#oneway')) === 'p2', await value('#oneway'));
await page.fill('#oneway', '用户打的字');
await settle();
check('单向：不写回', (await read()).plain === 'p2', await read());
check('单向：不强行改回用户打的字', (await value('#oneway')) === '用户打的字', await value('#oneway'));
await fill('#plain', 'p3');
check('单向：状态再变时才覆盖', (await value('#oneway')) === 'p3', await value('#oneway'));

await fill('#trim', '  有空格  ');
check('_bind.trim', (await read()).trimmed === '有空格', await read());
await page.fill('#lazy', '打字中');
await settle();
check('_bind.lazy：打字时不写回', (await read()).lazy === '', await read());
await page.locator('#lazy').blur();
await settle();
check('_bind.lazy：失焦才写回', (await read()).lazy === '打字中', await read());
await fill('#amount', '42');
check('type=number 自动按数字读回', (await read()).amount === 42, await read());
await api('setAmount', 7);
check('type=number：父改子', (await value('#amount')) === '7');
await fill('#forced', '5');
check('_bind.number', (await read()).forced === 5, await read());

// 中文输入法：组合期间不写回，结束才写回
await page.evaluate(() => {
  const el = document.getElementById('plain');
  el.value = 'zhong';
  el.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }));
});
await settle();
check('输入法组合期间不写回', (await read()).plain === 'p3', await read());
await page.evaluate(() => {
  const el = document.getElementById('plain');
  el.value = '中';
  el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
});
await settle();
check('输入法组合结束才写回', (await read()).plain === '中', await read());

await page.check('#flag');
await settle();
check('checked：写回', (await read()).flag === true);
await api('setFlag', false);
check('checked：父改子', (await page.isChecked('#flag')) === false);
check('多选组：初值', (await page.isChecked('#group-a')) === true && (await page.isChecked('#group-b')) === false);
await page.check('#group-b');
await settle();
check('多选组：勾选加进数组', (await read()).picked.join() === 'a,b', await read());
await page.uncheck('#group-a');
await settle();
check('多选组：取消移出数组', (await read()).picked.join() === 'b', await read());
await api('setPicked', ['a']);
check('多选组：父改子', (await page.isChecked('#group-a')) === true && (await page.isChecked('#group-b')) === false);
check('select：初值', (await value('#select')) === 'b', await value('#select'));
await page.selectOption('#select', 'a');
await settle();
check('select：写回', (await read()).chosen === 'a', await read());
await fill('#area', '多行');
check('textarea：写回', (await read()).area === '多行', await read());
await api('setOpened', true);
check('details：父改子', await page.evaluate(() => document.getElementById('details').open));
await page.click('#details summary');
await settle();
check('details：用户收起写回', (await read()).opened === false, await read());
const upload = join(tmpdir(), 'hilt-bind-probe.txt');
writeFileSync(upload, 'x');
await page.setInputFiles('#file', upload);
await settle();
check('文件：只读写回', (await read()).files === 1, await read());
await fill('#field', 'f2');
check('对象属性', (await read()).name === 'f2', await read());
await fill('#cell', 'q2');
check('嵌套数组元素', (await read()).qty === 'q2', await read());
await fill('#override', '覆盖');
check('可覆盖的派生：写入生效', (await read()).optimistic === '覆盖', await read());
await api('setPlain', '依赖变了');
check('可覆盖的派生：依赖变化后跟回来', (await read()).optimistic === '依赖变了' && (await value('#override')) === '依赖变了', await read());

console.log('--- 开发期诊断 ---');
check('正常用法没有误报', (await page.evaluate(() => window.warnings.filter((w) => String(w).includes('_bind')).length)) === 0, await page.evaluate(() => window.warnings.filter((w) => String(w).includes('_bind'))));
await page.evaluate(() => window.mountReadOnly());
await settle();
const warned = await page.evaluate(() => window.warnings.filter((w) => String(w).includes('_bind')));
check('绑到只读 prop：开发期查得到，并提示 _bindable', warned.length === 1 && warned[0].includes('size') && warned[0].includes('_bindable'), warned);

await browser.close();
