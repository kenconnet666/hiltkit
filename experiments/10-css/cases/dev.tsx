// 开发体验：可读类名、devtools 里的规则原文、热更新原地生效。DEV 由 define 注入（对照生产）。
import { flushSync, mount } from '@hilt/runtime';
import { configure, create, hotStyles, recipe } from '@hilt/css';

declare const DEV: boolean;
configure({ dev: DEV });

const styles = create({ root: { color: 'rgb(1, 0, 0)' } });
const button = recipe({
  name: 'Button',
  parts: ['root'],
  base: { root: { color: 'rgb(2, 0, 0)' } },
  variants: { size: { sm: { root: { fontSize: 11 } } } },
});

const App = _component(() => {
  const s = button({ size: 'sm' });
  return (
    <main>
      <div id="a" sx={styles.root} />
      <button id="b" {...s.root} />
    </main>
  );
});

// 模块热更新重新执行时发生的事：hotStyles 按 id 把新声明写进旧对象（编译器在开发模式下包在顶层 create / recipe 外面）
const manual = hotStyles('dev:manual', create({ root: { color: 'rgb(3, 0, 0)' } }, 'Manual.styles'));
const manualRecipe = hotStyles('dev:recipe', recipe({ name: 'Chip', parts: ['root'], base: { root: { color: 'rgb(4, 0, 0)' } } }));

(window as any).api = {
  reloadStyles(color: string) {
    const next = hotStyles('dev:manual', create({ root: { color } }, 'Manual.styles'));
    return next === manual;
  },
  reloadRecipe(color: string) {
    const next = hotStyles('dev:recipe', recipe({ name: 'Chip', parts: ['root'], base: { root: { color } } }));
    return next === manualRecipe;
  },
  styleText: () => document.querySelector('style[data-hilt-css]')!.textContent,
  flushSync,
};

mount(
  () => (
    <>
      <App />
      <div id="m" sx={manual.root} />
      <div id="r" {...manualRecipe().root} />
    </>
  ),
  document.body,
);
