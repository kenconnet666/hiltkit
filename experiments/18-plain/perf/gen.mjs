// 生成 N 个“零编译”写法的组件 + 两套类型的 tsconfig，供 run.mjs / lsp.mjs 量成本。
// 用法：node perf/gen.mjs <组件数> [输出目录，默认 perf/out/<N>]
// 每个组件：create（静态 + 动态 + 条件 + token）、recipe（3 个档位 + 组合档位 + 默认值，档位传读取函数）、HtmlProps 转发 rest、
// SvgProps 展开到 <svg>、sig / derived / effect / model、事件、class / style、value 绑定、For 列表、sx 数组（含函数）。
// 使用方：每个组件用一次。变体：
//   typed = 当前 hilt/ 下的完整类型；
//   loose = 完整类型之前的快照（perf/loose-types：元素属性是小子集、sx 是 unknown、create / recipe 返回 any），同一份组件源码。
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2] ?? 300);
const out = resolve(process.argv[3] ?? `${root}/perf/out/${N}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/src`, { recursive: true });

// ---- 主题：规模接近真实组件库（约 70 个 token，15 组里用到 11 组），同 15-types/perf/gen.mjs ----
export const THEME = {
  colors: 'text textMuted textDisabled accent accentHover accentText bg bgMuted bgHover border borderStrong fill fillHover danger dangerText success warning info overlay focus link linkHover inverse inverseText'.split(' '),
  space: 'none xxs xs sm md lg xl xxl'.split(' '),
  fontSizes: 'xs sm md lg xl xxl'.split(' '),
  radii: 'none sm md lg full'.split(' '),
  sizes: 'controlSm controlMd controlLg icon sidebar'.split(' '),
  shadows: 'sm md lg'.split(' '),
  durations: 'fast normal slow'.split(' '),
  fontWeights: 'regular medium bold'.split(' '),
  lineHeights: 'tight normal loose'.split(' '),
  borderWidths: 'thin thick'.split(' '),
  opacities: 'disabled hover'.split(' '),
};
const groupsSource = Object.entries(THEME)
  .map(([group, names]) => `  ${group}: { ${names.map((name, i) => `${name}: '${group === 'colors' ? `#${(i * 977 + 4096).toString(16).slice(0, 6).padStart(6, '0')}` : `${i + 1}px`}'`).join(', ')} },`)
  .join('\n');
const themeTyped = `import { defineConditions, defineTokens } from 'hilt/css';

export const t = defineTokens('bench', {
${groupsSource}
});
export const aliases = { _loading: '[data-loading]', _md: '@media (min-width: 700px)', _wide: '@container (min-width: 400px)', _busy: '[aria-busy="true"]' } as const;
defineConditions(aliases);

declare module 'hilt/css' {
  interface TokenSets { bench: typeof t }
  interface ConditionSets { app: typeof aliases }
}
`;
// loose 没有 defineTokens / 登记处：主题文件是空的，样式里的 '_md' 什么也不查
writeFileSync(`${out}/src/theme.ts`, themeTyped);
writeFileSync(`${out}/src/theme.loose.ts`, 'export {};\n');

const TAGS = ['button', 'div', 'section', 'a', 'label'];

const component = (i) => {
  const tag = TAGS[i % TAGS.length];
  return `import { derived, effect, For, merge, model, read, sig, type Child, type Model, type Prop } from 'hilt';
import { create, recipe } from 'hilt/css';
import type { HtmlProps, SvgProps } from 'hilt/jsx-runtime';
import './theme';

const styles = create({
  root: { display: 'flex', padding: '_md', color: { default: '_text', ':hover': '_accent', _disabled: '_textDisabled' }, gap: '_sm', borderRadius: '_md', minHeight: '_controlMd' },
  label: { fontSize: '_sm', color: '_textMuted', marginBlock: '_xs', fontWeight: '_medium', lineHeight: '_tight' },
  active: { backgroundColor: '_accent', color: { default: '_accentText', _hover: '_inverseText' }, boxShadow: '_md', transitionDuration: '_fast' },
  list: { listStyle: 'none', margin: 0, paddingInline: { default: '_md', '@media (min-width: 600px)': '_lg', _md: '_xl' }, opacity: { default: 1, _loading: '_disabled' } },
  bar: (w: number) => ({ width: w, height: 4, '--bar-${i}': w }),
});

const recipe${i} = recipe({
  name: 'Comp${i}',
  parts: ['root', 'icon', 'label'],
  base: { root: { display: 'inline-flex', alignItems: 'center', border: '1px solid red' }, label: { fontWeight: 600 } },
  variants: {
    size: { sm: { root: { fontSize: '_sm', paddingInline: '_sm' } }, md: { root: { fontSize: '_md', paddingInline: '_md' } }, lg: { root: { fontSize: '_lg', paddingInline: '_lg' }, icon: { width: '_icon' } } },
    tone: { neutral: { root: { color: '_text', borderColor: '_border' } }, accent: { root: { color: '_accent', backgroundColor: '_fill' } }, danger: { root: { color: '_danger' } } },
    block: { true: { root: { display: 'flex' } }, false: {} },
  },
  compound: [{ when: { size: 'lg', tone: 'accent' }, root: { borderRadius: '_full' } }],
  defaults: { size: 'md', tone: 'neutral' },
});

export interface Comp${i}Props extends Omit<HtmlProps<'${tag}'>, 'role' | 'aria-busy'> {
  size?: Prop<'sm' | 'md' | 'lg'>;
  tone?: Prop<'neutral' | 'accent' | 'danger'>;
  block?: Prop<boolean>;
  loading?: Prop<boolean>;
  label?: Prop<string>;
  value?: Model<string>;
  items?: Prop<readonly { id: number; text: string }[]>;
  icon?: Child;
  iconProps?: Prop<SvgProps<'svg'>>;
}

export function Comp${i}({ size, tone, block, loading, label, value, items = [], icon, iconProps, children, ...rest }: Comp${i}Props) {
  const count = sig(${i % 7});
  const open = sig(false);
  const text = model(value, '');
  const doubled = derived(() => count() * 2);
  const title = derived(() => (open() ? read(label) ?? 'open' : String(doubled())));
  effect(() => {
    document.title = title();
    return () => {};
  });
  const s = recipe${i}({ size, tone, block });
  return (
    <${tag} {...merge(s.root, rest)} role="group" aria-busy={() => (read(loading) ? 'true' : undefined)} sx={[styles.root, () => open() && styles.active, () => styles.bar(count()), { marginTop: '_md' }]}>
      <span {...s.label} sx={[styles.label]} onClick={(e) => e.currentTarget.id}>
        {label}
      </span>
      {icon}
      <svg {...s.icon} viewBox="0 0 8 8" stroke-width={() => count()}><path d="M0 0" /></svg>
      <input type="text" value={text} onInput={(e) => count.set(e.currentTarget.value.length)} class={['f', { on: open }]} />
      <details open={open}><summary>{title}</summary>{children}</details>
      <button type="button" sx={{ marginTop: '_md', color: { default: '_text', _selected: '_accent' } }} onClick={() => { count.inc(); open.toggle(); }} aria-pressed={() => (open() ? 'true' : 'false')} style={{ width: '10px' }}>
        {count}
      </button>
      <ul sx={styles.list}>
        <For each={items} by={(item) => item.id}>{(item, index) => <li sx={[styles.label]}>{() => item().text}{index}</li>}</For>
      </ul>
    </${tag}>
  );
}
`;
};

const names = Array.from({ length: N }, (_, i) => i);
const pad = (i) => String(i).padStart(4, '0');
for (const i of names) writeFileSync(`${out}/src/c${pad(i)}.tsx`, component(i));

// 使用方：每 100 个组件一个文件（跨文件解析泛型、联合、转发属性、sx）
for (let part = 0; part * 100 < N; part++) {
  const slice = names.slice(part * 100, part * 100 + 100);
  writeFileSync(
    `${out}/src/app${part}.tsx`,
    `import { sig } from 'hilt';
${slice.map((i) => `import { Comp${i} } from './c${pad(i)}';`).join('\n')}

export function App${part}() {
  const v = sig('');
  return (
    <main>
${slice.map((i) => `      <Comp${i} size="sm" tone="accent" value={v} items={[{ id: ${i}, text: 'a' }]} sx={[{ margin: '_md' }]} onClick={(e) => e.currentTarget.id}>x</Comp${i}>`).join('\n')}
    </main>
  );
}
`,
  );
}
if (N === 0) writeFileSync(`${out}/src/app0.tsx`, 'export const App0 = 1;\n');

// LSP 探针：光标位置用 ⟦名字⟧ 标出，lsp.mjs 读入时去掉标记并记下位置。不参与 tsc 的计时（tsconfig 里 exclude）
writeFileSync(
  `${out}/src/probe.tsx`,
  `import { create } from 'hilt/css';
import './theme';
import { Comp0 } from './c0000';

const styles = create({
  root: { padding: '_md', color: '_text', fontSize: '_sm' },
});

export function Probe() {
  const s = styles;
  return (
    <div sx={[s.root, { padding: '⟦sx-padding⟧' }]} onClick={(e) => e.currentTarget.id}>
      <span sx={{ color: { default: '_text', ⟦cond-key⟧ } }} />
      <span sx={{ color: { default: '⟦sx-color⟧' } }} />
      <span sx={{ display: '⟦sx-display⟧' }} />
      <Comp0 size="sm" ⟦comp-prop⟧ />
      <div ⟦attr⟧ />
      <div onC⟦event⟧ />
      <div ⟦hover-target⟧id="x" class="a" onClick={() => {}} />
      <div ⟦hover-sx⟧sx={[s.root]} />
    </div>
  );
}
`,
);

// ---- 变体：typed 用真实的 hilt/，loose 用一份拷贝（index.ts 照抄，jsx-runtime.ts、css.ts 换成快照）----
const hiltRoot = resolve(root, 'hilt');
const looseHilt = `${out}/loose-hilt`;
mkdirSync(looseHilt, { recursive: true });
for (const file of ['index.ts', 'server.ts']) cpSync(`${hiltRoot}/${file}`, `${looseHilt}/${file}`);
// 快照补两处，让同一份组件源码能编译：导出 SvgProps，TagAttrs 里加 details 的 open（旧类型没有）
const looseRuntime = readFileSync(`${root}/perf/loose-types/jsx-runtime.ts`, 'utf8')
  .replace('interface TagAttrs {', 'interface TagAttrs {\n  details: { open?: Attr<boolean | undefined> };')
  .concat('\nexport type SvgProps<K extends keyof SVGElementTagNameMap> = SvgElements[K];\n');
writeFileSync(`${looseHilt}/jsx-runtime.ts`, looseRuntime);
// 旧 css.ts 登记 sx 的入口已改名（registerSxPrepare → registerStyles）：快照里跟着改，其余原样
writeFileSync(
  `${looseHilt}/css.ts`,
  readFileSync(`${root}/perf/loose-types/css.ts`, 'utf8').replace('registerSxPrepare', 'registerStyles').replace('registerSxPrepare(prepare)', 'registerStyles({ prepare, onHydrate() {} })'),
);
// 内核声明：当前的 kernel.d.ts，把 @hilt/css 那一段换成快照里的宽松声明
const kernel = readFileSync(`${root}/kernel.d.ts`, 'utf8');
const looseKernel = readFileSync(`${root}/perf/loose-types/kernel.d.ts`, 'utf8');
// loose 的 defineTokens / defineConditions 也是 any / void：主题文件两个变体共用，只是 loose 里登记处不存在，'_md' 什么也不查
const looseExtra = '  export const defineTokens: (prefix: string, groups: object) => any;\n  export const defineConditions: (aliases: object) => void;\n}\n';
const cssBlock = (text) => text.slice(text.indexOf("declare module '@hilt/css' {")).replace(/\}\s*$/, looseExtra);
writeFileSync(`${out}/kernel.loose.d.ts`, kernel.slice(0, kernel.indexOf("// 样式引擎。签名在")) + cssBlock(looseKernel));
writeFileSync(`${out}/kernel.typed.d.ts`, kernel.replace(/\.\/hilt\/types/g, relative(out, `${hiltRoot}/types`).replaceAll('\\', '/')));

const rel = (path) => relative(out, resolve(root, path)).replaceAll('\\', '/');
const base = {
  target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2023', 'DOM', 'DOM.Iterable'],
  strict: true, noEmit: true, skipLibCheck: true, noUncheckedIndexedAccess: true, types: [], jsx: 'react-jsx', jsxImportSource: 'hilt',
};
const variants = {
  typed: { hilt: rel('hilt'), kernel: 'kernel.typed.d.ts' },
  loose: { hilt: './loose-hilt', kernel: 'kernel.loose.d.ts' },
};
for (const [name, v] of Object.entries(variants)) {
  writeFileSync(
    `${out}/tsconfig.${name}.json`,
    JSON.stringify(
      {
        compilerOptions: {
          ...base,
          paths: {
            csstype: [rel('../13-ts/node_modules/csstype/index.d.ts')],
            hilt: [`${v.hilt}/index.ts`],
            'hilt/jsx-runtime': [`${v.hilt}/jsx-runtime.ts`],
            'hilt/css': [`${v.hilt}/css.ts`],
          },
        },
        include: [v.kernel, 'src/**/*'],
        exclude: ['src/probe.tsx'],
      },
      null,
      2,
    ),
  );
}
console.log(`生成 ${N} 个组件 -> ${out}；变体：${Object.keys(variants).join(', ')}`);
