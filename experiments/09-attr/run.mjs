// 实验九：属性写入与分层合并。node 09-attr/run.mjs [--only tests|net|bench] [--rounds N] [--browsers chromium,firefox,webkit]
// tests  三个浏览器里跑 tests.js 的断言（取值语义表、class、style、事件、顺序、安全、SSR 一致）
// net    <img> 属性写入顺序对请求数的影响（要拦截网络，单独一节）
// bench  setAttr 的开销、一趟解析的 spread 与 07-instance 的 lean 版对比（计时只看量级）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : (args[at + 1] ?? true);
};
const ONLY = flag('only', 'all');
const ROUNDS = +flag('rounds', 9);
const BROWSERS = Object.entries({ chromium, firefox, webkit }).filter(([name]) => flag('browsers', 'chromium,firefox,webkit').split(',').includes(name));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function bundle(entry) {
  const result = await build({ entryPoints: [`${here}${entry}`], bundle: true, write: false, format: 'iife', target: 'es2022', conditions: ['browser'], minify: false, define: { 'process.env.NODE_ENV': '"production"' } });
  return result.outputFiles[0].text;
}

/** 页面在 http://test.local/ 上，图片请求被拦截计数 */
async function openPage(browser, code, hits) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await context.route('http://test.local/**', (route) => {
    const url = route.request().url();
    if (url.includes('/img/')) {
      hits?.push(url.replace('http://test.local', ''));
      return route.fulfill({ body: PNG, contentType: 'image/png' });
    }
    if (url.endsWith('/frame.html')) return route.fulfill({ body: '<script>parent.postMessage(String(origin), "*")</script>', contentType: 'text/html' });
    return route.fulfill({ body: '<!doctype html><html><body></body></html>', contentType: 'text/html' });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('  pageerror', error.message));
  await page.goto('http://test.local/');
  await page.addScriptTag({ content: code });
  return page;
}

const short = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > 700 ? `${text.slice(0, 700)}…` : text;
};

// ------------------------------------------------------------------ tests
async function runTests() {
  const code = await bundle('tests.js');
  const all = {};
  for (const [name, type] of BROWSERS) {
    const browser = await type.launch();
    const page = await openPage(browser, code);
    all[name] = { version: browser.version(), ...(await page.evaluate(() => window.runAll())) };
    await browser.close();
  }
  console.log('\n== 断言 ==');
  for (const [name, run] of Object.entries(all)) {
    const failed = run.results.filter((r) => !r.ok);
    console.log(`${name} ${run.version}: ${run.results.length - failed.length}/${run.results.length} 通过`);
  }
  const names = Object.keys(all);
  const failures = new Map();
  for (const [name, run] of Object.entries(all)) {
    for (const r of run.results.filter((x) => !x.ok)) {
      const key = `${r.group} | ${r.name}`;
      if (!failures.has(key)) failures.set(key, { expected: r.expected, by: {} });
      failures.get(key).by[name] = r.actual;
    }
  }
  if (failures.size) console.log('\n-- 失败（原样）--');
  for (const [key, f] of failures) {
    console.log(`× ${key}\n    期望 ${short(f.expected)}`);
    for (const [name, actual] of Object.entries(f.by)) console.log(`    ${name} 得到 ${short(actual)}`);
    const passed = names.filter((n) => !(n in f.by));
    if (passed.length) console.log(`    （${passed.join('、')} 通过）`);
  }
  console.log('\n== 观察结果（facts）==');
  const keys = Object.keys(all[names[0]].facts).filter((k) => k !== '语义表');
  for (const key of keys) {
    const values = names.map((n) => short(all[n].facts[key]));
    const differ = new Set(values).size > 1;
    console.log(`${differ ? '【不同】' : ''}${key}\n    ${differ ? names.map((n, i) => `${n}: ${values[i]}`).join('\n    ') : values[0]}`);
  }
  // 语义表：取第一个浏览器，再对比其他浏览器
  const table = all[names[0]].facts['语义表'];
  console.log(`\n== 取值语义表（${names[0]}；格子是 getAttribute 的结果，- 表示没有该 attribute）==`);
  const columns = Object.keys(Object.values(table)[0]);
  console.log(['值 \\ 键', ...Object.keys(table)].join(' | '));
  for (const column of columns) console.log([column, ...Object.keys(table).map((key) => table[key][column])].join(' | '));
  for (const other of names.slice(1)) {
    const diffs = [];
    for (const key of Object.keys(table)) for (const column of columns) if (all[other].facts['语义表'][key][column] !== table[key][column]) diffs.push(`${key}/${column}: ${table[key][column]} vs ${all[other].facts['语义表'][key][column]}`);
    console.log(`语义表 ${names[0]} 与 ${other} 的差异：${diffs.length ? diffs.join('；') : '无'}`);
  }
  return all;
}

// ------------------------------------------------------------------ net
const IMG_CASES = {
  'src → srcset → sizes（先挂文档，同一任务里写）': (a) => { const i = new Image(); document.body.append(i); i.setAttribute('src', '/img/fallback.png'); i.setAttribute('srcset', '/img/s1.png 1x, /img/s2.png 2x'); i.setAttribute('sizes', '100vw'); return i; },
  'sizes → srcset → src（先挂文档，同一任务里写）': () => { const i = new Image(); document.body.append(i); i.setAttribute('sizes', '100vw'); i.setAttribute('srcset', '/img/t1.png 1x, /img/t2.png 2x'); i.setAttribute('src', '/img/fallback2.png'); return i; },
  '先 src，再 loading=lazy（屏幕外，同一任务）': () => { const i = new Image(); i.style.cssText = 'position:absolute;top:6000px'; document.body.append(i); i.setAttribute('src', '/img/lazy-after.png'); i.setAttribute('loading', 'lazy'); return i; },
  '先 loading=lazy，再 src（屏幕外，同一任务）': () => { const i = new Image(); i.style.cssText = 'position:absolute;top:6200px'; document.body.append(i); i.setAttribute('loading', 'lazy'); i.setAttribute('src', '/img/lazy-before.png'); return i; },
  'src 写好后过一个微任务再 loading=lazy（屏幕外）': () => { const i = new Image(); i.style.cssText = 'position:absolute;top:6400px'; document.body.append(i); i.setAttribute('src', '/img/lazy-micro.png'); queueMicrotask(() => i.setAttribute('loading', 'lazy')); return i; },
  'srcset → sizes → src（先挂文档，同一任务里写）': () => { const i = new Image(); document.body.append(i); i.setAttribute('srcset', '/img/u1.png 1x, /img/u2.png 2x'); i.setAttribute('sizes', '100vw'); i.setAttribute('src', '/img/fallback3.png'); return i; },
  'spread：{ src, loading:lazy, srcset, sizes }（屏幕外）': () => { const i = new Image(); i.style.cssText = 'position:absolute;top:6600px'; document.body.append(i); window.attrs.spread(i, { src: '/img/sp-fallback.png', srcset: '/img/sp1.png 1x, /img/sp2.png 2x', sizes: '100vw', loading: 'lazy' }); return i; },
};
async function runNet() {
  const code = await bundle('tests.js');
  console.log('\n== <img> 写入顺序与请求数（屏幕外的 lazy 图不该有请求）==');
  const out = {};
  for (const [name, type] of BROWSERS) {
    const browser = await type.launch();
    const hits = [];
    const page = await openPage(browser, code, hits);
    for (const [label, make] of Object.entries(IMG_CASES)) {
      hits.length = 0;
      await page.evaluate(`(${make.toString()})()`);
      await page.waitForTimeout(400);
      (out[label] ??= {})[name] = [...hits];
    }
    await browser.close();
  }
  for (const [label, byBrowser] of Object.entries(out)) {
    console.log(label);
    for (const [name, hits] of Object.entries(byBrowser)) console.log(`    ${name}: ${hits.length} 个请求 ${JSON.stringify(hits.map((h) => h.replace('/img/', '')))}`);
  }
  console.log('\n== iframe：src 与 sandbox 的写入顺序（iframe 里的页面脚本报告自己的 origin；“超时”= 脚本被禁止 = 沙箱生效；有 origin = 沙箱没套上）==');
  const frameCases = {
    '先 src 后 sandbox（先挂文档）': () => { const f = document.createElement('iframe'); document.body.append(f); f.setAttribute('src', '/frame.html'); f.setAttribute('sandbox', ''); return f; },
    '先 sandbox 后 src（先挂文档）': () => { const f = document.createElement('iframe'); document.body.append(f); f.setAttribute('sandbox', ''); f.setAttribute('src', '/frame.html'); return f; },
    'spread({ src, sandbox })（先挂文档）': () => { const f = document.createElement('iframe'); document.body.append(f); window.attrs.spread(f, { src: '/frame.html', sandbox: '' }); return f; },
  };
  for (const [label, make] of Object.entries(frameCases)) {
    const line = [];
    for (const [name, type] of BROWSERS) {
      const browser = await type.launch();
      const page = await openPage(browser, code, []);
      const script = `(async () => { const got = new Promise((r) => addEventListener('message', (e) => r(e.data))); (${make.toString()})(); return Promise.race([got, new Promise((r) => setTimeout(() => r('超时'), 1500))]); })()`;
      line.push(`${name}: ${await page.evaluate(script)}`);
      await browser.close();
    }
    console.log(`${label}  ->  ${line.join('  ')}`);
  }
  console.log('\n== autofocus：什么时候写、怎么写才会聚焦（每个用例一个新页面，文档只处理一次 autofocus）==');
  const focusCases = {
    '先写 attribute，再插入文档': () => { const i = document.createElement('input'); i.setAttribute('autofocus', ''); document.body.append(i); return i; },
    '先插入文档，再写 attribute': () => { const i = document.createElement('input'); document.body.append(i); i.setAttribute('autofocus', ''); return i; },
    '先写 property autofocus=true，再插入文档': () => { const i = document.createElement('input'); i.autofocus = true; document.body.append(i); return i; },
    '模板克隆（模板里写了 autofocus）再插入': () => { const t = document.createElement('template'); t.innerHTML = '<input autofocus>'; const i = t.content.firstChild.cloneNode(true); document.body.append(i); return i; },
    'spread({ autofocus: true }) 再插入文档': () => { const i = document.createElement('input'); window.attrs.spread(i, { autofocus: true }); document.body.append(i); return i; },
    'spread 后插入文档，再 el.focus()（Svelte 的做法）': () => { const i = document.createElement('input'); window.attrs.spread(i, { autofocus: true }); document.body.append(i); i.focus(); return i; },
  };
  const probe = (make) => `(async () => { const el = (${make.toString()})(); await new Promise((r) => setTimeout(r, 100)); return document.activeElement === el; })()`;
  for (const [label, make] of Object.entries(focusCases)) {
    const line = [];
    for (const [name, type] of BROWSERS) {
      const browser = await type.launch();
      const page = await openPage(browser, code, []);
      line.push(`${name}: ${await page.evaluate(probe(make))}`);
      await browser.close();
    }
    console.log(`${label}  ->  ${line.join('  ')}`);
  }
  return out;
}

// ------------------------------------------------------------------ bench
async function runBench() {
  const code = await bundle('bench.js');
  console.log(`\n== 开销（每轮新页面？否：同页面热身一次后取 ${ROUNDS} 轮中位数；别的进程在跑时只看量级）==`);
  const out = {};
  for (const [name, type] of BROWSERS) {
    const browser = await type.launch();
    const page = await openPage(browser, code);
    out[name] = await page.evaluate((rounds) => window.bench(rounds), ROUNDS);
    await browser.close();
    console.log(`\n${name}`);
    for (const [title, rows] of Object.entries(out[name])) {
      console.log(`  ${title}`);
      for (const [label, ms] of Object.entries(rows)) console.log(`    ${label}: ${ms} ms`);
    }
  }
  return out;
}

const report = {};
if (ONLY === 'all' || ONLY === 'tests') report.tests = await runTests();
if (ONLY === 'all' || ONLY === 'net') report.net = await runNet();
if (ONLY === 'all' || ONLY === 'bench') report.bench = await runBench();
writeFileSync(`${here}last-run.json`, JSON.stringify(report, null, 2));
