// 配方的断言：node 10-css/run.mjs --only=recipe
import { median, openPage } from '../lib/browser.mjs';
import { bundle, here } from './lib.mjs';

export async function run({ browser, check }) {
  console.log('## 配方\n');
  const code = await bundle(here('./cases/recipe.tsx'), { minify: false });
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
      const icon = el.querySelector('i');
      return {
        classes: el.className.split(' ').filter(Boolean),
        scope: el.dataset.scope,
        part: el.dataset.part,
        iconPart: icon?.dataset.part,
        iconWidth: icon ? getComputedStyle(icon).width : undefined,
        fontSize: style.fontSize,
        bg: style.backgroundColor,
        paddingLeft: style.paddingLeft,
        paddingTop: style.paddingTop,
        radius: style.borderTopLeftRadius,
        width: style.width,
        color: style.color,
      };
    }, target);

  const d = await info('default');
  check('defaults：不传档位时 solid / md', d.fontSize === '14px' && d.bg === 'rgb(0, 0, 255)', d);
  check('基础样式与 token 短写生效', d.paddingTop === '4px' && d.radius === '4px', d);
  check('部件属性包带 data-scope / data-part', d.scope === 'button' && d.part === 'root' && d.iconPart === 'icon', d);
  check('部件各自读自己的档位：icon 宽度跟 size（md=16）', d.iconWidth === '16px', d);

  const lg = await info('lg');
  check('compound：solid + lg 才有 paddingInline 24', lg.paddingLeft === '24px' && d.paddingLeft !== '24px', { lg: lg.paddingLeft, d: d.paddingLeft });

  const block = await info('block');
  check('布尔档位 block（true 键）', block.width !== d.width, { block: block.width, d: d.width });

  const user = await info('user');
  check('使用方的 sx 排在配方之后，赢过档位', user.fontSize === '5px', user);

  // ---- 活的档位：只有读了档位的部件更新 ----
  const before = await page.evaluate(() => window.api.stats());
  await call('setSize', 'lg');
  let live = await info('live');
  const afterSize = await page.evaluate(() => window.api.stats());
  check('活档位 size 变了：root 跟着变，compound 生效', live.fontSize === '16px' && live.paddingLeft === '24px', live);
  check('size 变化只求值读了 size 的部件（root、icon）：2 次，label 不求值', afterSize.evaluations - before.evaluations === 2, { before, afterSize });
  await call('setVariant', 'soft');
  live = await info('live');
  const afterVariant = await page.evaluate(() => window.api.stats());
  check('variant 变化：只有 root 求值（1 次），compound 失效', live.bg === 'rgb(238, 238, 238)' && live.paddingLeft !== '24px' && afterVariant.evaluations - afterSize.evaluations === 1, { live, afterVariant, afterSize });
  const afterRepeat = await page.evaluate(() => (window.api.setSize('lg'), window.api.flushSync(), window.api.stats()));
  check('档位设成同一个值：不求值', afterRepeat.evaluations === afterVariant.evaluations, { afterRepeat, afterVariant });

  // ---- 主题层定制 ----
  const themed = await info('themed');
  check('主题层：给配方没有的档位 xl 取值，扩展的 base 排在配方后（圆角 99）', themed.fontSize === '30px' && themed.radius === '99px', themed);
  const themedUser = await info('themedUser');
  check('主题层之后才是使用方的 sx', themedUser.fontSize === '7px' && themedUser.radius === '99px', themedUser);
  const outside = await info('default');
  check('主题层只管子树：外面的按钮不受影响', outside.radius === '4px', outside);

  // ---- 响应式档位 ----
  await page.setViewportSize({ width: 500, height: 800 });
  const narrow = await info('responsive');
  await page.setViewportSize({ width: 1000, height: 800 });
  const wide = await info('responsive');
  check('响应式档位 size={{ base: sm, md: lg }}：窄屏 sm（12px），宽屏 lg（16px，且 compound 不匹配）', narrow.fontSize === '12px' && wide.fontSize === '16px' && wide.paddingLeft !== '24px', { narrow: narrow.fontSize, wide: wide.fontSize });

  check('{...s.root} 展开不起 effect（属性包是稳定的）：写死档位的按钮 2 个部件 0 个 effect', (await page.evaluate(() => window.api.fixedEffects())) === 0, await page.evaluate(() => window.api.fixedEffects()));

  // ---- 非活档位不起 effect ----
  const counts = await page.evaluate(() => window.api.stats());
  check('写死的档位：创建时算一次，没有 watch（watch 只来自 live 这一个按钮的 root、icon）', counts.watchers === 2, counts);
  await page.close();

  // ---- 惰性：部件很多的配方 ----
  const lazy = await bundle(here('./cases/recipe-lazy.ts'), { minify: true });
  const results = { small: [], big: [], all: [] };
  for (let round = 0; round < 5; round++) {
    const lazyPage = await openPage(browser, lazy);
    results.small.push(await lazyPage.evaluate(() => window.api.instances('small', 5000)));
    results.big.push(await lazyPage.evaluate(() => window.api.instances('big', 5000)));
    results.all.push(await lazyPage.evaluate(() => window.api.allParts(200)));
    await lazyPage.close();
  }
  const small = median(results.small.map((r) => r.ms));
  const big = median(results.big.map((r) => r.ms));
  const rowsSmall = results.small[0];
  const rowsBig = results.big[0];
  console.log(`     5000 个实例只读 root：3 部件配方 ${small.toFixed(1)} ms，40 部件配方 ${big.toFixed(1)} ms；读全部 40 个部件 200 个实例 ${median(results.all).toFixed(1)} ms`);
  console.log(`     片段求值次数：3 部件 ${rowsSmall.fragmentBuilds}，40 部件 ${rowsBig.fragmentBuilds}（只读了 root）`);
  check('部件惰性：40 部件的配方只读 root 时，只为 root 算样式（2 个档位 × 1 部件）', rowsBig.fragmentBuilds === 2, rowsBig);
  check('部件惰性：40 部件与 3 部件的实例成本同量级（2 倍以内）', big < small * 2 + 5, { small, big });
}
