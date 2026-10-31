// 优化 7 的下限：纯 DOM 写 10 个属性的几种方式，一万个按钮，不带任何框架。
//   node 07-instance/dom.mjs
import { chromium } from 'playwright';
import { median } from '../lib/browser.mjs';

const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
const result = await page.evaluate(() => {
  const N = 10_000;
  const attrs = [
    ['data-part', 'root'], ['tabindex', '0'], ['type', 'button'], ['role', 'button'], ['data-scope', 'button'],
    ['data-computed', 'x'], ['aria-label', 'x'], ['title', 't'], ['data-id', '1'],
  ];
  const bare = document.createElement('button');
  const baked = document.createElement('button');
  baked.className = 'base btn user';
  for (const [k, v] of attrs) baked.setAttribute(k, v);
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const cases = {
    '克隆空模板 + className + 9 个 setAttribute': (host) => {
      for (let i = 0; i < N; i++) {
        const el = bare.cloneNode();
        el.className = 'base btn user';
        for (let k = 0; k < attrs.length; k++) el.setAttribute(attrs[k][0], attrs[k][1]);
        host.append(el);
      }
    },
    '模板里已带 class + 2 个属性，再写 7 个（单层提升，02 的 hoisted 形状）': (host) => {
      const half = document.createElement('button');
      half.className = 'base';
      half.setAttribute('data-part', 'root');
      half.setAttribute('tabindex', '0');
      for (let i = 0; i < N; i++) {
        const el = half.cloneNode();
        el.className = 'base btn user';
        for (let k = 2; k < attrs.length; k++) el.setAttribute(attrs[k][0], attrs[k][1]);
        host.append(el);
      }
    },
    '克隆带全部属性的模板（0 次写）': (host) => {
      for (let i = 0; i < N; i++) host.append(baked.cloneNode());
    },
    '克隆带全部属性的模板 + 只写 data-id': (host) => {
      for (let i = 0; i < N; i++) {
        const el = baked.cloneNode();
        el.setAttribute('data-id', i);
        host.append(el);
      }
    },
    '9 个属性用 IDL 属性写（title/tabIndex/type/role/ariaLabel/dataset 不全，只写 4 个有 IDL 的）': (host) => {
      for (let i = 0; i < N; i++) {
        const el = bare.cloneNode();
        el.className = 'base btn user';
        el.tabIndex = 0;
        el.type = 'button';
        el.title = 't';
        el.ariaLabel = 'x';
        host.append(el);
      }
    },
    '整段 HTML 字符串 + 一次 innerHTML': (host) => {
      let html = '';
      for (let i = 0; i < N; i++) html += '<button class="base btn user" data-part="root" tabindex="0" type="button" role="button" data-scope="button" data-computed="x" aria-label="x" title="t" data-id="1"></button>';
      host.innerHTML = html;
    },
  };
  const out = {};
  for (const [name, run] of Object.entries(cases)) {
    const times = [];
    for (let round = 0; round < 9; round++) {
      const host = document.createElement('div');
      document.body.append(host);
      gc();
      const t0 = performance.now();
      run(host);
      times.push(performance.now() - t0);
      host.remove();
    }
    out[name] = +median(times).toFixed(1);
  }
  return out;
});
void median;
for (const [name, ms] of Object.entries(result)) console.log(`${String(ms).padStart(7)} ms / 万个  ${name}`);
await browser.close();
