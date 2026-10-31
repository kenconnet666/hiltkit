// node 03-publish/runes/props-run.mjs
import { fileURLToPath } from 'node:url';
import { bundle, launch, openPage } from '../../lib/browser.mjs';
import { hiltBuild } from '../rows/build.mjs';

const code = await bundle(fileURLToPath(new URL('./props-entry.tsx', import.meta.url)), { ...hiltBuild, minify: false });
const browser = await launch();
const page = await openPage(browser, code);
const check = (label, passed, detail) => console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `  → ${JSON.stringify(detail)}`}`);
const settle = () => page.evaluate(() => window.flushSync());
const text = (id) => page.locator(id).innerText();
const size = (id) => page.locator(id).getAttribute('data-size');
const warnings = () => page.evaluate(() => window.warnings.length);

check('解构：初值', (await text('#destructure')) === 'a' && (await size('#destructure')) === 'sm');
check('整体 props：初值', (await text('#props')) === 'a' && (await size('#props')) === 'sm');
check('整体 props 交给组合式函数', (await text('#composed')) === '标签:a', await text('#composed'));
check('rest 交给组合式函数', (await text('#rest-hook')) === '标签:a' && (await size('#rest-hook')) === 'sm', await text('#rest-hook'));
check('整体 props 转交给解构的组件', (await text('#forwarded')) === 'a', await text('#forwarded'));
check('两种写法都没有误报诊断', (await warnings()) === 0, await page.evaluate(() => window.warnings.slice(0, 2)));

await page.evaluate(() => window.setValue('b'));
await page.evaluate(() => window.setSize('lg'));
await settle();
check('解构：跟着变', (await text('#destructure')) === 'b' && (await size('#destructure')) === 'lg');
check('整体 props：跟着变', (await text('#props')) === 'b' && (await size('#props')) === 'lg');
check('组合式函数：跟着变', (await text('#composed')) === '标签:b', await text('#composed'));
check('rest 交给组合式函数：跟着变', (await text('#rest-hook')) === '标签:b', await text('#rest-hook'));

await page.evaluate(() => window.mountTopRead());
const warned = await warnings();
check('顶层读：诊断抓到', warned === 1, warned);
await page.evaluate(() => window.setTop('新值'));
await settle();
check('顶层读：确实只拿到当前值，诊断说的是真的', (await text('#top-read')) === '初值', await text('#top-read'));

await browser.close();
