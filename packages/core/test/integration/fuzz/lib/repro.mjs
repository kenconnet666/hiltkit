// 缺陷复现脚本的外壳：一段 JS/TSX 源码（可以 import 'hilt'、'hilt/css'，JSX 走 jsxImportSource: hilt），在无头 Chromium 里跑，
// 把结果挂到 window.result（可 JSON 序列化）；服务端的部分用 server(source)，源码导出 render() 返回字符串。
import { bundle } from '../../bundle.mjs';
import { launch, openPage } from './harness.mjs';

/** 浏览器里跑 source，返回 { result, errors } */
export async function client(source, { html = '' } = {}) {
  const code = await bundle(source);
  const browser = await launch();
  try {
    const page = await openPage(browser, '');
    if (html)
      await page.setContent(`<!doctype html><html><head></head><body>${html}</body></html>`);
    await page.addScriptTag({ content: code });
    return { result: await page.evaluate(() => window.result), errors: page.errors };
  } finally {
    await browser.close();
  }
}

/** Node 里跑服务端 bundle，返回它导出的 render() 的结果 */
export async function server(source) {
  const code = await bundle(source, { server: true });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  return module.render();
}

/** 统一的收尾：ok 返回 0，FAIL 设置退出码 */
export function verdict(ok, good, bad) {
  console.log(ok ? `ok ${good}` : `FAIL ${bad}`);
  process.exitCode = ok ? 0 : 1;
}
