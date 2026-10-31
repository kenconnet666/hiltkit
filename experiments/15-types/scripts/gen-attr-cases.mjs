// 从属性规则表（09-attr/shared.js，现为 03-publish/packages/runtime/rules.js）生成类型用例，保证“运行时认的属性 = 类型层认的属性”：
//   ALIAS（React 拼写）每个都必须在类型层报错；BOOL 属性每个都必须接受 true / '' 并拒绝 "false"。
// 用法：node scripts/gen-attr-cases.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// 规则表原本在 09-attr/shared.js，现已并入 03-publish/packages/runtime/rules.js：按顺序找第一个存在的
const source = ['../../09-attr/shared.js', '../../03-publish/packages/runtime/rules.js'].find((path) => existsSync(fileURLToPath(new URL(path, import.meta.url))));
if (!source) throw new Error('找不到属性规则表（09-attr/shared.js 或 03-publish/packages/runtime/rules.js）');
const { ALIAS, BOOL, KIND_MASK, TABLE } = await import(new URL(source, import.meta.url).href);

/** 布尔属性 → 能写它的标签（和 types/elements/html.d.ts 对照；全局属性用 div） */
const HOST = {
  allowfullscreen: 'iframe', async: 'script', autofocus: 'div', autoplay: 'video', controls: 'video', default: 'track',
  defer: 'script', disabled: 'button', formnovalidate: 'button', hidden: 'div', inert: 'div', ismap: 'img',
  itemscope: 'div', loop: 'video', multiple: 'input type="file"', nomodule: 'script', novalidate: 'form', open: 'details',
  playsinline: 'video', popover: 'div', readonly: 'input', required: 'input', reversed: 'ol',
  webkitdirectory: 'input type="file"', disablepictureinpicture: 'video', disableremoteplayback: 'video',
  checked: 'input type="checkbox"', selected: 'option', muted: 'video',
};
const boolNames = Object.keys(TABLE).filter((name) => typeof TABLE[name] === 'number' && ((TABLE[name] & KIND_MASK) === BOOL)).concat(['checked', 'selected', 'muted']);
const missing = boolNames.filter((name) => !HOST[name]);
if (missing.length) throw new Error(`HOST 缺少：${missing.join(', ')}`);

const lines = [`// 由 scripts/gen-attr-cases.mjs 从 09-attr/shared.js 生成，不要手改。`, `export const Generated = (`, `  <>`];
lines.push('    {/* BOOL 属性：true 与空字符串为真，"false" 字符串不是合法值 */}');
for (const name of boolNames) {
  const host = HOST[name];
  lines.push(`    <${host} ${name} />`, `    <${host} ${name}="" />`, `    <${host} ${name}={false} />`);
  lines.push(`    {/* @ts-expect-error "false" 是真值 */}`, `    <${host} ${name}="false" />`);
}
lines.push('    {/* ALIAS（React 拼写）：类型层必须拒绝并指向正确写法 */}');
for (const alias of Object.keys(ALIAS)) {
  lines.push(`    {/* @ts-expect-error ${alias} → ${ALIAS[alias]} */}`, `    <div ${alias}="x" />`);
}
lines.push('  </>', ');', '');
writeFileSync(fileURLToPath(new URL('../cases/08-generated-attrs.tsx', import.meta.url)), lines.join('\n'));
console.log(`规则表：${source}
BOOL ${boolNames.length} 个，ALIAS ${Object.keys(ALIAS).length} 个`);
