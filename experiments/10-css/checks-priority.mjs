// 样式优先级：node 10-css/run.mjs --only=priority
// 引擎的组合类与使用方的全局 CSS、Tailwind 风格的层互相覆盖，三种写法（plain / :where / @layer）各量一遍
import { openPage } from '../lib/browser.mjs';
import { bundle, here } from './lib.mjs';

const PURPLE = 'rgb(128, 0, 128)';
const MODES = ['plain', 'where', 'layer-alone', 'layer-ordered'];
const LABEL = {
  plain: '`.c`（默认，.c.c 抬特异性）',
  where: '`:where(.c)`',
  'layer-alone': '`@layer vtp`（不声明层顺序）',
  'layer-ordered': '`@layer components` + 引擎声明 `theme, base, components, utilities`',
};
const ROWS = [
  ['flat-base', '使用方单类选择器 vs 组件基础色', 'user'],
  ['flat-media', '使用方单类选择器 vs 组件 @media 里的色（视口 1200）', 'user'],
  ['flat-hover', '使用方单类选择器 vs 组件 :hover 色（悬停时）', 'user'],
  ['nested-media', '使用方 `.card .x`（特异性 0,2,0）vs 组件 @media 色', 'user'],
  ['tw-base', 'Tailwind v4 工具类（@layer utilities）vs 组件基础色', 'user'],
  ['tw-media', 'Tailwind v4 工具类（@layer utilities）vs 组件 @media 色', 'user'],
  ['preflight', 'Tailwind preflight（@layer base：button{padding:0}）vs 组件 padding 8px', 'component'],
];

export async function run({ browser, check }) {
  console.log('## 样式优先级：使用方 CSS / Tailwind 怎么覆盖组件\n');
  const result = {};
  for (const mode of MODES) {
    const code = await bundle(here('./cases/priority.ts'), { minify: false, define: { MODE: JSON.stringify(mode) } });
    const page = await openPage(browser, code);
    const read = async (id) => {
      const color = await page.evaluate((i) => getComputedStyle(document.getElementById(i)).color, id);
      const padding = await page.evaluate((i) => getComputedStyle(document.getElementById(i)).paddingTop, id);
      return { color, padding };
    };
    const outcome = {};
    for (const [id, , ] of ROWS) {
      if (id === 'flat-hover') {
        await page.hover('#flat-hover');
        outcome[id] = (await read(id)).color === PURPLE ? 'user' : 'component';
        await page.mouse.move(900, 800);
      } else if (id === 'preflight') {
        outcome[id] = (await read(id)).padding === '0px' ? 'user' : 'component';
      } else {
        outcome[id] = (await read(id)).color === PURPLE ? 'user' : 'component';
      }
    }
    result[mode] = outcome;
    await page.close();
  }
  const mark = (value, wanted) => (value === wanted ? `${value} ✓` : `${value} ✗`);
  console.log(`| 场景 | ${MODES.map((m) => LABEL[m]).join(' | ')} |`);
  console.log(`| --- | ${MODES.map(() => '---').join(' | ')} |`);
  for (const [id, text, wanted] of ROWS) console.log(`| ${text}（期望 ${wanted} 赢） | ${MODES.map((m) => mark(result[m][id], wanted)).join(' | ')} |`);
  console.log();

  // 期望：plain 下组件的条件块（@media、:hover）会压过使用方单类；:where 与 layer 下使用方总能覆盖
  check('plain：使用方单类能盖过组件的基础值', result.plain['flat-base'] === 'user');
  check('plain：组件的 @media / :hover 条件块压过使用方单类（.c.c 特异性更高）——已知限制', result.plain['flat-media'] === 'component' && result.plain['flat-hover'] === 'component', result.plain);
  check('plain：未分层的组件样式压过 Tailwind 的 @layer utilities', result.plain['tw-base'] === 'component' && result.plain['tw-media'] === 'component', result.plain);
  check('plain：未分层的组件样式压过 preflight（组件的 padding 保住）', result.plain.preflight === 'component', result.plain);
  check(':where：使用方单类在基础、@media、:hover 下都能盖过', result.where['flat-base'] === 'user' && result.where['flat-media'] === 'user' && result.where['flat-hover'] === 'user', result.where);
  check(':where：仍然压过 @layer 里的工具类与 preflight（分层的永远输给未分层的）', result.where['tw-base'] === 'component' && result.where.preflight === 'component', result.where);
  check('layer（声明顺序）：未分层的使用方 CSS 一律赢，Tailwind 工具类赢，preflight 输给组件', MODES.slice(3).every((m) => ['flat-base', 'flat-media', 'flat-hover', 'nested-media', 'tw-base', 'tw-media'].every((id) => result[m][id] === 'user') && result[m].preflight === 'component'), result['layer-ordered']);
  check('layer（不声明顺序）：引擎的层排在最前，Tailwind 的 preflight 反过来压过组件 padding——必须配 layerOrder', result['layer-alone'].preflight === 'user', result['layer-alone']);
}
