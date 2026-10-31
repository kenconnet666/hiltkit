// 样式优先级：引擎的组合类 vs 使用方的全局 CSS、Tailwind 风格的层。MODE 由 checks-priority.mjs 经 define 注入。
import { configure, create } from '@hilt/css';
import { attrs } from '../engine/attrs';

declare const MODE: 'plain' | 'where' | 'layer-alone' | 'layer-ordered';
if (MODE === 'where') configure({ specificity: 'where' });
if (MODE === 'layer-alone') configure({ layer: 'vtp' });
if (MODE === 'layer-ordered') configure({ layer: 'components', layerOrder: 'theme, base, components, utilities' });

const styles = create({
  base: { color: 'rgb(255, 0, 0)', padding: 8 },
  media: { color: { default: 'rgb(255, 0, 0)', '@media (min-width: 600px)': 'rgb(0, 128, 0)' } },
  hover: { color: { default: 'rgb(255, 0, 0)', ':hover': 'rgb(0, 0, 255)' } },
});

// 使用方的 CSS：后加载，和引擎的表同样在 <head> 里，引擎的表在最前
const user = document.createElement('style');
user.textContent = `
  .u-flat { color: rgb(128, 0, 128); }
  .card .u-nested { color: rgb(128, 0, 128); }
  @layer base { button { padding: 0; } }
  @layer utilities { .tw-purple { color: rgb(128, 0, 128); } }
`;
document.head.append(user);
if (MODE.startsWith('layer')) {
  // Tailwind v4 自己的层顺序声明在引擎的表之后
  user.textContent = '@layer theme, base, components, utilities;' + user.textContent;
}

const make = (id: string, tag: string, style: unknown, extra = '') => {
  const el = document.createElement(tag);
  el.id = id;
  el.textContent = id;
  el.style.display = 'block';
  el.className = `${attrs(style).class} ${extra}`.trim();
  document.body.append(el);
  return el;
};
const card = document.createElement('div');
card.className = 'card';
document.body.append(card);

make('flat-base', 'span', styles.base, 'u-flat');
make('flat-media', 'span', styles.media, 'u-flat');
make('flat-hover', 'span', styles.hover, 'u-flat');
make('tw-base', 'span', styles.base, 'tw-purple');
make('tw-media', 'span', styles.media, 'tw-purple');
make('preflight', 'button', styles.base);
const nested = make('nested-media', 'span', styles.media, 'u-nested');
card.append(nested);
