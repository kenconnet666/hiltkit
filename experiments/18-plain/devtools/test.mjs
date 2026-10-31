// 调试工具的测试：node 18-plain/devtools/test.mjs。页面内的协议、生产产物隔离、Vite + 命令行 + MCP 端到端。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launch } from '../../lib/browser.mjs';
import { ALIAS, bundle } from '../bundle.mjs';
import { hiltDevtools, hiltHot } from '../hilt/vite.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail === undefined ? '' : `：${JSON.stringify(detail)?.slice(0, 500)}`}`);
  }
};

const browser = await launch();
const entry = `import { configureDevtools } from 'hilt/devtools';
import { flushSync, hydrate, sig } from 'hilt';
import { start, startMany } from './devtools/fixture';
Object.assign(window, { configureDevtools, flushSync, hydrate, sig, startMany });
if (!location.hash) start();`;
const devCode = await bundle(entry, { jsxDev: true });
const open = async (code = devCode) => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addScriptTag({ content: code });
  return { page, errors };
};
const caller = (page) => async (method, params) => page.evaluate(([m, p]) => window.__HILT_DEVTOOLS__.call(m, p), [method, params]);
const asJson = (value) => JSON.stringify(value);

// ---- 页面内 ----
{
  const { page } = await open();
  const raw = caller(page);
  const call = async (method, params) => {
    const outcome = await raw(method, params);
    if (!outcome.ok) throw new Error(`${method} 失败：${asJson(outcome.error)}`);
    return outcome.result;
  };

  const summary = await call('summary');
  check('summary 有应用和组件统计', summary.apps.length === 1 && summary.components > 10 && summary.topComponents.Label >= 4 && summary.effects > 5, summary);

  const tree = await call('tree', { depth: 2 });
  const app = tree[0].children[0];
  check('tree 名字和层级', app.name === 'App' && app.children.some((child) => child.name === 'Counter'), tree);
  check('tree 有 JSX 位置', /fixture\.tsx:\d+:\d+/.test(app.children[0].source), app.children[0]);
  check('tree 到 depth 截断并给子节点数', app.children.find((child) => child.name === 'Counter').childCount === 1, app);
  const found = await call('tree', { name: 'Label' });
  check('tree 按名字搜出路径', found.total >= 4 && found.matches.some((match) => match.path === 'App > Counter > Label'), found);
  const limited = await call('tree', { depth: 1, limit: 2 });
  check('tree 超过 limit 给剩余统计', limited[0].children[0].more?.count >= 1 || limited[0].children.length <= 2, limited);

  const located = await call('locate', { selector: '#inc' });
  check('locate 给行号和组件链', /fixture\.tsx:\d+/.test(located.source) && located.components[0].name === 'Counter' && located.components[1].name === 'App', located);
  check('locate 列出元素上的绑定', located.effects.some((item) => item.kind === 'attr' && item.target.includes('data-count')), located);
  const notOurs = await raw('locate', { selector: 'body' });
  check('locate 不是 hilt 渲染的元素', !notOurs.ok && notOurs.error.code === 'NOT_FOUND', notOurs);

  const counterId = found.matches.find((match) => match.path === 'App > Counter > Label') && app.children[0].id;
  const counter = await call('inspect', { target: counterId });
  check('inspect 组件的 props 和信号', counter.props.start === 1 && counter.signals.some((signal) => signal.name === 'sig' && signal.value === 1) && counter.signals.some((signal) => signal.name === 'derived'), counter);
  const signalId = counter.signals.find((signal) => signal.name === 'sig').id;
  const signal = await call('inspect', { target: signalId });
  check('inspect 信号的订阅者', signal.subscribers >= 2 && signal.effects.length >= 1 && signal.derived.length === 1, signal);
  const effectId = signal.effects[0].id;
  const effect = await call('inspect', { target: effectId });
  check('inspect effect 的依赖和落点', effect.deps.some((dep) => dep.id === signalId) && effect.target.includes('data-count') && effect.value === '1', effect);
  const elementView = await call('inspect', { target: '#inc' });
  check('inspect 也收选择器', elementView.element === '<button#inc>' && elementView.component.name === 'Counter', elementView);

  const before = await raw('why', { target: '#inc' });
  check('没录制时 why 说明先录制', !before.ok && before.error.code === 'NOT_RECORDING' && before.error.hint.includes('record'), before);

  await call('record', { action: 'start' });
  await page.click('#inc');
  await page.evaluate(() => {
    window.source.set(2);
    window.tick.inc();
    window.flushSync();
  });
  const stopped = await call('record', { action: 'stop' });
  check('record stop 有摘要', stopped.writes >= 3 && stopped.runs >= 4 && stopped.top.length > 0, stopped);
  const whyButton = await call('why', { target: '#inc' });
  const firstCause = whyButton.runs?.[0]?.because?.[0];
  check('why 直接绑定：谁写的、从几到几', firstCause?.from === 1 && firstCause?.to === 2 && firstCause?.write.id === signalId, whyButton);
  check('why 带浏览器事件', firstCause?.trigger === 'click <button#inc>', firstCause);
  const whyLabel = await call('why', { target: '#counter .label' });
  check('why 穿过 derived 找到写入', whyLabel.runs?.[0]?.because?.[0]?.write.id === signalId && whyLabel.runs[0].after === '双倍 4', whyLabel);
  const whyChain = await call('why', { target: '#chain' });
  const chainCause = whyChain.runs?.[0]?.because?.[0];
  check('why 连环：effect 写的值能追到源头', chainCause?.by?.kind === 'effect' && chainCause?.to === 20 && chainCause?.because?.[0]?.to === 2, whyChain);
  const whySignal = await call('why', { target: signalId });
  check('why 信号：写入和带出的运行', whySignal.writes.length === 1 && whySignal.triggered.length >= 2, whySignal);
  const untouched = await call('why', { target: '#branch' });
  check('why 没跑过时给提示', untouched.ran === false && typeof untouched.hint === 'string', untouched);
  const perf = await call('perf');
  const wasteful = perf.groups.find((group) => group.key === 'Wasteful attr title');
  check('perf 抓到白跑的绑定', wasteful?.wasted === 1 && wasteful?.runs === 1, perf);
  check('perf 没有把真实更新算成白跑', perf.groups.find((group) => group.key === 'Counter attr data-count')?.wasted === 0, perf);
  const timeline = await call('timeline', { limit: 3 });
  check('timeline 分页', timeline.total > 3 && timeline.events.length === 3 && timeline.events[0].write, timeline);

  const labels = async () => (await call('tree', { name: 'Label', limit: 1 })).total;
  const start = await labels();
  await page.click('#flip');
  await page.evaluate(() => window.flushSync());
  check('分支收起：组件从树上消失', (await labels()) === start - 1, await labels());
  const effects0 = (await call('summary')).effects;
  for (let i = 0; i < 6; i++) {
    await page.click('#flip');
    await page.evaluate(() => window.flushSync());
  }
  check('分支反复切换：组件和 effect 不累积', (await labels()) === start - 1 && (await call('summary')).effects === effects0, [await labels(), (await call('summary')).effects, effects0]);
  await page.evaluate(() => {
    window.removeRow();
    window.flushSync();
  });
  check('列表删行：组件从树上消失', (await labels()) === start - 2, await labels());
  await page.click('#flip');

  const issues = await call('issues');
  const frozen = issues.issues.find((entry) => entry.code === 'HILT001' && entry.component === 'Frozen');
  check('HILT001 指到组件和修法', frozen?.fix.includes('() => count()') && /fixture\.tsx/.test(frozen?.source), issues);
  const filtered = await call('issues', { code: 'HILT001' });
  check('issues 按编号过滤', filtered.issues.every((entry) => entry.code === 'HILT001'), filtered);
  await page.evaluate(() => {
    window.breakIt();
    window.addEventListener('error', (event) => event.preventDefault());
    window.flushSync();
  });
  const thrown = (await call('issues', { code: 'HILT003' })).issues[0];
  check('HILT003 effect 抛错', thrown?.message.includes('故意抛错') && thrown?.component === 'Broken', thrown);

  const attrs = await call('attrs', { selector: '#merged' });
  const layers = attrs.props.class?.layers ?? [];
  check('attrs 列出 class 各层', layers.some((layer) => layer.value === 'from-user') && layers.some((layer) => String(layer.value).includes('btn-lg')) && layers.some((layer) => layer.value === 'base'), attrs);
  check('attrs 标出合并它的组件', layers.find((layer) => layer.value === 'base')?.mergedIn === 'Base' && layers.find((layer) => String(layer.value).includes('btn-lg'))?.mergedIn === 'Mid', layers);
  check('attrs 最终 attribute', attrs.attributes.class.split(' ').includes('btn-lg') && attrs.attributes.title === '标题' && attrs.props.title.kind === 'static', attrs);
  const eventAttrs = await call('attrs', { selector: '#inc' });
  check('attrs 区分事件和信号', eventAttrs.props.onClick.kind === 'event' && eventAttrs.props['data-count'].kind === 'sig', eventAttrs);

  // ---- 敏感数据 ----
  await call('record', { action: 'start' });
  await page.evaluate(() => {
    window.secretForm().password = 'newsecret';
    window.flushSync();
  });
  await call('record', { action: 'stop' });
  const secrets = (await call('tree', { name: 'Secrets' })).matches[0].id;
  const dumps = await Promise.all([
    call('inspect', { target: secrets }),
    call('inspect', { target: '#pw' }),
    call('attrs', { selector: '#pw' }),
    call('why', { target: '#city' }),
    call('timeline', { limit: 200 }),
    call('locate', { selector: '#pw' }),
  ]);
  const text = asJson(dumps);
  for (const secret of ['hunter2', 'newsecret', 'k-123', '1234']) check(`不输出敏感值 ${secret}`, !text.includes(secret), text.slice(text.indexOf(secret) - 80, text.indexOf(secret) + 40));
  check('隐藏时明确标出来', text.includes('[已隐藏]'));
  const formSignal = dumps[0].signals.find((item) => item.name === 'sig');
  check('普通字段照常显示', asJson(formSignal.value).includes('Paris') && asJson(formSignal.value).includes('ada'), formSignal);

  // ---- 写入和错误 ----
  const bound = await call('inspect', { target: (await call('tree', { name: 'Bound' })).matches[0].id });
  const refused = await raw('set', { target: signalId, value: 100 });
  check('写入默认关闭', !refused.ok && refused.error.code === 'WRITE_DISABLED' && refused.error.hint.includes('allowWrite'), refused);
  await page.evaluate(() => window.configureDevtools({ allowWrite: true }));
  const written = await call('set', { target: signalId, value: 100 });
  const attribute = await page.getAttribute('#inc', 'data-count');
  check('打开后能写，页面跟着变', written.value === 100 && attribute === '100', [written, attribute]);
  const badWrite = await raw('set', { target: counter.signals.find((item) => item.name === 'derived').id, value: 1 });
  check('derived 不能写', !badWrite.ok && badWrite.error.code === 'BAD_PARAMS', badWrite);
  await page.evaluate(() => window.configureDevtools({ allowWrite: false }));
  check('Bound 的 sig prop 显示值', bound.props.value === 'sig("初始")', bound);

  const unknown = await raw('nope');
  check('未知方法列出可用方法', !unknown.ok && unknown.error.code === 'UNKNOWN_METHOD' && unknown.error.hint.includes('summary'), unknown);
  const inherited = await raw('constructor');
  check('原型上的名字不算方法', !inherited.ok && inherited.error.code === 'UNKNOWN_METHOD', inherited);
  const badSelector = await raw('locate', { selector: '###' });
  check('选择器写错', !badSelector.ok && badSelector.error.code === 'BAD_SELECTOR', badSelector);
  const gone = await raw('inspect', { target: 'c999999' });
  check('id 不存在时提示重新取', !gone.ok && gone.error.code === 'NOT_FOUND' && gone.error.hint.includes('tree'), gone);
  const noTarget = await raw('inspect', {});
  check('缺参数', !noTarget.ok && noTarget.error.code === 'BAD_PARAMS', noTarget);

  // 工具只看不动：查询不增加依赖、不触发重跑
  const runsBefore = (await call('inspect', { target: effectId })).runs;
  const depsBefore = (await call('inspect', { target: effectId })).deps.length;
  for (const method of ['summary', 'tree', 'issues']) await call(method);
  await call('inspect', { target: signalId });
  await page.evaluate(() => window.flushSync());
  const after = await call('inspect', { target: effectId });
  check('查询不改变依赖和运行次数', after.runs === runsBefore && after.deps.length === depsBefore, after);
  check('所有结果都能 JSON 化', asJson(await Promise.all(['summary', 'tree', 'issues'].map((method) => call(method)))).length > 0);

  await page.evaluate(() => window.unmount());
  const end = await call('summary');
  check('卸载后组件和 effect 归零', end.apps.length === 0 && end.components === 0 && end.effects === 0, end);
  await page.close();
}

// ---- 水合不一致 ----
{
  const shared = await bundle(`import 'hilt/devtools';
import { hydrate } from 'hilt';
function Clock() { return <div><p>客户端</p><article>x</article></div>; }
const host = document.body.appendChild(document.createElement('div'));
host.innerHTML = '<div><p>服务端</p><section>x</section></div>';
hydrate(() => <Clock />, host);`, { jsxDev: true });
  const second = await open(shared);
  const mismatches = (await caller(second.page)('issues', { code: 'HILT002' })).result.issues;
  check('HILT002 文字不一致', mismatches.some((entry) => entry.message.includes('客户端') && entry.message.includes('服务端') && entry.component === 'Clock'), mismatches);
  check('HILT002 标签不一致', mismatches.some((entry) => entry.message.includes('article') && entry.message.includes('section')), mismatches);
  await second.page.close();
}

// ---- 大页面：输出和耗时不随组件数膨胀 ----
{
  const code = await bundle(`import 'hilt/devtools';
import { startMany } from './devtools/fixture';
startMany(10000);`, { jsxDev: true });
  const { page } = await open(code);
  const call = caller(page);
  const tree = await call('tree', { depth: 2 });
  const size = asJson(tree).length;
  check(`一万个组件 tree 输出很小（${size} 字节）`, size < 6000 && tree.result[0].children.length === 20 && tree.result[0].more.byName.Item === 9980, asJson(tree).slice(0, 300));
  const summary = await call('summary');
  const timed = await page.evaluate(() => {
    const start = performance.now();
    window.__HILT_DEVTOOLS__.call('summary');
    return performance.now() - start;
  });
  check(`一万个组件 summary 够快（${timed.toFixed(1)} ms）`, summary.result.components === 10000 && timed < 100, summary);
  await page.close();
}

// ---- 生产产物没有调试内核 ----
{
  const production = await bundle(`import { start } from './devtools/fixture'; start();`, { minify: true });
  check('生产产物不含调试入口', !production.includes('__HILT_DEVTOOLS__') && !production.includes('HILT001') && !production.includes('已隐藏'));
  const { page, errors } = await open(production);
  const present = await page.evaluate(() => '__HILT_DEVTOOLS__' in window);
  await page.click('#inc');
  await page.waitForFunction(() => document.querySelector('#inc').getAttribute('data-count') === '2');
  check('没装调试内核也正常工作', !present && !errors.length, errors);
  await page.close();
}

// ---- Vite + 命令行 + MCP ----
{
  const root = here('./.e2e');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><title>调试测试</title></head><body><script type="module" src="/src/main.tsx"></script></body></html>');
  writeFileSync(join(root, 'src/main.tsx'), `import { start } from '../../fixture';\nstart();\n`);
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [hiltDevtools(), hiltHot()],
    cacheDir: join(root, '.vite'),
    server: { port: 5490, strictPort: false, fs: { strict: false } },
    resolve: { alias: Object.entries(ALIAS).map(([find, replacement]) => ({ find: new RegExp(`^${find.replace('/', '\\/')}$`), replacement })) },
    esbuild: { jsx: 'automatic', jsxImportSource: 'hilt' },
    oxc: { jsx: { runtime: 'automatic', importSource: 'hilt' } },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  const discovery = join(root, 'node_modules/.hilt/devtools.json');
  check('开发服务器写了发现文件', existsSync(discovery));

  const cli = (...args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [here('./cli.mjs'), ...args, `--root=${root}`]);
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (err += chunk));
      child.on('close', (code) => resolve({ code, out, err }));
    });
  const noPage = await cli('summary');
  check('没打开页面：退出码 1 和错误码', noPage.code === 1 && JSON.parse(noPage.err).code === 'NO_PAGE', noPage);

  const noToken = await fetch(new URL('__hilt/call', url), { method: 'POST', body: '{"method":"summary"}' });
  check('没有令牌被拒绝', noToken.status === 403, noToken.status);

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url);
  await page.waitForSelector('#inc', { timeout: 60000 });
  await page.waitForFunction(() => window.__HILT_DEVTOOLS__);

  const retry = async (...args) => {
    for (let i = 0; ; i++) {
      const result = await cli(...args);
      if (result.code === 0 || i >= 20) return result;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  const summary = await retry('summary');
  check('命令行 summary', summary.code === 0 && JSON.parse(summary.out).components > 10, summary);
  const located = await cli('locate', '#inc');
  check('Vite 开发模式能拿到 JSX 位置', located.code === 0 && /fixture\.tsx:\d+/.test(JSON.parse(located.out).source), located);
  const badUse = await cli('nope');
  check('命令写错：退出码 2 和用法', badUse.code === 2 && badUse.err.includes('summary'), badUse);

  await cli('record', 'start');
  await page.click('#inc');
  await cli('record', 'stop');
  const why = await cli('why', '#inc');
  const cause = JSON.parse(why.out).runs?.[0]?.because?.[0];
  check('why 指到写入的源码行', /fixture\.tsx:\d+:\d+/.test(cause?.site ?? ''), why.out.slice(0, 500));
  const issues = await cli('issues', '--code=HILT001');
  const frozen = JSON.parse(issues.out).issues.find((entry) => entry.component === 'Frozen');
  check('HILT001 指到读取的源码行', /fixture\.tsx:\d+:\d+/.test(frozen?.site ?? ''), frozen);

  // MCP：直接按协议对话
  const mcp = spawn(process.execPath, [here('./mcp.mjs'), `--root=${root}`]);
  let buffer = '';
  const waiting = new Map();
  mcp.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      waiting.get(message.id)?.(message);
    }
  });
  let nextId = 0;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = ++nextId;
      waiting.set(id, resolve);
      mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  check('MCP initialize', init.result?.serverInfo?.name === 'hilt-devtools' && init.result?.capabilities?.tools !== undefined, init);
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await rpc('tools/list', {});
  check('MCP 工具清单有 schema', list.result?.tools.length === 11 && list.result.tools.every((tool) => tool.name.startsWith('hilt_') && tool.inputSchema?.type === 'object'), list.result?.tools?.map((tool) => tool.name));
  check('MCP 只读工具有标注', list.result.tools.find((tool) => tool.name === 'hilt_tree').annotations.readOnlyHint === true && list.result.tools.find((tool) => tool.name === 'hilt_set').annotations.destructiveHint === true);
  const tree = await rpc('tools/call', { name: 'hilt_tree', arguments: { name: 'Counter' } });
  const treeBody = JSON.parse(tree.result.content[0].text);
  check('MCP 调用返回页面数据并标明不可信', treeBody.untrustedPageData === true && treeBody.result.total === 1, treeBody);
  const failedTool = await rpc('tools/call', { name: 'hilt_inspect', arguments: { target: '#不存在' } });
  check('MCP 工具报错走 isError', failedTool.result.isError === true && JSON.parse(failedTool.result.content[0].text).code === 'NOT_FOUND', failedTool);
  const missing = await rpc('nope', {});
  check('MCP 未知方法', missing.error?.code === -32601, missing);
  mcp.stdin.end();

  // 刷新后还能连上新页面；关掉的旧连接不会被选中
  await page.reload();
  await page.waitForSelector('#inc');
  const again = await retry('summary');
  check('页面刷新后还能查', again.code === 0, again);
  const replaced = await browser.newPage();
  await replaced.goto(url);
  await replaced.waitForSelector('#inc');
  await page.close();
  const switched = await retry('summary');
  check('旧页面关掉后转到新页面', switched.code === 0, switched);
  check('Vite 下页面没有错误', !pageErrors.length, pageErrors);
  await replaced.close();

  await server.close();
  check('服务器关闭后删掉发现文件', !existsSync(discovery));
  const down = await cli('summary');
  check('没有服务器：错误码', down.code === 1 && JSON.parse(down.err).code === 'NO_SERVER', down);
  rmSync(root, { recursive: true, force: true });
}

await browser.close();
console.log(`通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
