// 复现脚本共用：打包一段 TSX，在 Chromium 里挂载，返回 page 和判定函数
import { launch } from '../../browser.mjs';
import { bundle } from '../../bundle.mjs';

export async function open(source) {
  const browser = await launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await bundle(source) });
  return { browser, page, errors, flush: () => page.evaluate(() => window.flushSync()) };
}
export const verdict = (label, ok, detail) =>
  console.log(`${ok ? 'ok   ' : 'BUG  '} ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
