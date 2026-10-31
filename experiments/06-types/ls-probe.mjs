// 第 3 条：用 TS 语言服务（typescript6 = 6.0.3，JS 版，带完整 LanguageService API）实测编辑器体验。
// 用法：node ls-probe.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript6');
console.log('TypeScript (language service):', ts.version);

const root = process.cwd();
const cfgPath = path.join(root, 'tsconfig.json');
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => console.error(d.messageText),
});
const files = new Map(cfg.fileNames.map((f) => [path.normalize(f), { version: 0 }]));
const host = {
  getCompilationSettings: () => cfg.options,
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (f) => String(files.get(path.normalize(f))?.version ?? 0),
  getScriptSnapshot: (f) => (ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)) : undefined),
  getCurrentDirectory: () => root,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());
const rel = (f) => path.relative(root, f).replaceAll('\\', '/');

const target = path.join(root, 'cases/03b-ls-targets.tsx');
const text = readFileSync(target, 'utf8');
const at = (needle, nth = 0) => {
  let idx = -1;
  for (let i = 0; i <= nth; i++) idx = text.indexOf(needle, idx + 1);
  if (idx < 0) throw new Error('找不到 ' + needle);
  return idx;
};
const lineOf = (pos) => text.slice(0, pos).split('\n').length;

function showDef(label, pos) {
  const defs = service.getDefinitionAtPosition(target, pos);
  const where = (defs ?? []).map((d) => `${rel(d.fileName)}:${lineOf0(d)}  "${d.name}"`);
  console.log(`  跳转 ${label}:`, where.length ? where.join(' | ') : '(无结果)');
}
function lineOf0(d) {
  const t = ts.sys.readFile(d.fileName);
  return t.slice(0, d.textSpan.start).split('\n').length;
}
function showInfo(label, pos) {
  const info = service.getQuickInfoAtPosition(target, pos);
  if (!info) return console.log(`  悬停 ${label}: (无)`);
  const sig = ts.displayPartsToString(info.displayParts);
  const doc = ts.displayPartsToString(info.documentation);
  console.log(`  悬停 ${label}: ${sig.slice(0, 90)}${doc ? `\n        文档: ${doc}` : '\n        文档: (无)'}`);
}
function showRename(label, pos) {
  const info = service.getRenameInfo(target, pos, { allowRenameOfImportPath: false });
  if (!info.canRename) return console.log(`  重命名 ${label}: 不可重命名（${info.localizedErrorMessage}）`);
  const locs = service.findRenameLocations(target, pos, false, false) ?? [];
  const lines = locs.map((l) => rel(l.fileName).replace(/^cases\//, '') + ":" + lineOf0(l));
  console.log(`  重命名 ${label}: 可重命名，命中 ${locs.length} 处，行 ${lines.join(',')}`);
}
function showRefs(label, pos) {
  const refs = service.findReferences(target, pos) ?? [];
  const n = refs.reduce((a, r) => a + r.references.length, 0);
  console.log(`  引用 ${label}: ${n} 处`);
}

for (const v of ['A', 'B', 'C', 'D']) {
  console.log(`\n==== 写法 ${v} ====`);
  const tag = `<Select${v} _value`;
  const usageValue = at(tag) + `<Select${v} `.length;
  const usageChange = at(`<Select${v} _value={v} onValueChange`) + `<Select${v} _value={v} `.length;
  const sig = v === "D" ? `({ _value: value, onValueChange }: PropsD` : `({ _value: value, onValueChange, label }: Props${v}`;
  const destruct = at(sig) + 3;
  const destructChange = at(sig) + `({ _value: value, `.length;
  showDef('使用处 _value', usageValue);
  showDef('使用处 onValueChange', usageChange);
  showDef('解构处 _value', destruct);
  showDef('解构处 onValueChange', destructChange);
  showInfo('使用处 _value', usageValue);
  showInfo('使用处 onValueChange', usageChange);
  showRename('使用处 _value', usageValue);
  showRename('使用处 onValueChange', usageChange);
  showRefs('使用处 _value', usageValue);
  showRefs('使用处 onValueChange', usageChange);
}

// 手写声明处的重命名：B 的 _value 在接口里，改名要同时改到解构与使用处
{
  console.log('\n==== 从声明处重命名（B：手写属性）====');
  const decl = at('_value?: T;\n  /** 值变化时调用（B）');
  showRename('B 接口里的 _value', decl);
  showRefs('B 接口里的 _value', decl);
  const declCb = at('onValueChange?: (next: T) => void;\n  label');
  showRename('B 接口里的 onValueChange', declCb);
}

// 补全：<SelectA _ 里列出 _value
{
  console.log('\n==== 补全 ====');
  const probe = text.replace('<SelectA _value={v}', '<SelectA _v');
  // 临时替换文件内容（版本号 +1）
  const f = files.get(path.normalize(target));
  const orig = host.getScriptSnapshot;
  host.getScriptSnapshot = (name) =>
    path.normalize(name) === path.normalize(target) ? ts.ScriptSnapshot.fromString(probe) : orig(name);
  f.version++;
  const pos = probe.indexOf('<SelectA _v') + '<SelectA _v'.length;
  const comp = service.getCompletionsAtPosition(target, pos, {});
  const names = (comp?.entries ?? []).filter((e) => e.name.startsWith('_') || e.name.startsWith('on')).map((e) => e.name);
  console.log('  <SelectA _v| 候选里以 _ / on 开头的前 12 个:', names.slice(0, 12).join(', '));
  const entry = service.getCompletionEntryDetails(target, pos, '_value', {}, undefined, {}, undefined);
  console.log('  _value 的补全详情:', entry ? ts.displayPartsToString(entry.displayParts) : '(无)');
}
