// sx / class / style 合并的断言：node 10-css/run.mjs --only=sx
import { openPage } from '../lib/browser.mjs';
import { bundle, here } from './lib.mjs';

export async function run({ browser, check }) {
  console.log('## sx、class、style 落到同一个元素\n');
  const code = await bundle(here('./cases/sx.tsx'), { minify: false });
  const page = await openPage(browser, code);
  const flush = () => page.evaluate(() => window.api.flushSync());
  const call = async (name, value) => {
    await page.evaluate(([n, v]) => window.api[n](v), [name, value]);
    await flush();
  };
  const info = (target) =>
    page.evaluate((id) => {
      const el = document.getElementById(id);
      const style = getComputedStyle(el);
      return {
        classes: el.className.split(' ').filter(Boolean),
        padding: style.paddingTop,
        margin: style.marginTop,
        color: style.color,
        width: style.width,
        outlineOffset: style.outlineOffset,
        inline: el.getAttribute('style') ?? '',
      };
    }, target);
  const generated = (classes) => classes.filter((name) => /^x[0-9a-z]+$/.test(name));

  // ---- 合并基本语义 ----
  let plain = await info('plain');
  check('静态 class 跨层拼接，只有一个生成类', ['inner', 'box'].every((c) => plain.classes.includes(c)) && generated(plain.classes).length === 1, plain.classes);
  check('底层样式与上层动态值生效', plain.padding === '4px' && plain.color === 'rgb(255, 0, 0)' && plain.width === '10px', plain);

  // ---- 只换引擎自己的类，不冲掉别人的 ----
  const over0 = await info('over');
  check('使用方的 class 与 sx 都生效', over0.margin === '9px' && over0.classes.includes('u'), over0);
  await page.evaluate(() => {
    // 第三方库、过渡动画加的类
    document.getElementById('over').classList.add('third-party', 'fade-enter-active');
  });
  await call('setHot', true);
  const over1 = await info('over');
  check(
    'sx 变化：引擎的类换了，别人的类（u、box、inner、第三方、过渡）都在',
    over1.color === 'rgb(255, 165, 0)' &&
      ['u', 'box', 'inner', 'third-party', 'fade-enter-active'].every((c) => over1.classes.includes(c)) &&
      generated(over1.classes).join() !== generated(over0.classes).join() &&
      generated(over1.classes).length === 1,
    over1.classes,
  );
  await call('setClass', 'v');
  const over2 = await info('over');
  check(
    'class 变化：只换 u → v，生成类、第三方类不动',
    over2.classes.includes('v') &&
      !over2.classes.includes('u') &&
      ['third-party', 'fade-enter-active', 'box', 'inner'].every((c) => over2.classes.includes(c)) &&
      generated(over2.classes).join() === generated(over1.classes).join(),
    over2.classes,
  );
  await call('setHot', false);
  const over3 = await info('over');
  check('sx 变回：恢复组件颜色，使用方的 v 与第三方类仍在', over3.color === 'rgb(255, 0, 0)' && over3.classes.includes('v') && over3.classes.includes('third-party'), over3);

  const fwd0 = await info('fwd');
  check('props.sx 转进组件自己的 sx 数组：使用方的静态项生效', fwd0.margin === '9px' && fwd0.color === 'rgb(255, 0, 0)', fwd0);
  await call('setHot', true);
  const fwd1 = await info('fwd');
  check('props.sx 里使用方的动态项（hot && …）变化也能传过来', fwd1.color === 'rgb(255, 165, 0)', fwd1);
  await call('setHot', false);

  // ---- style ----
  let styled = await info('styled');
  check('使用方 style 与引擎变量并存', styled.color === 'rgb(1, 2, 3)' && styled.width === '20px', styled);
  await page.evaluate(() => document.getElementById('styled').style.setProperty('outline-width', '5px')); // 第三方行内样式
  await call('setWidth', '77px');
  await call('setUserStyle', { color: 'rgb(9, 9, 9)', letterSpacing: '2px' });
  styled = await info('styled');
  check(
    '改使用方 style：引擎变量、第三方行内样式都在',
    styled.color === 'rgb(9, 9, 9)' && styled.inline.includes('outline-width') && styled.inline.includes('--x-width') && styled.inline.includes('letter-spacing'),
    styled,
  );
  await call('setUserStyle', { letterSpacing: '2px' });
  styled = await info('styled');
  check(
    '使用方 style 去掉一个属性：只删它自己的',
    !styled.inline.includes('color') && styled.inline.includes('letter-spacing') && styled.inline.includes('--x-width') && styled.inline.includes('outline-width'),
    styled.inline,
  );
  await call('setWidth', '55px');
  plain = await info('plain');
  check('动态值变化：只改行内变量（类不变），不碰使用方 style', plain.width === '55px' && plain.inline.includes('--x-width') && generated(plain.classes).length === 1, plain);
  const stringStyle0 = await info('stringStyle');
  check('style 写成字符串：解析后与引擎变量并存', stringStyle0.outlineOffset === '3px' && stringStyle0.width === '20px', stringStyle0);
  await call('setStyleText', 'outline-offset: 6px; letter-spacing: 1px');
  const stringStyle1 = await info('stringStyle');
  check('style 字符串变了：只改它自己的属性', stringStyle1.outlineOffset === '6px' && stringStyle1.inline.includes('--x-width'), stringStyle1);

  // 没有 sx 的元素上 class 变化也不冲掉别人的类
  await page.evaluate(() => document.getElementById('plainClass').classList.add('third-party'));
  await call('setClass', 'w');
  const pc = await info('plainClass');
  check('无 sx 的元素：class={x} 变化不冲掉第三方类', pc.classes.includes('w') && pc.classes.includes('third-party') && !pc.classes.includes('v'), pc.classes);

  // ---- 字面量 sx 与 effect 数量 ----
  const literal = await info('literal');
  check('sx 写字面量对象生效', literal.margin === '8px', literal);

  const counts = await page.evaluate(() => window.api.effectCounts);
  const show = (key) => `${key} ${JSON.stringify(counts[key])}`;
  check('静态 sx（create 的命名空间）不起 effect', counts.static.effects === 0 && counts.static.watchers === 0, counts.static);
  check('静态数组 / 字面量对象 / 常量参数的调用不起 effect', ['staticArray', 'staticCall'].every((k) => counts[k].effects === 0 && counts[k].watchers === 0), [show('staticArray'), show('staticCall')]);
  check('一半静态一半动态：只起引擎的一个 watch effect（不是整段）', counts.mixed.effects === 1 && counts.mixed.watchers === 1, counts.mixed);
  check('两个动态项仍是一个 effect', counts.mixedTwo.effects === 1 && counts.mixedTwo.watchers === 1, counts.mixedTwo);
  check('只有 class={x} 动态：一个 effect', counts.classOnly.effects === 1, counts.classOnly);
  check('class 动态 + sx 部分动态：各一个', counts.classAndSx.effects === 2 && counts.classAndSx.watchers === 1, counts.classAndSx);
  console.log(`     effect 计数：${Object.keys(counts).map(show).join('；')}`);
  await page.close();
}
