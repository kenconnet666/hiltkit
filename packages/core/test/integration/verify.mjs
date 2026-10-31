// 标准 JSX 方案的深入验证。node test/integration/verify.mjs
import { launch } from './browser.mjs';
import { bundle } from './bundle.mjs';

const clientCode =
  await bundle(`import { flushSync, hydrate, mount, warnings } from 'hiltkit'; import * as cases from './cases/features.tsx';
window.flushSync = flushSync; window.warnings = warnings; window.cases = cases;
window.show = (name) => { const host = document.createElement('div'); host.id = 'host-' + name; document.body.append(host); const C = cases[name]; return mount(() => <C />, host); };
window.adopt = (name) => { const C = cases[name]; return hydrate(() => <C />, document.getElementById('ssr')); };`);
const serverCode = await bundle(
  `import { preloadLazy, renderToString } from 'hiltkit'; import * as cases from './cases/features.tsx';
export const render = (name) => { const C = cases[name]; return renderToString(() => <C />); };
export { preloadLazy };`,
  { server: true },
);
const server = await import(
  `data:text/javascript;base64,${Buffer.from(serverCode).toString('base64')}`
);

const browser = await launch();
let failed = 0;
let passed = 0;
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
async function fresh() {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ content: clientCode });
  return page;
}
const text = (page, id) =>
  page.evaluate((target) => document.getElementById(target)?.textContent ?? null, id);
const flush = (page) => page.evaluate(() => window.flushSync());
const logOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.cases.log)));

{
  console.log('## 重跑次数：只有依赖变了才调用');
  const page = await fresh();
  await page.evaluate(() => void window.show('Counter'));
  let log = await logOf(page);
  check('挂载：组件函数 1 次，箭头函数 1 次', log.component === 1 && log.arrow === 1, log);
  check('derived 用在两处只算 1 次', log.memo === 1, log);
  await page.evaluate(() => {
    window.mutated = [];
    new MutationObserver((records) =>
      window.mutated.push(...records.map((r) => r.target.parentElement?.id ?? r.target.nodeName)),
    ).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  await page.evaluate(() => window.counter.other());
  await flush(page);
  log = await logOf(page);
  check(
    '改无关状态：箭头函数不跑，derived 不算，组件函数不跑',
    log.arrow === 1 && log.memo === 1 && log.component === 1,
    log,
  );
  check('改无关状态：只改它自己的文字', (await text(page, 'other')) === '1');
  await page.evaluate(() => window.counter.add());
  await flush(page);
  log = await logOf(page);
  check(
    '改依赖：箭头函数再跑 1 次，组件函数仍是 1 次',
    log.arrow === 2 && log.component === 1,
    log,
  );
  check('改依赖：derived 只再算 1 次', log.memo === 2, log);
  check('条件真假没变：分支不重建', log.branch === 0, log);
  await page.evaluate(() => {
    window.counter.add();
    window.counter.add();
  });
  await flush(page);
  log = await logOf(page);
  check('同一轮写两次：合并成一次', log.arrow === 3, log);
  check('条件变真：分支建 1 次', log.branch === 1 && (await text(page, 'big')) === '大', log);
  await page.evaluate(() => window.counter.add());
  await flush(page);
  log = await logOf(page);
  check('条件还是真：分支不重建', log.branch === 1, log);
  await page.close();
}
{
  console.log('## 方法摘下来当回调');
  const page = await fresh();
  await page.evaluate(() => void window.show('Detached'));
  await page.click('#detached-toggle');
  await flush(page);
  check('onClick={on.toggle} 能用', (await text(page, 'detached-on')) === 'true', page.errors);
  await page.click('#detached-toggle');
  await flush(page);
  check('再点一次', (await text(page, 'detached-on')) === 'false', page.errors);
  await page.click('#detached-inc');
  await flush(page);
  check('普通调用不受影响', (await text(page, 'detached-count')) === '1');
  check('没有报错', page.errors.length === 0, page.errors);
  await page.close();
}
{
  console.log('## 行内忘了写成函数');
  const page = await fresh();
  const before = await page.evaluate(() => window.warnings.length);
  await page.evaluate(() => void window.show('RowWarning'));
  check(
    'For 的行里写 {count()}：开发期有提示',
    (await page.evaluate(() => window.warnings.length)) > before,
  );
  await page.close();
}
{
  console.log('## 错误边界');
  const page = await fresh();
  await page.evaluate(() => void window.show('Boundaries'));
  await flush(page);
  check(
    '渲染时抛错（隔两层）：显示 fallback',
    (await text(page, 'render-fallback')) === '渲染炸了',
    await text(page, 'render-fallback'),
  );
  check('旁边不受影响', (await text(page, 'boundary-sibling')) === '旁边');
  check('另一个边界正常', (await text(page, 'late-bomb')) === '1');
  await page.evaluate(() => window.boundaryApi.setTick(2));
  await flush(page);
  check(
    '更新时抛错：显示 fallback',
    (await text(page, 'update-fallback')) === '更新炸了',
    await text(page, 'update-fallback'),
  );
  check('没有冒到全局', page.errors.length === 0, page.errors);
  await page.evaluate(() => {
    window.boundaryApi.setTick(3);
    window.boundaryApi.disarm();
  });
  await flush(page);
  await page.click('#update-fallback');
  await page.click('#render-fallback');
  await flush(page);
  check(
    '重试：恢复',
    (await text(page, 'late-bomb')) === '3' && (await text(page, 'bomb-safe')) === '安全',
    [await text(page, 'late-bomb'), await text(page, 'bomb-safe')],
  );
  const html = server.render('Boundaries');
  check(
    '服务端：渲染抛错输出 fallback，旁边还在',
    html.includes('渲染炸了') && html.includes('旁边'),
    html,
  );
  await page.close();
}
{
  console.log('## 传送');
  const page = await fresh();
  await page.evaluate(() => void window.show('Portals'));
  await flush(page);
  const parent = () =>
    page.evaluate(() => document.getElementById('portaled')?.parentElement?.nodeName ?? null);
  check('内容在 body 下', (await parent()) === 'BODY', await parent());
  check(
    'context 跟着原来的位置',
    (await text(page, 'portal-leaf')) === 'portal-theme',
    await text(page, 'portal-leaf'),
  );
  await page.evaluate(() => window.portalApi.setLabel('二'));
  await flush(page);
  check('内容随状态更新', (await text(page, 'portaled')).startsWith('二'));
  await page.evaluate(() => window.portalApi.setOpen(false));
  await flush(page);
  check('分支销毁：内容移除', (await parent()) === null);
  check('服务端不输出', !server.render('Portals').includes('portaled'));
  await page.close();
}
{
  console.log('## 服务');
  const page = await fresh();
  await page.evaluate(() => void window.show('Services'));
  check('多处使用只创建一次', (await logOf(page)).service === 1, await logOf(page));
  await page.evaluate(() => window.serviceApi.login('张三'));
  await flush(page);
  check(
    '状态共享',
    (await text(page, 'user-a')) === '张三' && (await text(page, 'user-b')) === '张三',
  );
  check('子树替身', (await text(page, 'user-mock')) === '替身', await text(page, 'user-mock'));
  await page.close();
  const before = server.render('Services');
  const again = server.render('Services');
  check('服务端按请求隔离', before === again && before.includes('匿名'));
}
{
  console.log('## 动态键');
  const page = await fresh();
  await page.evaluate(() => void window.show('DynamicKeys'));
  const attrs = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.getElementById('dyn').attributes].map((a) => [a.name, a.value]),
      ),
    );
  let now = await attrs();
  check('初值', now.title === 'A' && now['data-a'] === '1' && now.class === 'fixed', now);
  await page.evaluate(() => window.dynamicApi.setMode('b'));
  await flush(page);
  now = await attrs();
  check(
    '键切换：旧键移除、新键写上、固定键还在',
    now.title === 'B' && now['data-b'] === '2' && !('data-a' in now) && now.class === 'fixed',
    now,
  );
  check('服务端同形', server.render('DynamicKeys').includes('title="A"'));
  await page.close();
}
{
  console.log('## 销毁');
  const page = await fresh();
  await page.evaluate(() => void window.show('Lifetimes'));
  await flush(page);
  let log = await logOf(page);
  check(
    'effect 挂载后执行',
    ['run:branch', 'run:a', 'run:b'].every((name) => log.effects.includes(name)),
    log.effects,
  );
  await page.evaluate(() => window.lifetimeApi.setShow(false));
  await flush(page);
  log = await logOf(page);
  check(
    '分支销毁：onCleanup、effect 清理各一次',
    log.cleanups.filter((name) => name === 'branch').length === 1 &&
      log.effects.includes('stop:branch'),
    log,
  );
  await page.evaluate(() => window.lifetimeApi.drop());
  await flush(page);
  log = await logOf(page);
  check(
    '列表行销毁：只有那一行',
    log.cleanups.includes('a') && !log.cleanups.includes('b'),
    log.cleanups,
  );
  await page.close();
}
{
  console.log('## 懒加载和推迟接管');
  await server.preloadLazy();
  const body = server.render('Lazies');
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.setDefaultTimeout(5000);
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  await page.setContent(
    `<!doctype html><html><head></head><body><div id="ssr">${body}</div></body></html>`,
  );
  await page.evaluate(() => {
    window.mutations = [];
    window.observer = new MutationObserver((records) =>
      window.mutations.push(
        ...records.map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`),
      ),
    );
    window.observer.observe(document.getElementById('ssr'), {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    window.serverUids = [...document.querySelectorAll('[data-uid]')].map((el) => el.dataset.uid);
  });
  await page.addScriptTag({ content: clientCode });
  check('服务端内容已在', (await text(page, 'lazy-load')) === '点了 0');
  const uidsBefore = await page.evaluate(() => {
    window.adopt('Lazies');
    return window.serverUids;
  });
  await page
    .waitForFunction(() => window.cases.log.lazyEffects >= 2, undefined, { timeout: 3000 })
    .catch(() => {});
  await page.click('#lazy-load');
  await flush2(page);
  check(
    'load：接管后能用',
    (await text(page, 'lazy-load')) === '点了 1',
    await text(page, 'lazy-load'),
  );
  await page.waitForFunction(() => document.getElementById('lazy-idle').textContent === '点了 0');
  await page.click('#lazy-idle');
  await flush2(page);
  check(
    'idle：接管后能用',
    (await text(page, 'lazy-idle')) === '点了 1',
    await text(page, 'lazy-idle'),
  );
  await page.click('#lazy-visible');
  await flush2(page);
  check(
    'visible：进入视口接管',
    (await text(page, 'lazy-visible')) === '点了 1',
    await text(page, 'lazy-visible'),
  );
  const touchedBefore = await page.evaluate(() => window.cases.log.lazyClicks);
  await page.click('#lazy-touch');
  await page
    .waitForFunction(
      () => document.getElementById('lazy-touch').textContent === '点了 1',
      undefined,
      { timeout: 3000 },
    )
    .catch(() => {});
  check(
    'interaction：第一下点击在接管后重放',
    (await text(page, 'lazy-touch')) === '点了 1',
    await text(page, 'lazy-touch'),
  );
  check(
    'interaction：只重放一次',
    (await page.evaluate(() => window.cases.log.lazyClicks)) === touchedBefore + 1,
  );
  const mutations = await page.evaluate(() => [
    ...window.mutations,
    ...window.observer
      .takeRecords()
      .map((r) => `${r.type}:${r.target.nodeName}:${r.attributeName ?? ''}`),
  ]);
  check(
    '接管本身没有改 DOM（只有点击改文字）',
    mutations.every((item) => item.startsWith('characterData')),
    mutations.slice(0, 8),
  );
  const uidsAfter = await page.evaluate(() =>
    [...document.querySelectorAll('[data-uid]')].map((el) => el.dataset.uid),
  );
  check('useId：推迟接管也和服务端一致', JSON.stringify(uidsBefore) === JSON.stringify(uidsAfter), {
    uidsBefore,
    uidsAfter,
  });
  check('没有报错', page.errors.length === 0, page.errors);
  await page.close();
}
{
  console.log('## 字段壳：fields、at、sig.raw');
  const page = await fresh();
  await page.evaluate(() => void window.show('Fields'));
  const api = (name, ...args) =>
    page.evaluate(([fn, list]) => window.fieldApi[fn](...list), [name, args]);
  await api('setName', 'b');
  await flush(page);
  check(
    'fields 解构后写回原对象，界面跟着变',
    (await api('form')).name === 'b' && (await text(page, 'f-name-text')) === 'b',
  );
  await api('setDirect', 'c');
  await flush(page);
  check(
    '对象字段直接赋值，解构出来的壳也变',
    (await text(page, 'f-name-text')) === 'c' && (await page.inputValue('#f-name')) === 'c',
  );
  await page.fill('#f-name', 'd');
  await flush(page);
  check('fields 的壳能双向绑定', (await api('form')).name === 'd');
  await api('incAge');
  await flush(page);
  check('fields 的壳带方法，摘下来也能用', (await text(page, 'f-age-text')) === '2');
  check(
    'fields 能枚举字段',
    JSON.stringify(await api('keys')) === '["name","age","address"]',
    await api('keys'),
  );
  await api('setCity', '上海');
  await flush(page);
  check(
    'at 写深层字段',
    (await api('form')).address.city === '上海' && (await page.inputValue('#f-city')) === '上海',
  );
  check('at 空路径就是自己', await api('identity'));
  await api('dropAddress');
  await flush(page);
  check('at：中间层变空，读到 undefined', (await text(page, 'f-city-text')) === 'undefined');
  check(
    'at：中间层为空时写入报错',
    /不能写/.test(
      await page.evaluate(() => {
        try {
          window.fieldApi.setCity('x');
          return '';
        } catch (e) {
          return e.message;
        }
      }),
    ),
  );
  check('fields：整个值为空时读 undefined', (await api('emptyRead')) === 'undefined');
  check(
    'fields：整个值为空时写入报错',
    /不能写/.test(await api('emptyWrite')),
    await api('emptyWrite'),
  );
  check('at：运算不是路径', /只能写字段路径/.test(await api('pathCalc')), await api('pathCalc'));
  check('at：调方法不是路径', /只能写字段路径/.test(await api('pathCall')), await api('pathCall'));
  check('sig.raw：at 写字段报错', /sig\.raw/.test(await api('rawField')), await api('rawField'));
  check(
    'sig.raw：at 再 at 写字段也报错',
    /sig\.raw/.test(await api('rawNested')),
    await api('rawNested'),
  );
  check(
    'sig.raw：fields 写字段报错',
    /sig\.raw/.test(await api('rawFields')),
    await api('rawFields'),
  );
  await api('rawPush');
  await flush(page);
  check('sig.raw：push 不触发更新', (await text(page, 'f-raw-len')) === '1');
  await api('rawReplace');
  await flush(page);
  check('sig.raw：set 整体替换才更新', (await text(page, 'f-raw-len')) === '2');
  check('没有报错', page.errors.length === 0, page.errors);
  await page.close();
}

{
  console.log('## 样式的其余导出');
  const page = await fresh();
  await page.evaluate(() => void window.show('StyleExtras'));
  await flush(page);
  const css = (id, name) =>
    page.evaluate(
      ([target, key]) => getComputedStyle(document.getElementById(target))[key],
      [id, name],
    );
  check(
    'provideStyles + useRecipe：子树里用定制',
    (await css('themed', 'color')) === 'rgb(4, 5, 6)' && (await css('themed', 'width')) === '40px',
    [await css('themed', 'color'), await css('themed', 'width')],
  );
  check(
    '子树外用配方原样',
    (await css('unthemed', 'color')) === 'rgb(1, 2, 3)',
    await css('unthemed', 'color'),
  );
  check(
    'relation：祖先没悬停时是默认值',
    (await css('related', 'color')) === 'rgb(0, 0, 0)',
    await css('related', 'color'),
  );
  await page.hover('#card');
  check(
    'relation：祖先悬停时换值',
    (await css('related', 'color')) === 'rgb(7, 8, 9)',
    await css('related', 'color'),
  );
  const booted = await page.evaluate(() => {
    new Function(window.cases.boot.script)();
    const root = document.documentElement;
    return {
      theme: root.dataset.theme,
      hit: window.cases.boot.classes.filter((name) => root.classList.contains(name)).length,
      total: window.cases.boot.classes.length,
    };
  });
  check(
    'themeBootScript：画出之前选好一套主题',
    ['light', 'dark'].includes(booted.theme) && booted.hit === 1 && booted.total === 2,
    booted,
  );
  check('没有报错', page.errors.length === 0, page.errors);
  await page.close();
}
async function flush2(page) {
  await page.evaluate(() => window.flushSync());
}
await browser.close();
console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;
