// 语言服务（tsc --lsp）的延迟：打开探针文件后的首次悬停、sx 里 token / 条件 / 属性名的补全、改一个字符后的再次响应。
// 用法：node perf/lsp.mjs [--n=300,1000] [--variants=base,v0-baseline] [--rounds=3] [--tsc=7.1|7.0]
//   先 node perf/gen.mjs <N>。每一轮都新起一个服务进程（冷启动），延迟取各轮中位数。
//   探针文件 src/probe.tsx 里用 ⟦名字⟧ 标光标位置；这里读入时去掉标记并记下 LSP 位置。
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sizes = arg('n', '300').split(',').map(Number);
const variants = arg('variants', 'typed').split(',');
const rounds = Number(arg('rounds', '3'));
const outBase = resolve(arg('dir', `${root}/perf/out`));
const TSC = { '7.1': '../13-ts/node_modules/typescript/bin/tsc', '7.0': '../13-ts/node_modules/ts70/bin/tsc' };
const tsc = resolve(root, TSC[arg('tsc', '7.1')]);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** 读探针：去掉 ⟦名字⟧，返回源码与各标记的位置 */
function loadProbe(path) {
  const raw = readFileSync(path, 'utf8');
  const marks = {};
  let text = '';
  let line = 0;
  let character = 0;
  for (let i = 0; i < raw.length; ) {
    if (raw[i] === '⟦') {
      const end = raw.indexOf('⟧', i);
      marks[raw.slice(i + 1, end)] = { line, character };
      i = end + 1;
      continue;
    }
    const ch = raw[i++];
    text += ch;
    if (ch === '\n') (line++, (character = 0));
    else character++;
  }
  return { text, marks };
}

async function session(dir, probe) {
  const child = spawn(process.execPath, [tsc, '--lsp', '--stdio'], { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  const diagnostics = new Map();
  const send = (message) => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  child.stdout.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const header = buffer.indexOf('\r\n\r\n');
      if (header < 0) return;
      const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, header).toString())?.[1]);
      if (buffer.length < header + 4 + length) return;
      const message = JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString());
      buffer = buffer.subarray(header + 4 + length);
      if (message.id !== undefined && message.method) send({ jsonrpc: '2.0', id: message.id, result: message.method === 'workspace/configuration' ? [] : null });
      else if (message.id !== undefined && pending.has(message.id)) (pending.get(message.id)(message), pending.delete(message.id));
      else if (message.method === 'textDocument/publishDiagnostics') diagnostics.set(message.params.uri, { at: performance.now(), count: message.params.diagnostics.length });
    }
  });
  let nextId = 1;
  const request = (method, params) => new Promise((done) => {
    const id = nextId++;
    pending.set(id, done);
    send({ jsonrpc: '2.0', id, method, params });
  });
  const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
  const uri = pathToFileURL(`${dir}/src/probe.tsx`).href;
  const timed = async (method, params) => {
    const start = performance.now();
    const response = await request(method, params);
    return { ms: performance.now() - start, response };
  };
  return {
    uri,
    request,
    timed,
    notify,
    diagnostics,
    async open() {
      const init = await timed('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(dir).href,
        capabilities: { textDocument: { hover: { contentFormat: ['plaintext'] }, completion: { completionItem: { snippetSupport: false } } } },
        workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'bench' }],
      });
      notify('initialized', {});
      notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text: probe.text } });
      return init.ms;
    },
    close() {
      child.kill();
    },
  };
}

const hoverText = (response) => {
  const contents = response.result?.contents;
  return typeof contents === 'string' ? contents : (contents?.value ?? (Array.isArray(contents) ? contents.map((c) => c.value ?? c).join('') : ''));
};
/** 可选属性的补全标签带 ?（`tone?`），统一去掉 */
const labels = (response) => (response.result?.items ?? response.result ?? []).map((item) => item.label.replace(/\?$/, ''));

async function measure(dir, probe) {
  const s = await session(dir, probe);
  const result = {};
  result.init = await s.open();
  const at = (name) => ({ textDocument: { uri: s.uri }, position: probe.marks[name] });
  const wait = Date.now();
  // 首次悬停：包含项目加载与该位置所需的检查
  const first = await s.timed('textDocument/hover', at('hover-target'));
  result.firstHover = first.ms;
  result.firstHoverOk = hoverText(first.response).length > 0;
  const warm = [];
  for (let i = 0; i < 10; i++) warm.push((await s.timed('textDocument/hover', at('hover-target'))).ms);
  result.warmHover = median(warm);
  const sx = await s.timed('textDocument/hover', at('hover-sx'));
  result.hoverSx = sx.ms;
  // 补全
  const check = async (name, key, expect, reject) => {
    const r = await s.timed('textDocument/completion', { ...at(name), context: { triggerKind: 1 } });
    const items = labels(r.response);
    result[key] = { ms: r.ms, count: items.length, ok: expect.every((label) => items.includes(label)) && reject.every((label) => !items.includes(label)), sample: items.slice(0, 6) };
  };
  await check('sx-padding', 'padding', ['_md', '_xs', '_none'], ['_text', '_accent']);
  await check('sx-color', 'color', ['_text', '_accent', '_textMuted'], ['_md', '_xl']);
  await check('sx-display', 'display', ['flex'], ['_md']);
  await check('cond-key', 'condition', ['_hover', '_loading', '_md'], []);
  await check('comp-prop', 'componentProp', ['tone', 'value', 'label'], []);
  await check('attr', 'attribute', ['id', 'class', 'sx', 'onClick'], []);
  await check('event', 'event', ['onClick', 'onClickCapture'], []);
  // 再补一次 padding（热状态）
  const again = await s.timed('textDocument/completion', { ...at('sx-padding'), context: { triggerKind: 1 } });
  result.paddingWarm = again.ms;
  // 改一个字符后的响应：在文件末尾加注释，再悬停 / 等诊断
  const version = 2;
  s.notify('textDocument/didChange', { textDocument: { uri: s.uri, version }, contentChanges: [{ text: `${probe.text}\n// edit` }] });
  const afterEdit = await s.timed('textDocument/hover', at('hover-target'));
  result.hoverAfterEdit = afterEdit.ms;
  const diag = await s.timed('textDocument/diagnostic', { textDocument: { uri: s.uri } }).catch(() => undefined);
  result.diagnostics = diag?.ms;
  void wait;
  s.close();
  return result;
}

console.log(`tsc --lsp（TS ${arg('tsc', '7.1')}），每轮冷启动一个新服务进程，${rounds} 轮中位数，单位 ms`);
console.log('| 组件数 | 变体 | 初始化 | 首次悬停 | 再次悬停 | 悬停 sx | 改动后悬停 | 诊断 | 补全 padding（首/再）| 补全 color | 补全 display | 补全条件键 | 补全组件 prop | 补全属性名 | 补全事件名 | 补全内容正确 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const n of sizes) {
  for (const variant of variants) {
    const dir = resolve(outBase, String(n));
    const config = `${dir}/tsconfig.${variant}.json`;
    if (!existsSync(config)) {
      console.log(`| ${n} | ${variant} | 缺少 ${config} |`);
      continue;
    }
    // LSP 按目录里的 tsconfig.json 找项目：把变体配置复制过去，并把探针文件放进 include
    const json = JSON.parse(readFileSync(config, 'utf8'));
    delete json.exclude;
    writeFileSync(`${dir}/tsconfig.json`, JSON.stringify(json, null, 2));
    const probe = loadProbe(`${dir}/src/probe.tsx`);
    const runs = [];
    for (let i = 0; i < rounds; i++) runs.push(await measure(dir, probe));
    const m = (pick) => median(runs.map(pick).filter((x) => x !== undefined)).toFixed(0);
    const correct = runs[0] && ['padding', 'color', 'display', 'condition', 'componentProp', 'attribute', 'event'].filter((k) => !runs[0][k].ok);
    console.log(
      `| ${n} | ${variant} | ${m((r) => r.init)} | ${m((r) => r.firstHover)}${runs[0].firstHoverOk ? '' : '（无内容）'} | ${m((r) => r.warmHover)} | ${m((r) => r.hoverSx)} | ${m((r) => r.hoverAfterEdit)} | ${m((r) => r.diagnostics)} | ${m((r) => r.padding.ms)} / ${m((r) => r.paddingWarm)} (${runs[0].padding.count} 项) | ${m((r) => r.color.ms)} (${runs[0].color.count}) | ${m((r) => r.display.ms)} (${runs[0].display.count}) | ${m((r) => r.condition.ms)} (${runs[0].condition.count}) | ${m((r) => r.componentProp.ms)} (${runs[0].componentProp.count}) | ${m((r) => r.attribute.ms)} (${runs[0].attribute.count}) | ${m((r) => r.event.ms)} (${runs[0].event.count}) | ${correct.length ? `不符：${correct.join(',')}` : '是'} |`,
    );
    if (process.env.SHOW) for (const key of ['padding', 'color', 'display', 'condition', 'componentProp', 'attribute', 'event']) console.log(`  ${key}: ${runs[0][key].sample.join(' ')}`);
    rmSync(`${dir}/tsconfig.json`, { force: true });
  }
}
void copyFileSync;
