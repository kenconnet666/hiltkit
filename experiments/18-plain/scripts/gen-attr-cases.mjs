// 从运行时的属性规则表（03-publish/packages/runtime/rules.js）生成类型用例，保证“运行时认的属性 = 类型层认的属性”：
//   ALIAS（React 拼写）每个都必须在类型层报错；BOOL 属性每个都必须接受 true / false / 读取函数，并拒绝字符串。
// 用法：node scripts/gen-attr-cases.mjs   → 写 type-cases/generated-attrs.tsx
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { ALIAS, BOOL, KIND_MASK, TABLE } = await import(new URL('../../03-publish/packages/runtime/rules.js', import.meta.url).href);

/** 布尔属性 → 能写它的标签（和 hilt/types/html.ts 对照；全局属性用 div） */
const HOST = {
  allowfullscreen: 'iframe', async: 'script', autofocus: 'div', autoplay: 'video', controls: 'video', default: 'track',
  defer: 'script', disabled: 'button', formnovalidate: 'button', hidden: 'div', inert: 'div', ismap: 'img',
  itemscope: 'div', loop: 'video', multiple: 'input type="file"', nomodule: 'script', novalidate: 'form', open: 'details',
  playsinline: 'video', popover: 'div', readonly: 'input', required: 'input', reversed: 'ol',
  webkitdirectory: 'input type="file"', disablepictureinpicture: 'video', disableremoteplayback: 'video',
  checked: 'input type="checkbox"', selected: 'option', muted: 'video',
};
const boolNames = Object.keys(TABLE).filter((name) => typeof TABLE[name] === 'number' && (TABLE[name] & KIND_MASK) === BOOL).concat(['checked', 'selected', 'muted']);
const missing = boolNames.filter((name) => !HOST[name]);
if (missing.length) throw new Error(`HOST 缺少：${missing.join(', ')}`);

const lines = [`// 由 scripts/gen-attr-cases.mjs 从运行时的规则表（03-publish/packages/runtime/rules.js）生成，不要手改。`, `export const Generated = (`, `  <>`];
lines.push('    {/* BOOL 属性：true / false / 读取函数；字符串不收（"false" 是真值，"" 在 JS 里是假值） */}');
for (const name of boolNames) {
  const host = HOST[name];
  lines.push(`    <${host} ${name} />`, `    <${host} ${name}={false} />`, `    <${host} ${name}={() => true} />`);
  lines.push(`    {/* @ts-expect-error "false" 是真值 */}`, `    <${host} ${name}="false" />`);
}
lines.push('    {/* ALIAS（React 拼写）：类型层必须拒绝并指向正确写法 */}');
for (const alias of Object.keys(ALIAS)) {
  lines.push(`    {/* @ts-expect-error ${alias} → ${ALIAS[alias]} */}`, `    <div ${alias}="x" />`);
}
lines.push('  </>', ');', '');
writeFileSync(fileURLToPath(new URL('../type-cases/generated-attrs.tsx', import.meta.url)), lines.join('\n'));
console.log(`BOOL ${boolNames.length} 个，ALIAS ${Object.keys(ALIAS).length} 个`);
