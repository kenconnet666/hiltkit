// 第 5、6 条：补全实测（typescript6 的语言服务）。用内存里的虚拟文件，在 | 处取补全候选。
// 用法：node ls-complete.mjs
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript6');
const root = process.cwd();
const cfg = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const virtual = path.join(root, 'cases/_virtual.tsx');
let content = '';
let version = 0;
const host = {
  getCompilationSettings: () => cfg.options,
  getScriptFileNames: () => [...cfg.fileNames, virtual],
  getScriptVersion: (f) => (path.normalize(f) === path.normalize(virtual) ? String(version) : '0'),
  getScriptSnapshot: (f) =>
    path.normalize(f) === path.normalize(virtual)
      ? ts.ScriptSnapshot.fromString(content)
      : ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)) : undefined,
  getCurrentDirectory: () => root,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: (f) => path.normalize(f) === path.normalize(virtual) || ts.sys.fileExists(f),
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());

const prelude = `import { css, type PartProps, type Bindable } from 'exp06';
const styles = css.create({ root: { display: 'flex' } });
const button = css.recipe({ parts: ['root', 'icon'], variants: { size: { sm: {}, md: {} } } });
interface SelectProps<T> extends Bindable<'value', T> { options: T[] }
declare const Select: <T,>(p: SelectProps<T>) => JSX.Element;
`;

function complete(label, body, filter = () => true, max = 14) {
  content = prelude + body;
  version++;
  const pos = content.lastIndexOf('|');
  content = content.slice(0, pos) + content.slice(pos + 1);
  const info = service.getCompletionsAtPosition(virtual, pos, { includeCompletionsForModuleExports: false, includeCompletionsWithInsertText: true });
  const names = (info?.entries ?? []).map((e) => e.name).filter(filter);
  console.log(`\n[${label}]\n  共 ${info?.entries.length ?? 0} 项；筛选后 ${names.length}：${names.slice(0, max).join(', ')}${names.length > max ? ' …' : ''}`);
}
const startsUnderscore = (n) => n.startsWith('_') || n.startsWith("'_") || n.startsWith('"_');

complete('条件别名：{ color: { default, _| } }', "const a = <div sx={{ color: { default: '_text', _| } }} />;", startsUnderscore);
complete('条件别名带前缀 _se', "const a = <div sx={{ color: { default: '_text', _se| } }} />;", () => true);
complete("padding 的 token：padding: '|'", "const a = <div sx={{ padding: '|' }} />;", startsUnderscore, 20);
complete("color 的 token：color: '|'", "const a = <div sx={{ color: '|' }} />;", startsUnderscore, 20);
complete("fontSize 的 token", "const a = <div sx={{ fontSize: '|' }} />;", startsUnderscore, 20);
complete("display 的值（csstype 关键字）", "const a = <div sx={{ display: '|' }} />;", () => true, 6);
complete('属性名：{ pad| }', "const a = <div sx={{ pad| }} />;", (n) => n.startsWith('pad'));
complete('sx 数组里的属性名', "const a = <div sx={[styles.root, { margin| }]} />;", (n) => n.startsWith('margin'), 6);
complete("recipe 的部件名：base: { | }", "css.recipe({ parts: ['root', 'icon'], base: { | } });", () => true);
complete("recipe 的档位调用：button({ size: '|' })", "button({ size: '|' });", () => true);
complete('recipe 的档位名：button({ | })', "button({ | });", () => true);
complete("input type 之后的绑定属性：<input type=\"checkbox\" _|", '<input type="checkbox" _| />;', startsUnderscore);
complete('input 默认（text）的绑定属性', '<input _| />;', startsUnderscore);
complete('input type="number"', '<input type="number" _| />;', startsUnderscore);
complete('div 上的 _', '<div _| />;', startsUnderscore);
complete('details 上的 _', '<details _| />;', startsUnderscore);
complete('组件 Select 上的 _ / on', '<Select _| options={[]} />;', (n) => startsUnderscore(n) || n.startsWith('on'), 8);
complete('Select 的回调', '<Select onValue| options={[]} />;', () => true);
complete('onClick 补全', '<button onCl| />;', () => true);

complete('StyleObject 直接标注：display', "import type { StyleObject } from 'exp06/styles';\nconst o: StyleObject = { display: '|' };", () => true, 6);
complete('StyleObject 直接标注：position', "import type { StyleObject } from 'exp06/styles';\nconst o: StyleObject = { position: '|' };", () => true, 6);
complete('css.create 里的 position', "css.create({ a: { position: '|' } });", () => true, 6);

complete('小实验 1：字面量 | 模板', "const x: 'flex' | 'grid' | `a${string}` = '|';", () => true, 6);
complete('小实验 2：字面量 | (模板 & {})', "const x: 'flex' | 'grid' | (`a${string}` & {}) = '|';", () => true, 6);
complete('小实验 3：字面量 | string & {}', "const x: 'flex' | 'grid' | (string & {}) = '|';", () => true, 6);
complete('小实验 4：Display 原型', "import type * as CSS from 'csstype';\nconst x: CSS.Property.Display = '|';", () => true, 6);
complete('小实验 5：StyleObject[display] 单独', "import type { StyleObject } from 'exp06/styles';\nconst x: NonNullable<StyleObject['display']> = '|';", () => true, 6);

const NT = "`${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'|'i'|'j'|'k'|'l'|'m'|'n'|'o'|'p'|'q'|'r'|'s'|'t'|'u'|'v'|'w'|'x'|'y'|'z'}${string}`";
complete('小实验 6：26 个首字母模板 | 关键字(f 开头 flex)', `type NT = ${NT};\nconst x: 'inherit' | 'flex' | NT = '|';`, () => true, 6);
complete('小实验 7：同上 & {}', `type NT = ${NT};\nconst x: 'inherit' | 'flex' | (NT & {}) = '|';`, () => true, 6);
complete('小实验 8：对象属性里', `type NT = ${NT};\nconst x: { d?: 'inherit' | 'flex' | NT } = { d: '|' };`, () => true, 6);

const imp = "import type { StyleValue } from 'exp06/styles';\n";
complete('实验 9：StyleValue<flex | string&{}>', imp + "const x: StyleValue<'flex' | 'grid' | (string & {})> = '|';", () => true, 6);
complete('实验 10：StyleValue<flex | grid>', imp + "const x: StyleValue<'flex' | 'grid'> = '|';", () => true, 6);
complete('实验 11：数组或值', "const x: ('flex' | (string & {})) | ReadonlyArray<'flex' | (string & {})> = '|';", () => true, 6);
complete('实验 12：值 | 对象', "const x: ('flex' | (string & {})) | { default: string } = '|';", () => true, 6);
