// 生成一个大型组件库：n 个模块，每个模块的规模接近 vue-tsx-pro 的一个普通组件（样式表、配方、组合式函数、部件属性）。
// 每个组件都依赖基础模块 base，组件之间也有依赖，用桶文件 index.ts 导出，模拟真实组件库。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** appImport：应用怎么引用组件。'barrel' 从 ./lib 桶文件（默认，开发期会加载整个库）；'direct' 逐个从组件文件引用；其他字符串当作模块说明符（如别名 '@big/ui'）。
 *  layout：'flat' 所有组件平铺在 src/lib（默认）；'folders' 每个组件一个目录 src/lib/C0001/C0001.tsx（主流组件库的布局） */
export function generate(dir, count, { layout = 'flat', appImport = 'barrel' } = {}) {
  rmSync(dir, { recursive: true, force: true });
  const lib = join(dir, 'src/lib');
  mkdirSync(lib, { recursive: true });

  writeFileSync(
    join(lib, 'base.tsx'),
    `import { createContext, inject, provide, useStyleEngine } from '@hilt/runtime';
import { css, recipe } from '@hilt/css';

useStyleEngine(css.attrs);

export const baseStyles = css.create({
  root: { boxSizing: 'border-box', margin: 0 },
  focus: { outlineColor: { default: 'transparent', ':focus-visible': 'rgb(0, 0, 255)' } },
});
export const ThemeContext = createContext('light');
export const Provider = _component(({ theme, children }) => {
  provide(ThemeContext, { theme });
  return <div class="provider">{children}</div>;
});
export function useAppearance(options) {
  const theme = inject(ThemeContext);
  const size = _derived(options.size ?? 'md');
  const tone = _derived(options.tone ?? 'accent');
  return { size, tone, theme };
}
export function usePresence(options) {
  let visible = _state(false);
  _effect(() => {
    visible = !!options.open;
  });
  return { visible };
}
export const Part = _component(({ children, ...rest }) => <span class="part" {...rest}>{children}</span>);
`,
  );

  const names = [];
  const folders = layout === 'folders';
  const fileOf = (name) => (folders ? join(lib, name, `${name}.tsx`) : join(lib, `${name}.tsx`));
  // 组件引用兄弟组件、桶文件引用组件时的相对路径
  const siblingPath = (name) => (folders ? `../${name}/${name}` : `./${name}`);
  const barrelPath = (name) => (folders ? `./${name}/${name}` : `./${name}`);
  for (let i = 0; i < count; i++) {
    const name = `C${String(i).padStart(4, '0')}`;
    names.push(name);
    // 一部分组件依赖前面的组件，形成真实的依赖深度
    const dep = i > 0 && i % 3 === 0 ? `C${String(i - 1).padStart(4, '0')}` : undefined;
    if (folders) mkdirSync(join(lib, name), { recursive: true });
    writeFileSync(
      fileOf(name),
      `import { css, recipe } from '@hilt/css';
import { baseStyles, Part, useAppearance, usePresence } from '${folders ? '../base' : './base'}';
${dep ? `import { ${dep} } from '${siblingPath(dep)}';\n` : ''}
const styles = css.create({
  root: { display: 'inline-flex', gap: '${i % 16}px', alignItems: 'center', padding: '4px', color: 'rgb(${i % 255}, 0, 0)' },
  active: { fontWeight: 600, borderColor: { default: 'transparent', ':hover': 'rgb(0, 0, 0)' } },
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
  content: { display: 'inline-flex', minWidth: 0 },
  icon: { width: '1em', height: '1em', flexShrink: 0 },
  width: (width) => ({ width }),
});
const ${name.toLowerCase()}Recipe = recipe({
  name: '${name}',
  parts: ['root', 'icon'],
  variants: {
    size: { sm: { root: { fontSize: '12px' } }, md: { root: { fontSize: '14px' } } },
    tone: { accent: { root: { backgroundColor: 'rgb(240, 240, 255)' } }, danger: { root: { backgroundColor: 'rgb(255, 240, 240)' } } },
  },
  compound: [{ when: { size: 'sm', tone: 'danger' }, root: { fontWeight: 700 } }],
});

export const ${name} = _component(({ size, tone, open = false, disabled = false, active = false, width, label = '${name}', icon, propsIcon, propsContent, children, ...rest }) => {
  const appearance = useAppearance({ size, tone });
  const presence = usePresence({ open });
  let hits = _state(0);
  const doubled = _derived(hits * 2);
  const s = _derived(${name.toLowerCase()}Recipe({ size: appearance.size, tone: appearance.tone }));
  return (
    <div
      data-scope="${name.toLowerCase()}"
      data-part="root"
      sx={[baseStyles.root, styles.root, s.root, active && styles.active, disabled && styles.disabled, width && styles.width(width)]}
      {...rest}
      aria-disabled={disabled ? 'true' : undefined}
      data-hits={doubled}
      onClick={(event) => {
        if (disabled) event.preventDefault();
        else hits++;
      }}
    >
      {icon && <Part sx={styles.icon} {...propsIcon}>{icon}</Part>}
      <span sx={styles.content} {...propsContent}>{label}{children}</span>
      {presence.visible && <Part>打开</Part>}
${dep ? `      {open && <${dep} label="嵌套" />}\n` : ''}    </div>
  );
});
`,
    );
  }

  writeFileSync(join(lib, 'index.ts'), `export * from './base';\n${names.map((name) => `export * from '${barrelPath(name)}';`).join('\n')}\n`);

  const used = names.filter((_, index) => index % Math.max(1, Math.floor(count / 10)) === 0).slice(0, 10);
  writeFileSync(
    join(dir, 'src/App.tsx'),
    `${appImport === 'direct' ? used.map((name) => `import { ${name} } from '${barrelPath(name).replace('./', './lib/')}';`).join('\n') : `import { ${used.join(', ')} } from '${appImport === 'barrel' ? './lib' : appImport}';`}

export const App = _component(() => {
  let count = _state(0);
  window.__app = { get count() { return count; }, inc: () => count++ };
  return (
    <main id="app-root" data-count={count}>
      <p id="app-text">应用文字</p>
${used.map((name) => `      <${name} id="${name}" />`).join('\n')}
    </main>
  );
});
`,
  );
  writeFileSync(
    join(dir, 'src/main.tsx'),
    `import { mount } from '@hilt/runtime';
import { App } from './App';

mount(() => <App />, document.getElementById('app'));
`,
  );
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  return { used, names, lib, fileOf };
}
