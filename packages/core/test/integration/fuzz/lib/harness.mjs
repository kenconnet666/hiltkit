// 三个浏览器方向共用：打包（和 18-plain/bundle.mjs 同一套 esbuild + jsxImportSource: hilt，没有插件）、开页面、载入服务端 bundle。
import { fileURLToPath } from 'node:url';
import { launch } from '../../browser.mjs';
import { bundle } from '../../bundle.mjs';

export { launch };
/** selfcheck.mjs 用：把运行时换成被故意改坏的副本（环境变量里是 JSON：别名 -> 文件） */
const mutated = process.env.FUZZ_ALIAS ? JSON.parse(process.env.FUZZ_ALIAS) : {};
const withMutation = (options) => ({ ...options, alias: { ...mutated, ...options.alias } });
const fuzzFile = (relative) =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url)).replace(/\\/g, '/');

/** 把 fuzz/ 下的一个模块打成浏览器 IIFE；extra 是追加在入口里的语句 */
export const bundleClient = (relative, extra = '', options = {}) =>
  bundle(`import ${JSON.stringify(fuzzFile(relative))};\n${extra}`, withMutation(options));

/** 服务端 bundle：Node 里直接 import，得到入口模块的导出。换成别的 hilt 实现（变异体）用 options.alias */
export async function loadServer(relative, options = {}) {
  const code = await bundle(
    `export * from ${JSON.stringify(fuzzFile(relative))};`,
    withMutation({ server: true, ...options }),
  );
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** 打开空白页，注入脚本；errors 收集 pageerror 与 console.error */
export async function openPage(browser, code) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  // 浏览器自己对非法 SVG 属性值（d="true"）的解析报错不算框架的问题
  page.on(
    'console',
    (message) =>
      message.type() === 'error' &&
      !/^Error: <\w+> attribute /.test(message.text()) &&
      errors.push(`console.error: ${message.text()}`),
  );
  page.setDefaultTimeout(10_000);
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  if (code) await page.addScriptTag({ content: code });
  return Object.assign(page, { errors });
}
