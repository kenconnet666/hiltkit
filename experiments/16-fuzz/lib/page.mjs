// 浏览器侧的共用件：打包、开页面、收集报错
import { build } from 'esbuild';
import { chromium } from 'playwright';

export async function bundleIife(entry, extra = {}) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', ...extra });
  return result.outputFiles[0].text;
}

/** 把一段源码（可 import 运行时）打成 IIFE：缺陷复现脚本用 */
export async function bundleSource(contents, resolveDir) {
  const result = await build({ stdin: { contents, resolveDir, loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' });
  return result.outputFiles[0].text;
}

export const launch = () => chromium.launch();

/** 打开一个空白页并注入脚本；errors 收集 pageerror 和 console.error */
export async function openPage(browser, code, viewport = { width: 1000, height: 800 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && errors.push(`console.error: ${message.text()}`));
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  if (code) await page.addScriptTag({ content: code });
  return Object.assign(page, { errors });
}

/**
 * 缺陷复现脚本的外壳：source 里 import 运行时，把结果挂到 window.result（可 JSON 序列化）。
 * 返回 result；脚本自己判断 ok / FAIL。
 */
export async function runInBrowser(source, resolveDir) {
  const code = await bundleSource(source, resolveDir);
  const browser = await launch();
  try {
    const page = await openPage(browser, code);
    const result = await page.evaluate(() => window.result);
    return { result, errors: page.errors };
  } finally {
    await browser.close();
  }
}
