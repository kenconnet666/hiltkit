// 开发体验的断言：node 10-css/run.mjs --only=dev
import { readFile } from 'node:fs/promises';
import { openPage } from '../lib/browser.mjs';
import { compile } from '../03-publish/packages/compiler/index.mjs';
import { bundle, here } from './lib.mjs';

export async function run({ browser, check }) {
  console.log('## 开发体验：可读类名、devtools、热更新\n');
  const source = await readFile(here('./cases/dev.tsx'), 'utf8');
  const devOutput = (await compile(source, 'src/Button.tsx', { dev: true })).code;
  const prodOutput = (await compile(source, 'src/Button.tsx', { dev: false })).code;
  check('开发模式编译：顶层 create / recipe 被包上 hotStyles，create 带可读名字', devOutput.includes('_css_hotStyles("src/Button.tsx:styles"') && devOutput.includes('"Button.styles"') && devOutput.includes('_css_hotStyles("src/Button.tsx:button"'), devOutput.split('\n').filter((l) => l.includes('hotStyles')).slice(0, 3));
  check('生产编译：没有 hotStyles，也没有名字', !prodOutput.includes('hotStyles("src') && !prodOutput.includes('"Button.styles"'));

  for (const dev of [true, false]) {
    const code = await bundle(here('./cases/dev.tsx'), { minify: false, dev, define: { DEV: String(dev) } });
    const page = await openPage(browser, code);
    const tag = dev ? '开发' : '生产';
    const info = (id) => page.evaluate((i) => ({ cls: document.getElementById(i).className, color: getComputedStyle(document.getElementById(i)).color }), id);
    const a = await info('a');
    const b = await info('b');
    const text = await page.evaluate(() => window.api.styleText());
    console.log(`     [${tag}] 元素类名：a=${a.cls}  b=${b.cls}`);
    if (dev) {
      console.log(`     [开发] <style> 文本（devtools 元素面板里看到的）：\n${text.split('\n').slice(0, 6).map((l) => `       ${l}`).join('\n')}`);
      check('开发：类名可读（文件.变量.命名空间 + 哈希）', /^dev-styles-root-x[0-9a-z]+$/.test(a.cls) || /^dev-styles-root-x/.test(a.cls), a.cls);
      check('开发：配方的类名带组件名', b.cls.startsWith('Button'), b.cls);
      check('开发：<style> 里有规则原文与“由哪些片段组成”的注释', text.includes(`.${a.cls}{color:rgb(1, 0, 0)}`) && text.includes('/* ') && text.includes('Button'), text.slice(0, 200));
      check('开发：规则照常生效', a.color === 'rgb(1, 0, 0)' && b.color === 'rgb(2, 0, 0)', [a, b]);
      // 热更新
      const before = await info('m');
      const same = await page.evaluate(() => window.api.reloadStyles('rgb(9, 0, 0)'));
      const after = await info('m');
      check('热更新 create：返回旧对象，元素的类名不变，颜色原地生效', same && after.cls === before.cls && after.color === 'rgb(9, 0, 0)' && before.color === 'rgb(3, 0, 0)', { before, after });
      const textAfter = await page.evaluate(() => window.api.styleText());
      check('热更新 create：样式表里这个类只有一份规则（原地改写，没有堆积）', textAfter.split(`.${after.cls}{`).length === 2, textAfter.length);
      const rBefore = await info('r');
      const sameRecipe = await page.evaluate(() => window.api.reloadRecipe('rgb(8, 0, 0)'));
      const rAfter = await info('r');
      check('热更新 recipe：同样原地生效，类名不变', sameRecipe && rAfter.cls === rBefore.cls && rAfter.color === 'rgb(8, 0, 0)' && rBefore.color === 'rgb(4, 0, 0)', { rBefore, rAfter });
    } else {
      check('生产：类名只有哈希', /^x[0-9a-z]+$/.test(a.cls) && /^x[0-9a-z]+$/.test(b.cls), [a.cls, b.cls]);
      check('生产：<style> 元素文本是空的（走 insertRule，更快；devtools 的样式面板仍看得到规则）', text === '', text.slice(0, 80));
      check('生产：规则照常生效', a.color === 'rgb(1, 0, 0)', a);
    }
    await page.close();
  }
}
