// node 17-bind/run.mjs [方案名片段] [--bench]：同一组场景，各体系写一遍，跑同样的断言
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launch } from '../lib/browser.mjs';
import { compile } from '../03-publish/packages/compiler/index.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const SYSTEMS = [
  ['s0-runes', '现状：符文 + _bindable / _bind', false],
  ['s1-ref', '方案一：ref + schema', true],
  ['s2-signal', '方案二：函数信号 + 接口', true],
  ['s3-hybrid', '方案三：符文 + 真实的壳', true],
  ['s4-store', '方案四：对象状态 + 路径代理', true],
  ['s5-auto', '方案五：符文 + 传变量即带写权限', true, true],
];
const filter = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const hiltPath = here('./hilt.ts').replaceAll('\\', '/');

async function bundleCase(name, twoWay, autoBind) {
  const entry = `import { flushSync, mount, component } from '@hilt/runtime'; import { App } from './cases/${name}.tsx'; window.flushSync = flushSync; mount(() => component(App, {}), document.body);`;
  const result = await build({
    stdin: { contents: entry, resolveDir: here('.'), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    alias: {
      '@hilt/runtime': here('../03-publish/packages/runtime/index.js'),
      '@hilt/css/abi': here('../10-css/engine/abi.ts'),
      '@hilt/css': here('../10-css/engine/runtime.ts'),
    },
    plugins: [
      {
        name: 'hilt',
        setup(b) {
          b.onLoad({ filter: /17-bind[\\/]cases[\\/].*\.tsx$/ }, async ({ path }) => ({
            contents: (await compile(await readFile(path, 'utf8'), path, twoWay ? { twoWayFrom: hiltPath, autoBind } : {})).code,
            loader: 'js',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

const browser = await launch();
let totalFail = 0;
const summary = [];
for (const [name, label, twoWay, autoBind] of SYSTEMS) {
  if (filter && !name.includes(filter)) continue;
  const fails = [];
  let passes = 0;
  const check = (what, passed, detail) => {
    if (passed) passes++;
    else fails.push(`${what} → ${JSON.stringify(detail)}`);
  };
  let code;
  try {
    code = await bundleCase(name, twoWay, autoBind);
  } catch (error) {
    console.log(`FAIL ${label}：构建失败 ${String(error.message).slice(0, 600)}`);
    totalFail++;
    continue;
  }
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ content: code });
  const flush = () => page.evaluate(() => window.flushSync());
  const text = (id) => page.evaluate((target) => document.getElementById(target)?.textContent, id);
  const checked = (id) => page.evaluate((target) => document.getElementById(target)?.checked, id);
  const value = (id) => page.evaluate((target) => document.getElementById(target)?.value, id);
  const click = async (id) => {
    await page.click(`#${id}`);
    await flush();
  };
  const fill = async (id, next) => {
    await page.fill(`#${id}`, next);
    await flush();
  };
  const dataState = (id) => page.evaluate((target) => document.getElementById(target)?.closest('label')?.dataset.state, id);

  try {
    // 双向
    await click('sw-bound');
    check('双向：子改父', (await text('sw-bound-state')) === 'true', await text('sw-bound-state'));
    check('双向：子组件自己的显示', (await dataState('sw-bound')) === 'on', await dataState('sw-bound'));
    await page.evaluate(() => window.api.setOn(false));
    await flush();
    check('双向：父改子', (await checked('sw-bound')) === false && (await dataState('sw-bound')) === 'off');
    // 不传：自己持有
    await click('sw-free');
    check('不传：组件自己持有', (await checked('sw-free')) === true && (await dataState('sw-free')) === 'on');
    // 受控拦截
    await click('sw-ctrl');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await flush();
    check('受控：没采纳，父级不变', (await text('sw-ctrl-state')) === 'false', await text('sw-ctrl-state'));
    check('受控：没采纳，子组件退回', (await dataState('sw-ctrl')) === 'off', await dataState('sw-ctrl'));
    check('受控：没采纳，原生 checked 也退回', (await checked('sw-ctrl')) === false, await checked('sw-ctrl'));
    await page.evaluate(() => window.api.setAllow(true));
    await flush();
    await click('sw-ctrl');
    check('受控：采纳后生效', (await text('sw-ctrl-state')) === 'true' && (await checked('sw-ctrl')) === true);
    // 转交两层
    await fill('field', '你好');
    check('转交两层到原生元素', (await text('field-state')) === '你好', await text('field-state'));
    // 嵌套字段
    check('嵌套字段初值', (await value('city')) === '北京', await value('city'));
    await fill('city', '上海');
    check('嵌套字段写回', (await text('city-state')) === '上海', await text('city-state'));
    // 换算
    check('换算：初值', (await value('temp')) === '32', await value('temp'));
    await fill('temp', '212');
    check('换算：写回', Number(await text('temp-state')) === 100, await text('temp-state'));
    // 多选组
    check('多选组：初值', (await checked('g-a')) === true && (await checked('g-b')) === false);
    await click('g-b');
    check('多选组：加入', (await text('g-state')) === 'a,b', await text('g-state'));
    await click('g-a');
    check('多选组：移除', (await text('g-state')) === 'b', await text('g-state'));
    // 修饰
    await fill('trim', '  x  ');
    check('去空格', (await text('trim-state')) === '[x]', await text('trim-state'));
    // Tabs
    check('Tabs：受控初值', (await text('panel')) === 'a', await text('panel'));
    await click('tab-b');
    check('Tabs：点击写回', (await text('panel')) === 'b', await text('panel'));
    await page.evaluate(() => window.api.setTab('a'));
    await flush();
    check('Tabs：父改', (await text('panel')) === 'a', await text('panel'));
    check('Tabs：不传，默认第一个', (await text('free-panel')) === 'x', await text('free-panel'));
    await click('free-y');
    check('Tabs：不传，自己持有', (await text('free-panel')) === 'y', await text('free-panel'));
    // 组合函数
    await click('toggle');
    check('组合函数返回的状态是活的', (await text('toggle-state')) === 'true', await text('toggle-state'));
    if (name === 's5-auto') {
      // 这条路线特有的风险
      await fill('direct', '直达');
      check('{...rest} 直接落到原生元素也双向', (await text('direct-state')) === '直达', await text('direct-state'));
      await fill('forward', '转交');
      check('中间层写 value={value} 转交：写入继续往上', (await text('forward-state')) === '转交', await text('forward-state'));
      await page.evaluate(() => window.api.setDerivedBase('a'));
      await flush();
      check('const 的派生传给原生：单向', (await value('readonly')) === 'A', await value('readonly'));
      await fill('readonly', 'zzz');
      check('const 的派生传给原生：不写回', (await text('readonly-state')) === 'a', await text('readonly-state'));
      await fill('optout', '不写');
      check('表达式（不是裸变量）：单向', (await text('optout-state')) === '初值', await text('optout-state'));
      await page.evaluate(() => window.api.setSnapshotText('父改'));
      await flush();
      check('子组件不声明 _model：只是普通只读 prop，也跟着变', (await text('plain-label')) === '父改', await text('plain-label'));
      await click('sw-derived');
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
      await flush();
      check('只读的派生传给 _model：不写回父级', (await text('sw-derived-state')) === 'false', await text('sw-derived-state'));
    }
    check('没有报错', errors.length === 0, errors);
  } catch (error) {
    fails.push(`中断：${String(error.message).slice(0, 200)}；页面错误：${errors.join(' | ').slice(0, 300)}`);
  }
  await page.close();
  console.log(`${fails.length ? 'FAIL' : 'ok  '} ${label}：${passes} 条通过${fails.length ? `，${fails.length} 条失败` : ''}`);
  for (const line of fails) console.log(`     ${line}`);
  totalFail += fails.length;
  const source = await readFile(here(`./cases/${name}.tsx`), 'utf8');
  const body = source.replace(/^\s*\/\/.*$/gm, '');
  summary.push([label, body.length, body.split('\n').filter((line) => line.trim()).length, (body.match(/\.value\b/g) ?? []).length, (body.match(/\b_\w+\(|\b_\w+\.\w+\(/g) ?? []).length]);
}
console.log('\n| 方案 | 字符 | 行 | .value 次数 | 符文调用次数 |\n| --- | --- | --- | --- | --- |');
for (const row of summary) console.log(`| ${row.join(' | ')} |`);
await browser.close();
if (totalFail) process.exitCode = 1;
