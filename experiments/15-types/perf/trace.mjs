// 分析 tsc --generateTrace 的输出：按文件类别汇总检查耗时，列出自身耗时最长的节点（定位最贵的写法/类型）。
// 用法：node perf/trace.mjs <trace目录> [--top=15]   先用 --singleThreaded --generateTrace 生成（多线程的耗时会混在各 checker 里）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.argv[2]);
const top = Number((process.argv.find((a) => a.startsWith('--top=')) ?? '--top=15').slice(6));
const raw = JSON.parse(readFileSync(`${dir}/trace.json`, 'utf8'));
const events = raw.traceEvents ?? raw;
const KIND = { 215: 'ObjectLiteral', 212: 'ArrowFunction', 262: 'VariableDeclaration', 285: 'JsxOpeningElement', 284: 'JsxSelfClosingElement', 283: 'JsxElement', 214: 'CallExpression' };

// B/E 配对，算自身耗时（减去子事件）
const stack = [];
const spans = [];
for (const e of events) {
  if (e.ph === 'B') stack.push({ e, child: 0 });
  else if (e.ph === 'E') {
    const open = stack.pop();
    if (!open) continue;
    const dur = e.ts - open.e.ts;
    spans.push({ name: open.e.name, args: open.e.args ?? {}, dur, self: dur - open.child });
    if (stack.length) stack[stack.length - 1].child += dur;
  } else if (e.ph === 'X') spans.push({ name: e.name, args: e.args ?? {}, dur: e.dur, self: e.dur });
}
const fileOf = (path = '') => path.replace(/\\/g, '/').replace(/.*\/(?=[^/]+$)/, '');
const group = (path = '') => {
  const f = fileOf(path);
  if (/^c\d{4}\.tsx$/.test(f)) return 'cNNNN.tsx（组件）';
  if (/^app\d+\.tsx$/.test(f)) return 'appN.tsx（使用方）';
  if (/^lib\./.test(f)) return 'lib.*.d.ts';
  return f;
};
const sums = new Map();
for (const s of spans) {
  if (s.name !== 'checkSourceFile') continue;
  const key = group(s.args.path);
  const cur = sums.get(key) ?? { ms: 0, n: 0 };
  cur.ms += s.dur / 1000;
  cur.n++;
  sums.set(key, cur);
}
console.log('== checkSourceFile 按类别 ==');
for (const [key, v] of [...sums].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10)) console.log(`${v.ms.toFixed(0).padStart(7)} ms  ×${String(v.n).padEnd(4)} ${key}`);

console.log(`\n== 自身耗时最长的 ${top} 个检查节点 ==`);
const nodes = spans.filter((s) => /^check(Expression|VariableDeclaration|DeferredNode|SourceElement)/.test(s.name) && s.args.path).sort((a, b) => b.self - a.self);
for (const s of nodes.slice(0, top)) console.log(`${(s.self / 1000).toFixed(1).padStart(7)} ms  ${s.name} ${KIND[s.args.kind] ?? s.args.kind} ${fileOf(s.args.path)}:${s.args.pos}`);

console.log('\n== 类型关系检查（structuredTypeRelatedTo）累计 ==');
const rel = spans.filter((s) => s.name === 'structuredTypeRelatedTo');
console.log(`${rel.length} 次，累计自身 ${(rel.reduce((a, s) => a + s.self, 0) / 1000).toFixed(0)} ms；最长 5 个：`);
for (const s of rel.sort((a, b) => b.self - a.self).slice(0, 5)) console.log(`  ${(s.self / 1000).toFixed(1)} ms  source=${s.args.sourceId} target=${s.args.targetId}`);

// ---- 把组件文件里的节点按源码片段归并（所有生成的组件结构相同，同一片段累加）----
if (process.argv.includes('--snippets')) {
  const cache = new Map();
  const text = (path) => cache.get(path) ?? (cache.set(path, readFileSync(path, 'utf8')), cache.get(path));
  const buckets = new Map();
  for (const s of nodes) {
    const path = s.args.path;
    if (!/c\d{4}\.tsx$/.test(path)) continue;
    const source = text(path);
    const snippet = source.slice(s.args.pos, s.args.pos + 44).replace(/\s+/g, ' ').replace(/\d+/g, 'N').trim();
    const key = `${s.name} ${KIND[s.args.kind] ?? s.args.kind} ${snippet}`;
    const cur = buckets.get(key) ?? { ms: 0, n: 0 };
    cur.ms += s.self / 1000;
    cur.n++;
    buckets.set(key, cur);
  }
  console.log('\n== 组件文件里按片段归并的自身耗时 ==');
  for (const [key, v] of [...buckets].sort((a, b) => b[1].ms - a[1].ms).slice(0, top)) console.log(`${v.ms.toFixed(0).padStart(6)} ms ×${String(v.n).padEnd(4)} ${key}`);
}
