// 开发速度：工作区源码形态的组件库，Vite 不装任何插件。node 18-plain/dev.mjs 300 1000
// 和 12-dev 的“工作区源码”场景对应：每个组件一个文件，都走开发服务器，这是最慢的形态
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { ALIAS, here } from './bundle.mjs';
import { hiltHot } from './hilt/vite.mjs';

const root = fileURLToPath(new URL('./.gen', import.meta.url));
const sizes = process.argv.slice(2).map(Number);
const medianOf = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

function generate(count) {
  const dir = join(root, String(count));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'ui'), { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(
      join(dir, 'ui', `C${i}.tsx`),
      `import { merge, model, read, sig, type Model, type Prop } from 'hilt';
import { create } from 'hilt/css';
const styles = create({ root: { padding: '${(i % 20) + 1}px', color: 'rgb(${i % 255}, 0, 0)' }, on: { fontWeight: 600 } });
export function C${i}({ checked, label, ...rest }: { checked?: Model<boolean>; label?: Prop<string>; [other: string]: unknown }) {
  const on = model(checked, false);
  const hover = sig(false);
  return (
    <label {...merge(rest as object, { class: 'c${i}' })} sx={[styles.root, () => on() && styles.on]} data-hover={hover} data-state={() => (on() ? 'on' : 'off')}>
      <input type="checkbox" checked={on} />
      <span>{label}</span>
      <em>{() => read(label) ?? ''}</em>
    </label>
  );
}
`,
    );
  }
  writeFileSync(join(dir, 'ui', 'index.ts'), Array.from({ length: count }, (_, i) => `export { C${i} } from './C${i}';`).join('\n'));
  writeFileSync(
    join(dir, 'Page.tsx'),
    `import { sig } from 'hilt';
import { ${Array.from({ length: Math.min(count, 300) }, (_, i) => `C${i}`).join(', ')} } from './ui';
export function Page() {
  const on = sig(false);
  return <main><p id="page">版本 0</p><button id="kept" onClick={() => on.toggle()}>{() => String(on())}</button>${Array.from({ length: Math.min(count, 300) }, (_, i) => `<C${i} label="x" checked={on} />`).join('')}</main>;
}
`,
  );
  writeFileSync(join(dir, 'main.tsx'), `import { mount } from 'hilt';\nimport { Page } from './Page';\nmount(() => <Page />, document.getElementById('app')!);\nwindow.__ready = performance.now();\n`);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/main.tsx"></script></body></html>');
  return dir;
}

const browser = await chromium.launch();
for (const count of sizes) {
  const dir = generate(count);
  const startup = performance.now();
  const server = await createServer({
    root: dir,
    configFile: false,
    logLevel: 'silent',
    plugins: [hiltHot()],
    cacheDir: join(dir, '.vite'),
    server: { port: 5400 + (count % 90), strictPort: false, fs: { strict: false } },
    resolve: { alias: Object.entries(ALIAS).map(([find, replacement]) => ({ find: new RegExp(`^${find.replace('/', '\\/')}$`), replacement })) },
    esbuild: { jsx: 'automatic', jsxImportSource: 'hilt' },
    oxc: { jsx: { runtime: 'automatic', importSource: 'hilt' } },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const ready = performance.now() - startup;
  const url = server.resolvedUrls.local[0];
  const open = async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let requests = 0;
    page.on('request', () => requests++);
    const start = performance.now();
    await page.goto(url);
    await page.waitForSelector('#page', { timeout: 120000 });
    return { page, ms: performance.now() - start, requests, errors };
  };
  const first = await open();
  await first.page.close();
  const again = await open();
  // 改页面：没有热更新插件，Vite 整页刷新
  const edit = async (file, from, to) => {
    const path = join(dir, file);
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.replace(from, to));
  };
  // 页面上做个记号：热更新没有整页刷新就还在
  await again.page.evaluate(() => (window.__alive = true));
  await again.page.click('#kept');
  const kept = () => again.page.evaluate(() => ({ alive: !!window.__alive, kept: document.getElementById('kept').textContent }));
  const componentReloads = [];
  const states = [];
  for (let round = 1; round <= 3; round++) {
    const start = performance.now();
    await edit('ui/C5.tsx', `class: 'c5${round > 1 ? `-${round - 1}` : ''}'`, `class: 'c5-${round}'`);
    await again.page.waitForFunction((name) => !!document.querySelector(`.${name}`), `c5-${round}`, { timeout: 60000 });
    componentReloads.push(performance.now() - start);
    states.push(await kept());
  }
  const styleReloads = [];
  for (let round = 1; round <= 3; round++) {
    const start = performance.now();
    await edit('ui/C7.tsx', `fontWeight: ${round === 1 ? 600 : 600 + round - 1}`, `fontWeight: ${600 + round}`);
    await again.page.waitForFunction((weight) => {
      for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule.cssText.includes(`font-weight: ${weight}`)) return true;
      return document.querySelector('.c7') && false;
    }, 600 + round, { timeout: 5000 }).catch(() => {});
    styleReloads.push(performance.now() - start);
  }
  const reloads = [];
  for (let round = 1; round <= 3; round++) {
    const start = performance.now();
    await edit('Page.tsx', `版本 ${round - 1}`, `版本 ${round}`);
    await again.page.waitForFunction((text) => document.getElementById('page')?.textContent === text, `版本 ${round}`, { timeout: 60000 });
    reloads.push(performance.now() - start);
  }
  const afterPage = await kept();
  const instances = await again.page.evaluate((n) => document.querySelectorAll('label').length === n, Math.min(count, 300));
  console.log(`\n| ${count} 个组件 | 值 |\n| --- | --- |`);
  console.log(`| 开发服务器就绪 | ${ready.toFixed(0)} ms |`);
  console.log(`| 首次打开 | ${first.ms.toFixed(0)} ms，${first.requests} 个请求，错误 ${first.errors.length}${first.errors[0] ? `：${first.errors[0].slice(0, 160)}` : ''} |`);
  console.log(`| 同会话再开 | ${again.ms.toFixed(0)} ms |`);
  console.log(`| 改组件到生效 | ${medianOf(componentReloads).toFixed(0)} ms；没有整页刷新 ${states.every((s) => s.alive)}；上层状态保留 ${states.every((s) => s.kept === 'true')} |`);
  console.log(`| 改样式到生效 | ${medianOf(styleReloads).toFixed(0)} ms |`);
  console.log(`| 改页面到生效 | ${medianOf(reloads).toFixed(0)} ms；没有整页刷新 ${afterPage.alive}；实例数正确 ${instances}；页面状态重置为 ${afterPage.kept} |`);
  await again.page.close();
  await server.close();
}
await browser.close();
rmSync(root, { recursive: true, force: true });
void here;
