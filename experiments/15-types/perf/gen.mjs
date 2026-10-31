// 生成 N 个使用类型层的组件 + 各类型变体的 tsconfig，供 run.mjs / lsp.mjs 量成本。
// 用法：node perf/gen.mjs <组件数> [输出目录，默认 perf/out/<N>]
// 每个组件：create（静态 + 动态样式、条件、token）、recipe（3 个档位 + 组合档位）、HtmlProps 转发 rest、
// _bindable、_state/_derived/_effect、事件、列表、SVG 图标；app 文件里把每个组件用一遍（含 _bind、sx）。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIANTS, writeVariantFiles } from './variants.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2] ?? 300);
const out = resolve(process.argv[3] ?? `${root}/perf/out/${N}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/src`, { recursive: true });

// ---- 主题：规模接近真实组件库（约 70 个 token，15 组里用到 11 组）----
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
writeFileSync(
  `${out}/src/theme.ts`,
  `import { defineConditions, defineTokens } from '@hilt/css';

export const t = defineTokens('bench', {
${groupsSource}
});
export const conditions = defineConditions({ _loading: '[data-loading]', _md: '@media (min-width: 700px)', _wide: '@container (min-width: 400px)', _busy: '[aria-busy="true"]' });

declare module '@hilt/css' {
  interface TokenSets { bench: typeof t }
  interface ConditionSets { app: typeof conditions }
}
`,
);

const TAGS = ['button', 'div', 'section', 'a', 'label'];
const ELEMENT_FOR = { button: 'HTMLButtonElement', div: 'HTMLDivElement', section: 'HTMLElement', a: 'HTMLAnchorElement', label: 'HTMLLabelElement' };

const component = (i) => {
  const tag = TAGS[i % TAGS.length];
  return `import { For, type BindableProps, type HtmlProps, type JsxElement, type SvgProps } from '@hilt/runtime';
import { create, recipe } from '@hilt/css';
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

export interface Comp${i}Props extends HtmlProps<'${tag}', 'role' | 'aria-busy'>, BindableProps<{ value: string }> {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neutral' | 'accent' | 'danger';
  block?: boolean;
  loading?: boolean;
  label?: string;
  items?: readonly { id: number; text: string }[];
  icon?: JsxElement;
  iconProps?: SvgProps<'svg', 'children'>;
}

export const Comp${i} = _component<Comp${i}Props>(
  ({ size, tone, block, loading, label, items = [], icon, iconProps, value = _bindable(''), children, ...rest }) => {
    let count = _state(${i % 7});
    let open = _state(false);
    const doubled = _derived(count * 2);
    const text = _derived.by(() => (open ? label ?? 'open' : String(doubled)));
    _effect(() => {
      document.title = text;
      return () => {};
    });
    const s = recipe${i}({ size, tone, block });
    return (
      <${tag} {...s.root} {...rest} role="group" aria-busy={loading ? 'true' : undefined} sx={[styles.root, open && styles.active, styles.bar(count), { marginTop: '_md' }]}>
        <span {...s.label} sx={[styles.label]} onClick={(e) => e.currentTarget.id}>
          {label}
        </span>
        {icon}
        <svg {...iconProps} {...s.icon} viewBox="0 0 8 8"><path d="M0 0" /></svg>
        <input type="text" value={_bind(value)} onInput={(e) => (count = e.currentTarget.value.length)} class={['f', { on: open }]} />
        <details open={_bind(open)}><summary>{text}</summary>{children}</details>
        <button type="button" sx={{ marginTop: '_md', color: { default: '_text', _selected: '_accent' } }} onClick={() => { count++; open = !open; }} aria-pressed={open ? 'true' : 'false'} style={{ width: '10px' }}>
          {count}
        </button>
        <ul sx={styles.list}>
          <For each={items}>{(item, index) => <li key={item.id} sx={[styles.label]}>{item.text}{index}</li>}</For>
        </ul>
        {items.map((item) => <i key={item.id}>{item.text}</i>)}
      </${tag}>
    );
  },
);
`;
};

const names = Array.from({ length: N }, (_, i) => i);
const pad = (i) => String(i).padStart(4, '0');
for (const i of names) writeFileSync(`${out}/src/c${pad(i)}.tsx`, component(i));

// 使用方：每 100 个组件一个文件（跨文件解析泛型、联合、受管属性、_bind、sx）
for (let part = 0; part * 100 < N; part++) {
  const slice = names.slice(part * 100, part * 100 + 100);
  writeFileSync(
    `${out}/src/app${part}.tsx`,
    `${slice.map((i) => `import { Comp${i} } from './c${pad(i)}';`).join('\n')}

export const App${part} = _component<{}>(() => {
  let v = _state('');
  return (
    <main>
${slice.map((i) => `      <Comp${i} size="sm" tone="accent" value={_bind(v)} onValueChange={(next) => next.length} items={[{ id: ${i}, text: 'a' }]} sx={[{ margin: '_md' }]} onClick={(e) => e.currentTarget.id}>x</Comp${i}>`).join('\n')}
    </main>
  );
});
`,
  );
}
if (N === 0) writeFileSync(`${out}/src/app0.tsx`, 'export const App0 = 1;\n');

// LSP 探针：光标位置用 ⟦名字⟧ 标出，lsp.mjs 读入时去掉标记并记下位置。不参与 tsc 的计时（tsconfig 里 exclude）
writeFileSync(
  `${out}/src/probe.tsx`,
  `import { create } from '@hilt/css';
import './theme';
import { Comp0 } from './c0000';

const styles = create({
  root: { padding: '_md', color: '_text', fontSize: '_sm' },
});

export const Probe = _component<{}>(() => {
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
});
`,
);

writeVariantFiles(out, THEME);
for (const [name, def] of Object.entries(VARIANTS)) {
  // tree：相对 15-types 的目录，或 variant:xxx（本次生成目录 variants/ 下的类型树）
  const treeRel = def.tree?.startsWith('variant:') ? `./variants/${def.tree.slice(8)}` : undefined;
  const tree = def.tree ?? 'types';
  const rel = (path) => (treeRel && path.startsWith(tree) ? `${treeRel}${path.slice(tree.length)}` : relative(out, resolve(root, path)).replaceAll('\\', '/'));
  const paths = {
    csstype: [rel('../13-ts/node_modules/csstype/index.d.ts')],
    '@hilt/runtime': [rel(`${tree}/index.d.ts`)],
    '@hilt/runtime/*': [rel(`${tree}/*`)],
    '@hilt/css': [rel(`${tree}/css/index.d.ts`)],
    '@hilt/css/*': [rel(`${tree}/css/*`)],
  };
  for (const [specifier, target] of Object.entries(def.paths ?? {})) paths[specifier] = [target.startsWith('variant:') ? `./variants/${target.slice(8)}` : rel(target)];
  writeFileSync(
    `${out}/tsconfig.${name}.json`,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          strict: true, noEmit: true, skipLibCheck: false, types: [], jsx: 'react-jsx', jsxImportSource: '@hilt/runtime', paths,
        },
        include: ['src/**/*', rel(`${tree}/runes.d.ts`)],
        exclude: ['src/probe.tsx'],
      },
      null,
      2,
    ),
  );
}
console.log(`生成 ${N} 个组件 -> ${out}；变体：${Object.keys(VARIANTS).join(', ')}`);
