// 实验共用：把入口打包成一个 IIFE，在无头 Chromium 里打开，返回 page。
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

export async function bundle(entry, options = {}) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    // Solid 走浏览器产物，不走服务端的
    conditions: ['browser', 'production'],
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    ...options,
  });
  return result.outputFiles[0].text;
}

/** HILT_BROWSER=firefox|webkit 换浏览器跑同一份断言；计时和堆只看 Chromium */
export async function launch() {
  const name = process.env.HILT_BROWSER;
  if (name === 'firefox') return firefox.launch();
  if (name === 'webkit') return webkit.launch();
  return chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
}

export async function openPage(browser, code) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (error) => console.log('pageerror', error.message));
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ content: code });
  return page;
}

/** 强制 GC 后的 JS 堆（字节） */
export async function heapAfterGc(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return usedSize;
}

export const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
