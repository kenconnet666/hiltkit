// 消融：对生成的组件库逐项去掉一类写法，看总成本掉多少，定位最贵的类型/写法。
// 用法：node perf/ablate.mjs [组件数=100] [--variant=base] [--only=a,b] [--rounds=3]
//   先 node perf/gen.mjs <N>。每个消融在 perf/out/abl-<name>/ 下复制一份文本变换后的源码（路径深度与 perf/out/<N> 相同，tsconfig 可直接复用）。
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const N = Number(process.argv[2]?.startsWith('--') ? 100 : (process.argv[2] ?? 100));
const variant = arg('variant', 'base');
const rounds = Number(arg('rounds', '3'));
const only = arg('only', '')?.split(',').filter(Boolean);
const source = `${root}/perf/out/${N}`;
const tsc = resolve(root, '../13-ts/node_modules/typescript/bin/tsc');

/** 每个消融：对组件文件（c*.tsx）和使用方文件（app*.tsx）做的文本变换 */
const ABLATIONS = {
  none: {},
  // 样式
  'no-recipe': { component: (s) => s.replace(/const recipe\d+ = recipe\(\{[\s\S]*?\n\}\);\n\n/, '').replace(/const s = recipe\d+\(\{ size, tone, block \}\);/, "const s = { root: {}, label: {}, icon: {} };") },
  'no-create': { component: (s) => s.replace(/const styles = create\(\{[\s\S]*?\n\}\);\n/, 'const styles = { root: undefined, label: undefined, active: undefined, list: undefined, bar: (_: number) => undefined };\n') },
  'no-dynamic-style': { component: (s) => s.replace(/\n  bar: \(w: number\) => .*,\n/, '\n').replace(/ styles\.bar\(count\),/, '') },
  'no-conditions': { component: (s) => s.replace(/color: \{ default: '_text', ':hover': '_accent', _disabled: '_textDisabled' \}/, "color: '_text'").replace(/color: \{ default: '_accentText', _hover: '_inverseText' \}/, "color: '_accentText'").replace(/paddingInline: \{ default: '_md', '@media \(min-width: 600px\)': '_lg', _md: '_xl' \}/, "paddingInline: '_md'").replace(/opacity: \{ default: 1, _loading: '_disabled' \}/, 'opacity: 1').replace(/color: \{ default: '_text', _selected: '_accent' \}/, "color: '_text'") },
  // 元素属性
  'no-html-props': { component: (s) => s.replace(/HtmlProps<'\w+', 'role' \| 'aria-busy'>, /, '').replace(/ \{\.\.\.rest\}/, ''), app: (s) => s.replace(/ onClick=\{\(e\) => e\.currentTarget\.id\}/g, '') },
  'no-html-omit': { component: (s) => s.replace(/HtmlProps<('\w+'), 'role' \| 'aria-busy'>/, 'HtmlProps<$1>').replace(/ role="group" aria-busy=\{loading \? 'true' : undefined\}/, '') },
  'no-svg-props': { component: (s) => s.replace(/iconProps\?: SvgProps<'svg', 'children'>;/, 'iconProps?: {};').replace(/\{\.\.\.iconProps\} /, '') },
  'no-events': { component: (s) => s.replace(/ onClick=\{\(e\) => e\.currentTarget\.id\} onKeyDownCapture=\{\(e\) => e\.key\}/, '').replace(/ onInput=\{\(e\) => \(count = e\.currentTarget\.value\.length\)\}/, '').replace(/ onClick=\{\(\) => \{ count\+\+; open = !open; \}\}/, '') },
  'no-bind': { component: (s) => s.replace(/, BindableProps<\{ value: string \}>/, '').replace(/ value = _bindable\(''\),/, '').replace(/value=\{_bind\(value\)\} /, '').replace(/<details open=\{_bind\(open\)\}>/, '<details>'), app: (s) => s.replace(/ value=\{_bind\(v\)\} onValueChange=\{\(next\) => next\.length\}/g, '') },
  'no-class-style': { component: (s) => s.replace(/ class=\{\['f', \{ on: open \}\]\}/, '').replace(/ style=\{\{ width: '10px' \}\}/, '') },
  'no-list': { component: (s) => s.replace(/<ul sx=\{styles\.list\}>[\s\S]*?<\/ul>\n/, '').replace(/ *\{items\.map[^\n]*\n/, '') },
  'no-app': { drop: (name) => name.startsWith('app') },
  'no-runes-body': { component: (s) => s.replace(/let count = _state[\s\S]*?const s = /, 'let count = 0; let open = false; const doubled = 0; const text = "";\n    const s = ') },
};

const metric = (text, key) => Number(new RegExp(`^${key}:\\s+([\\d.]+)`, 'm').exec(text)?.[1] ?? NaN);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`消融：${N} 个组件，变体 ${variant}，${rounds} 轮中位数（TS 7.1 默认多线程）`);
console.log('| 消融 | 错误 | Check s | 内存 MB | 实例化 | 类型 | 相对 none 的实例化 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
let baseline;
for (const [name, def] of Object.entries(ABLATIONS)) {
  if (only.length && name !== 'none' && !only.includes(name)) continue;
  const dir = `${root}/perf/out/abl-${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/src`, { recursive: true });
  cpSync(`${source}/variants`, `${dir}/variants`, { recursive: true });
  cpSync(`${source}/tsconfig.${variant}.json`, `${dir}/tsconfig.json`);
  for (const file of readdirSync(`${source}/src`)) {
    if (file === 'probe.tsx' || def.drop?.(file)) continue;
    let text = readFileSync(`${source}/src/${file}`, 'utf8');
    if (file.startsWith('c')) text = def.component?.(text) ?? text;
    else if (file.startsWith('app')) text = def.app?.(text) ?? text;
    writeFileSync(`${dir}/src/${file}`, text);
  }
  const runs = [];
  for (let i = 0; i < rounds; i++) {
    const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', `${dir}/tsconfig.json`, '--extendedDiagnostics'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const text = r.stdout + r.stderr;
    runs.push({ errors: (text.match(/error TS\d+/g) ?? []).length, check: metric(text, 'Check time'), memory: metric(text, 'Memory used') / 1024, inst: metric(text, 'Instantiations'), types: metric(text, 'Types'), first: text.match(/.*error TS\d+.*/)?.[0] });
  }
  const inst = median(runs.map((r) => r.inst));
  baseline ??= inst;
  console.log(`| ${name} | ${runs[0].errors} | ${median(runs.map((r) => r.check)).toFixed(2)} | ${median(runs.map((r) => r.memory)).toFixed(0)} | ${inst} | ${median(runs.map((r) => r.types))} | ${((inst / baseline) * 100).toFixed(0)}% |`);
  if (runs[0].errors) console.log(`  首个错误：${runs[0].first?.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
}
