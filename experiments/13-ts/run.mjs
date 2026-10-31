// node 13-ts/run.mjs [--only=cli,api,lsp]
// TS 7（Go 原生版）的三个问题：
//   cli：类型检查、声明生成，比 TS 6 快多少（真实项目 vue-tsx-pro/packages/ui，只读，输出写到临时目录）
//   api：逐文件的语法树、去类型能不能进开发服务器的转换流程，和 Babel、oxc 比
//   lsp：语言服务的冷启动与响应
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSync as babelParse } from '@babel/core';
import { API } from 'typescript/sync';
import { parseSync as oxcParse } from 'oxc-parser';
import { transformSync as oxcTransform } from 'oxc-transform';
import ts6 from 'ts6';
import { compile } from '../03-publish/packages/compiler/index.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const section = (name) => !only || only.includes(name);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const UI = 'C:/Users/lionheart/IdeaProjects/vue-tsx-pro/packages/ui';
const BINS = {
  'TS 7.1 beta': here('./node_modules/typescript/bin/tsc'),
  'TS 7.0.2': here('./node_modules/ts70/bin/tsc'),
  'TS 6.0.3': here('./node_modules/ts6/bin/tsc'),
};

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.test' || name === 'test' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkFiles(path, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

if (section('cli')) {
  console.log('\n== 类型检查与声明生成（vue-tsx-pro/packages/ui，3 轮中位数）==');
  const metric = (text, name) => text.match(new RegExp(`${name}:\\s+([\\d.]+)`))?.[1];
  const run = (bin, extra) => {
    const start = performance.now();
    const result = spawnSync(process.execPath, [bin, '-p', join(UI, 'tsconfig.json'), '--incremental', 'false', '--extendedDiagnostics', ...extra], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: UI });
    const wall = performance.now() - start;
    const out = result.stdout + result.stderr;
    return {
      wall,
      check: Number(metric(out, 'Check time')),
      memory: Number(metric(out, 'Memory used')),
      files: metric(out, 'Files'),
      instantiations: metric(out, 'Instantiations'),
      errors: (out.match(/error TS\d+/g) ?? []).length,
      code: result.status,
      sample: out.match(/.*error TS\d+.*/)?.[0]?.slice(0, 160),
    };
  };
  console.log('| 版本 | 检查总耗时 s | Check time s | 内存 MB | 文件 | 实例化 | 错误数 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  const rows = {};
  for (const [name, bin] of Object.entries(BINS)) {
    const runs = [run(bin, ['--noEmit']), run(bin, ['--noEmit']), run(bin, ['--noEmit'])];
    const last = runs.at(-1);
    rows[name] = median(runs.map((item) => item.wall));
    console.log(`| ${name} | ${(rows[name] / 1000).toFixed(2)} | ${median(runs.map((item) => item.check)).toFixed(2)} | ${(last.memory / 1024).toFixed(0)} | ${last.files} | ${last.instantiations} | ${last.errors} |`);
    if (last.sample) console.log(`  首个错误：${last.sample}`);
  }
  console.log(`\nTS 7.1 比 TS 6 快 ${(rows['TS 6.0.3'] / rows['TS 7.1 beta']).toFixed(1)} 倍`);
  console.log('\n| 版本 | 声明生成总耗时 s |');
  console.log('| --- | --- |');
  for (const [name, bin] of Object.entries(BINS)) {
    const times = [];
    for (let round = 0; round < 3; round++) {
      const outDir = mkdtempSync(join(tmpdir(), 'hilt-dts-'));
      times.push(run(bin, ['--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', outDir]).wall);
      rmSync(outDir, { recursive: true, force: true });
    }
    console.log(`| ${name} | ${(median(times) / 1000).toFixed(2)} |`);
  }
  // 多核：TS 7 的检查器并行
  const single = [run(BINS['TS 7.1 beta'], ['--noEmit', '--singleThreaded']), run(BINS['TS 7.1 beta'], ['--noEmit', '--singleThreaded'])];
  console.log(`\nTS 7.1 单线程（--singleThreaded）：${(median(single.map((item) => item.wall)) / 1000).toFixed(2)} s`);
}

if (section('api')) {
  const realFiles = walkFiles(join(UI, 'src')).map((path) => ({ path, code: readFileSync(path, 'utf8') }));
  const generatedDir = here('../12-dev/.gen/300/src/lib');
  const generatedFiles = readdirSync(generatedDir).filter((name) => name.endsWith('.tsx')).map((name) => ({ path: join(generatedDir, name), code: readFileSync(join(generatedDir, name), 'utf8') }));
  const totalKb = (files) => (files.reduce((sum, file) => sum + file.code.length, 0) / 1024).toFixed(0);
  console.log(`\n== 逐文件处理（真实 ${realFiles.length} 个 TSX、${totalKb(realFiles)} KB；生成 ${generatedFiles.length} 个、${totalKb(generatedFiles)} KB；单线程，热身后 5 轮中位数）==`);

  const babelOptions = (path) => ({ filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx', 'typescript'] }, sourceType: 'module' });
  const countBabel = (node) => {
    let count = 0;
    const visit = (value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === 'string') {
        count++;
        for (const key in value) if (key !== 'loc' && key !== 'extra' && key !== 'comments' && key !== 'tokens') visit(value[key]);
      }
    };
    visit(node);
    return count;
  };
  const tsApi = new API();
  const walkTs = (root) => {
    let count = 0;
    const visit = (node) => {
      count++;
      node.forEachChild(visit);
    };
    visit(root);
    return count;
  };

  const tasks = {
    'Babel 解析': (file) => babelParse(file.code, babelOptions(file.path)),
    'Babel 解析 + 遍历': (file) => countBabel(babelParse(file.code, babelOptions(file.path))),
    'oxc 解析': (file) => oxcParse(file.path, file.code),
    'oxc 解析 + 遍历（转成 JS 对象）': (file) => countBabel(oxcParse(file.path, file.code).program),
    'TS 7 建语法树（跨进程）': (file) => {
      const retained = tsApi.createSourceFile(file.path, file.code);
      retained.dispose();
    },
    'TS 7 建语法树 + 遍历（跨进程）': (file) => {
      const retained = tsApi.createSourceFile(file.path, file.code);
      walkTs(retained.sourceFile);
      retained.dispose();
    },
    'TS 6 去类型 transpileModule': (file) => ts6.transpileModule(file.code, { fileName: file.path, compilerOptions: { jsx: ts6.JsxEmit.Preserve, target: ts6.ScriptTarget.ESNext, module: ts6.ModuleKind.ESNext } }),
    'TS 7 去类型 transpileModule（跨进程）': (file) => tsApi.transpileModule(file.code, { fileName: file.path, compilerOptions: { jsx: 'preserve', target: 'esnext', module: 'esnext' } }),
    'oxc 去类型': (file) => oxcTransform(file.path, file.code, { typescript: {}, jsx: 'preserve', sourcemap: false }),
  };

  const measure = (run, files, label) => {
    for (const file of files.slice(0, 30)) run(file);
    const totals = [];
    for (let round = 0; round < 5; round++) {
      const start = performance.now();
      for (const file of files) run(file);
      totals.push(performance.now() - start);
    }
    return median(totals);
  };

  console.log('| 操作 | 真实组件库 ms/文件 | 全部 ms | 生成组件库 ms/文件 |');
  console.log('| --- | --- | --- | --- |');
  const results = {};
  for (const [label, run] of Object.entries(tasks)) {
    try {
      const real = measure(run, realFiles);
      const generated = measure(run, generatedFiles);
      results[label] = real / realFiles.length;
      console.log(`| ${label} | ${(real / realFiles.length).toFixed(3)} | ${real.toFixed(0)} | ${(generated / generatedFiles.length).toFixed(3)} |`);
    } catch (error) {
      console.log(`| ${label} | 失败：${String(error.message).slice(0, 100)} | | |`);
    }
  }

  // 现在的原型编译器（Babel 全流程），只有生成组件库能编（真实组件库还是 Vue 写法）
  const compileTimes = [];
  for (let round = 0; round < 4; round++) {
    const start = performance.now();
    for (const file of generatedFiles) await compile(file.code, file.path, { hot: '/x' });
    compileTimes.push(performance.now() - start);
  }
  const compileMs = median(compileTimes.slice(1)) / generatedFiles.length;
  console.log(`\n原型编译器（Babel 全流程：解析、遍历改写、生成、source map）：${compileMs.toFixed(2)} ms/文件`);

  // 真实 tsx 里语法树的规模
  const sample = realFiles[Math.floor(realFiles.length / 2)];
  const retained = tsApi.createSourceFile(sample.path, sample.code);
  console.log(`info RetainedSourceFile 的字段：${Object.keys(retained).join(', ')}；原型方法：${Object.getOwnPropertyNames(Object.getPrototypeOf(retained)).join(', ')}`);
  const rootFile = retained.sourceFile;
  console.log(`info 样本 ${sample.code.length} 字符，TS 节点 ${walkTs(rootFile)}，Babel 节点 ${countBabel(babelParse(sample.code, babelOptions(sample.path)))}`);
  // printer：改写后能不能打印回代码
  try {
    const printed = tsApi.printer.printNode(rootFile, rootFile);
    console.log(`info printer.printNode 打印整个文件：${typeof printed === 'string' ? printed.length + ' 字符' : typeof printed}`);
  } catch (error) {
    console.log(`info printer.printNode 失败：${String(error.message).slice(0, 160)}`);
  }
  retained.dispose();

  // 启动成本
  const startApi = performance.now();
  const fresh = new API();
  fresh.transpileModule('const a: number = 1;', { fileName: 'a.ts' });
  console.log(`info 新建 API（启动 tsc 子进程）到第一次返回：${(performance.now() - startApi).toFixed(0)} ms`);
  fresh.close();

  // 建程序 + 检查器查询：编译器要借类型信息时的代价
  const programStart = performance.now();
  const { options } = tsApi.parseConfigFile(join(UI, 'tsconfig.json').replaceAll('\\', '/'));
  const entry = `${UI}/src/base/Button.tsx`;
  const program = tsApi.createProgram([entry], options);
  const buildMs = performance.now() - programStart;
  const { checker } = program.getProject();
  const source = program.getSourceFile(entry);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const queryStart = performance.now();
  const exportsList = checker.getExportsOfModule(moduleSymbol);
  const queryMs = performance.now() - queryStart;
  const roundStart = performance.now();
  const rounds = 200;
  for (let i = 0; i < rounds; i++) checker.getSymbolAtLocation(source);
  const roundMs = (performance.now() - roundStart) / rounds;
  console.log(`info 从 Button.tsx 建程序：${buildMs.toFixed(0)} ms；取导出 ${exportsList.length} 个：${queryMs.toFixed(1)} ms；一次检查器往返：${roundMs.toFixed(3)} ms`);
  program.getProject().dispose?.();
  tsApi.close();
}

if (section('lsp')) {
  console.log('\n== 语言服务（tsc --lsp，vue-tsx-pro/packages/ui）==');
  for (const [name, bin] of Object.entries(BINS)) {
    if (name === 'TS 6.0.3') continue;
    const child = spawn(process.execPath, [bin, '--lsp', '--stdio'], { cwd: UI, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = Buffer.alloc(0);
    const pending = new Map();
    child.stdout.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      for (;;) {
        const header = buffer.indexOf('\r\n\r\n');
        if (header < 0) return;
        const length = Number(buffer.subarray(0, header).toString().match(/Content-Length: (\d+)/)?.[1]);
        if (buffer.length < header + 4 + length) return;
        const message = JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString());
        buffer = buffer.subarray(header + 4 + length);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        } else if (message.id !== undefined && message.method) {
          send({ jsonrpc: '2.0', id: message.id, result: null });
        }
      }
    });
    const send = (message) => {
      const text = JSON.stringify(message);
      child.stdin.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
    };
    let nextId = 1;
    const request = (method, params) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        send({ jsonrpc: '2.0', id, method, params });
      });
    const file = `${UI}/src/base/Button.tsx`;
    const uri = pathToFileURL(file).href;
    const text = readFileSync(file, 'utf8');
    const line = text.split('\n').findIndex((item) => item.includes('useDelayedLoading(() => loading)'));
    const character = text.split('\n')[line].indexOf('useDelayedLoading') + 3;
    const t0 = performance.now();
    await request('initialize', { processId: process.pid, rootUri: pathToFileURL(UI).href, capabilities: { textDocument: { hover: { contentFormat: ['markdown'] } } }, workspaceFolders: [{ uri: pathToFileURL(UI).href, name: 'ui' }] });
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    const t1 = performance.now();
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } } });
    const firstHover = await request('textDocument/hover', { textDocument: { uri }, position: { line, character } });
    const t2 = performance.now();
    const times = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await request('textDocument/hover', { textDocument: { uri }, position: { line, character } });
      times.push(performance.now() - start);
    }
    const defStart = performance.now();
    const definition = await request('textDocument/definition', { textDocument: { uri }, position: { line, character } });
    const defMs = performance.now() - defStart;
    const completeStart = performance.now();
    const completion = await request('textDocument/completion', { textDocument: { uri }, position: { line, character } });
    const completeMs = performance.now() - completeStart;
    // 改一个字符，诊断回来的时间
    console.log(`${name}：初始化 ${(t1 - t0).toFixed(0)} ms；打开文件到第一次悬停 ${(t2 - t1).toFixed(0)} ms（${firstHover.result ? '有结果' : '无结果'}）；再次悬停 ${median(times).toFixed(1)} ms；跳转定义 ${defMs.toFixed(1)} ms（${definition.result ? '有结果' : '无结果'}）；补全 ${completeMs.toFixed(1)} ms（${completion.result?.items?.length ?? completion.result?.length ?? 0} 项）`);
    await request('shutdown', null).catch(() => {});
    child.kill();
  }
}
