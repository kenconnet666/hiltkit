// 第 8 条：生成 N 个组件文件 + 各类型变体的 tsconfig，再用 run.mjs 跑 tsc --extendedDiagnostics。
// 用法：node perf/gen.mjs [组件数，默认 300]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const N = Number(process.argv[2] ?? 300);
const out = 'perf/out';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/src`, { recursive: true });
mkdirSync(`${out}/types-csstype`, { recursive: true });

/** 每个组件：props 接口（继承 PartProps + Bindable）、静态/动态样式、recipe、状态符文、几个原生元素 */
const component = (i) => `import { css, For, type JSX, type PartProps, type Bindable } from 'exp06';

const styles = css.create({
  root: { display: 'flex', padding: '_md', color: { default: '_text', ':hover': '_accent', _disabled: '_textDisabled' }, gap: '_sm' },
  label: { fontSize: '_sm', color: '_text', marginBlock: '_xs', borderRadius: '_md' },
  active: { backgroundColor: '_accent', color: { default: '_bg', _hover: '_text' } },
  list: { listStyle: 'none', margin: 0, paddingInline: { default: '_md', '@media (min-width: 600px)': '_lg' } },
});
const dynamic = css.create({ bar: (w: string) => ({ width: w, height: '4px' }) });

const recipe = css.recipe({
  name: 'Comp${i}',
  parts: ['root', 'icon', 'label'],
  base: { root: { display: 'inline-flex', alignItems: 'center' }, label: { fontWeight: 600 } },
  variants: {
    size: { sm: { root: { fontSize: '_sm' } }, md: { root: { fontSize: '_md' } }, lg: { root: { fontSize: '_lg' } } },
    tone: { neutral: { root: { color: '_text' } }, accent: { root: { color: '_accent' } } },
    block: { true: { root: { display: 'flex' } }, false: {} },
  },
  defaults: { size: 'md', tone: 'neutral' },
});

export interface Comp${i}Props extends PartProps<'div', 'role' | 'aria-busy'>, Bindable<'value', string> {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neutral' | 'accent';
  block?: boolean;
  loading?: boolean;
  label?: string;
  items?: readonly { id: number; text: string }[];
  icon?: JSX.Element;
  propsIcon?: PartProps<'svg', 'children'>;
}

export const Comp${i} = _component(
  ({ size, tone, block, loading, label, items = [], icon, propsIcon, _value: value = _bindable(''), onValueChange, children, ...rest }: Comp${i}Props) => {
    let count = _state(${i % 7});
    let open = _state(false);
    const doubled = _derived(count * 2);
    const text = _derived.by(() => (open ? label ?? 'open' : String(doubled)));
    _effect(() => {
      document.title = text;
      return () => {};
    });
    const s = recipe({ size, tone, block });
    return (
      <div {...s.root} {...rest} role="group" aria-busy={loading ? 'true' : undefined} sx={[styles.root, open && styles.active, dynamic.bar(count + 'px')]}>
        <span {...s.label} sx={[styles.label]} onClick={(e) => e.currentTarget.id}>
          {label}
        </span>
        {icon}
        <svg {...propsIcon} {...s.icon} viewBox="0 0 8 8"><path d="M0 0" /></svg>
        <input type="text" _value={value} onInput={(e) => (count = e.currentTarget.value.length)} />
        <details _open={open}><summary>{text}</summary>{children}</details>
        <button type="button" sx={{ marginTop: '_md' }} onClick={() => { count++; open = !open; }} aria-pressed={open ? 'true' : 'false'}>
          {count}
        </button>
        <ul sx={styles.list}>
          <For each={items}>{(item, i) => <li key={item.id} sx={[styles.label]}>{item.text}{i}</li>}</For>
        </ul>
        {items.map((item) => <i key={item.id}>{item.text}</i>)}
      </div>
    );
  },
);
`;

const names = [];
for (let i = 0; i < N; i++) {
  writeFileSync(`${out}/src/c${String(i).padStart(3, '0')}.tsx`, component(i));
  names.push(i);
}
// 使用方：一个文件里把每个组件用一遍（跨文件解析泛型、联合、受管属性）
const app = `${names.map((i) => `import { Comp${i} } from './c${String(i).padStart(3, '0')}';`).join('\n')}

export const App = _component<{}>(() => {
  let v = _state('');
  return (
    <main>
${names.map((i) => `      <Comp${i} size="sm" _value={v} onValueChange={(next) => next.length} items={[{ id: ${i}, text: 'a' }]} sx={[{ margin: '_md' }]}>x</Comp${i}>`).join('\n')}
    </main>
  );
});
`;
writeFileSync(`${out}/src/app.tsx`, app);
if (N === 0) writeFileSync(`${out}/src/app.tsx`, 'export const App = 1;\n');

// csstype 版样式：把 StyleObject / LooseStyleObject 换成 csstype 原样（没有 token、条件取值）
let full = readFileSync('types/styles.d.ts', 'utf8');
const patched = full
  // 去掉 token 与 Strict，保留条件取值：只量“token 校验”这一层的代价
  .replace(/export type StyleObject = \{[\s\S]*?\n\};/, 'export type StyleObject = { readonly [K in keyof RawProps]?: StyleValue<Exclude<RawProps[K], undefined>> };')
  .replace("import type { TokenGroups } from 'exp06/tokens';", '');
if (patched === full || !patched.includes('StyleValue<Exclude<RawProps[K], undefined>> };')) throw new Error('csstype 变体替换失败');
// TokenOf 等仍被引用的类型保留，但需要 TokenGroups：给个空壳
writeFileSync(`${out}/types-csstype/styles.d.ts`, `interface TokenGroups { space: never; colors: never; fontSizes: never; radii: never }\n` + patched);

const variants = {
  'full': { elements: '../../types/elements.d.ts', styles: '../../types/styles.d.ts' },
  'simple-elements': { elements: '../../types-simple/elements.d.ts', styles: '../../types/styles.d.ts' },
  'no-token-styles': { elements: '../../types/elements.d.ts', styles: './types-csstype/styles.d.ts' },
  'simple-styles': { elements: '../../types/elements.d.ts', styles: '../../types-simple/styles.d.ts' },
  'simple-both': { elements: '../../types-simple/elements.d.ts', styles: '../../types-simple/styles.d.ts' },
};
for (const [name, v] of Object.entries(variants)) {
  writeFileSync(
    `${out}/tsconfig.${name}.json`,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          strict: true, noEmit: true, skipLibCheck: false, types: [], jsx: 'react-jsx', jsxImportSource: 'exp06',
          paths: {
            exp06: ['../../types/index.d.ts'],
            'exp06/elements': [v.elements],
            'exp06/styles': [v.styles],
            'exp06/*': ['../../types/*'],
          },
        },
        include: ['src/**/*', '../../types/runes.d.ts'],
      },
      null,
      2,
    ),
  );
}
console.log(`生成 ${N} 个组件 + app.tsx；变体：${Object.keys(variants).join(', ')}`);
