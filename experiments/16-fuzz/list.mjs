// 方向 2：列表。For 带 key / 不带 key × 深代理原地改（let / const）× 周围有没有兄弟节点，
// 随机插入、删除、移动、替换、排序、清空、整体替换。每步断言：DOM 顺序与内容等于数据；同身份的行节点不变；
// 被删行的 onCleanup 恰好一次；DOM 改动不超过“删 + 增 + (留下 - 最长递增子序列)”；行内的响应式绑定还活着；卸载后清理齐全。
import { fileURLToPath } from 'node:url';
import { makeRng } from './lib/rng.mjs';
import { bundleApp } from './lib/build-app.mjs';
import { launch, openPage } from './lib/page.mjs';

const applySource = (letState) => `
  const apply = (op: any) => {
    switch (op.t) {
      case 'push': items.push(...op.rows); break;
      case 'unshift': items.unshift(...op.rows); break;
      case 'pop': items.pop(); break;
      case 'shift': items.shift(); break;
      case 'splice': items.splice(op.at, op.del, ...op.rows); break;
      case 'sortN': items.sort((a: any, b: any) => op.dir * (a.n - b.n)); break;
      case 'sortLabel': items.sort((a: any, b: any) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)); break;
      case 'reverse': items.reverse(); break;
      case 'set': items[op.at] = op.row; break;
      case 'swap': { const x = items[op.a]; const y = items[op.b]; items[op.a] = y; items[op.b] = x; break; }
      case 'move': { const [row] = items.splice(op.from, 1); items.splice(op.to, 0, row); break; }
      case 'truncate': items.length = op.len; break;
      case 'label': items[op.at].label = op.label; break;
      case 'clear': items.length = 0; break;
      ${
        letState
          ? `case 'replace': {
        const old = [...items];
        items = op.rows.map((entry: any) => {
          if (entry.keep === undefined) return entry;
          const row = old[entry.keep];
          if (entry.label !== undefined) row.label = entry.label;
          return row;
        });
        break;
      }`
          : ''
      }
    }
  };`;

function variantOf({ keyed, letState, siblings }) {
  const name = `L_${keyed ? 'keyed' : 'plain'}_${letState ? 'let' : 'const'}_${siblings ? 'sib' : 'sole'}`;
  const source = `
export const ${name} = _component(() => {
  ${letState ? 'let' : 'const'} items = _state<any[]>([]);
  ${applySource(letState)}
  (globalThis as any).__list = { apply };
  return (
    <ul id="list">
      ${siblings ? '<li class="head">H</li>' : ''}
      {items.map((it: any, i: number) => (
        <li class="row" ${keyed ? 'key={it.id}' : ''} data-id={it.id} data-uid={it.uid}>
          <span class="t">{it.label}</span>
          <i class="i">{i}</i>
          <Probe name={it.${keyed ? 'id' : 'uid'}} />
        </li>
      ))}
      ${siblings ? '<li class="foot">F</li>' : ''}
    </ul>
  );
});`;
  return { name, keyed, letState, siblings, source };
}
const VARIANTS = [];
for (const keyed of [true, false]) for (const letState of [true, false]) for (const siblings of [false, true]) VARIANTS.push(variantOf({ keyed, letState, siblings }));

const APP = `
import { onCleanup } from '@hilt/runtime';
const Probe = _component(({ name }: any) => {
  const mine = String(name);
  onCleanup(() => (globalThis as any).__log.cleanups.push(mine));
  return <b class="p" />;
});
${VARIANTS.map((variant) => variant.source).join('\n')}
`;

/** 生成器自己的模拟（和 list-page.js 的 applyModel 同义，只为了生成合法的下标和不重复的 id） */
function applySim(model, op) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  switch (op.t) {
    case 'push': model.push(...clone(op.rows)); break;
    case 'unshift': model.unshift(...clone(op.rows)); break;
    case 'pop': model.pop(); break;
    case 'shift': model.shift(); break;
    case 'splice': model.splice(op.at, op.del, ...clone(op.rows)); break;
    case 'sortN': model.sort((a, b) => op.dir * (a.n - b.n)); break;
    case 'sortLabel': model.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)); break;
    case 'reverse': model.reverse(); break;
    case 'set': model[op.at] = clone(op.row); break;
    case 'swap': [model[op.a], model[op.b]] = [model[op.b], model[op.a]]; break;
    case 'move': { const [row] = model.splice(op.from, 1); model.splice(op.to, 0, row); break; }
    case 'truncate': model.length = op.len; break;
    case 'label': model[op.at].label = op.label; break;
    case 'clear': model.length = 0; break;
    case 'replace': {
      const old = [...model];
      model.length = 0;
      for (const entry of op.rows) {
        if (entry.keep !== undefined) {
          if (entry.label !== undefined) old[entry.keep].label = entry.label;
          model.push(old[entry.keep]);
        } else model.push(clone(entry));
      }
      break;
    }
  }
}

export function generate(seed) {
  const rng = makeRng(seed);
  const variant = rng.pick(VARIANTS);
  const state = { model: [], uid: 1 };
  const idPool = 14;
  const newRow = (taken) => {
    const free = Array.from({ length: idPool }, (_, i) => i).filter((id) => !taken.has(id));
    if (!free.length) return undefined;
    const id = rng.pick(free);
    taken.add(id);
    return { uid: state.uid++, id, label: `r${rng.int(12)}`, n: rng.int(30) };
  };
  const ids = (model) => new Set(model.map((row) => row.id));
  const steps = [];
  for (let s = rng.range(4, 12); s > 0; s--) {
    const ops = [];
    for (let k = rng.range(1, 3); k > 0; k--) {
      const model = state.model;
      const len = model.length;
      const options = [['push', 4], ['unshift', 2], ['splice', 4], ['label', 3], ['set', 2], ['reverse', 1], ['sortN', 1], ['sortLabel', 1], ['clear', 0.5]];
      if (len) options.push(['pop', 2], ['shift', 2], ['swap', 3], ['move', 3], ['truncate', 1]);
      if (variant.letState) options.push(['replace', 3]);
      const t = rng.weighted(options);
      let op;
      switch (t) {
        case 'push':
        case 'unshift': {
          const taken = ids(model);
          const rows = Array.from({ length: rng.range(1, 3) }, () => newRow(taken)).filter(Boolean);
          if (!rows.length) continue;
          op = { t, rows };
          break;
        }
        case 'splice': {
          const at = rng.range(0, len);
          const del = rng.range(0, Math.min(3, len - at));
          const rest = ids(model);
          for (const row of model.slice(at, at + del)) rest.delete(row.id);
          const rows = Array.from({ length: rng.range(0, 2) }, () => newRow(rest)).filter(Boolean);
          op = { t, at, del, rows };
          break;
        }
        case 'label':
          if (!len) continue;
          op = { t, at: rng.int(len), label: `e${rng.int(30)}` };
          break;
        case 'set': {
          if (!len) continue;
          const at = rng.int(len);
          const rest = ids(model);
          rest.delete(model[at].id);
          // 一半的概率沿用同一个 id（keyed 复用行，plain 换新行）
          const row = rng.chance(0.5) ? { uid: state.uid++, id: model[at].id, label: `s${rng.int(9)}`, n: rng.int(30) } : newRow(rest);
          if (!row) continue;
          op = { t, at, row };
          break;
        }
        case 'swap':
          if (len < 2) continue;
          op = { t, a: rng.int(len), b: rng.int(len) };
          break;
        case 'move':
          op = { t, from: rng.int(len), to: rng.int(len) };
          break;
        case 'truncate':
          op = { t, len: rng.int(len) };
          break;
        case 'sortN':
          op = { t, dir: rng.chance(0.5) ? 1 : -1 };
          break;
        case 'replace': {
          // 保留一部分旧对象（filter / 重排），穿插新对象；新对象的 id 可以和被丢掉的旧 id 相同
          const order = rng.shuffle(model.map((_, i) => i)).slice(0, rng.range(0, len));
          const keep = rng.chance(0.5) ? order.sort((a, b) => a - b) : order;
          const taken = new Set(keep.map((i) => model[i].id));
          const rows = [];
          for (const i of keep) {
            rows.push(rng.chance(0.2) ? { keep: i, label: `k${rng.int(9)}` } : { keep: i });
            if (rng.chance(0.25)) {
              const row = newRow(taken);
              if (row) rows.push(row);
            }
          }
          for (let extra = rng.range(0, 3); extra > 0; extra--) {
            const row = newRow(taken);
            if (row) rows.splice(rng.range(0, rows.length), 0, row);
          }
          op = { t, rows };
          break;
        }
        default:
          op = { t };
      }
      ops.push(op);
      applySim(state.model, op);
    }
    steps.push({ ops, flush: rng.chance(0.15) ? 'microtask' : 'sync' });
  }
  return { variant: variant.name, steps };
}

let browser;
let page;
const run = (spec) => page.evaluate((input) => window.listFuzz.runList(input), spec);
const kindOf = (failure) => failure?.kind.replace(/^step\d+:/, '');
export const direction = {
  name: 'list',
  title: '列表',
  defaultSeeds: 300,
  shrinkBudget: 150,
  async setup() {
    const entry = `import ${JSON.stringify(fileURLToPath(new URL('./list-page.js', import.meta.url)))};`;
    const code = await bundleApp({ entry, app: APP, generate: 'client' });
    browser = await launch();
    page = await openPage(browser, code);
  },
  async teardown() {
    await browser?.close();
  },
  async check(seed) {
    const spec = generate(seed);
    const failures = await run(spec);
    if (page.errors.length) failures.push({ kind: 'page-error', detail: page.errors.splice(0).join(' | ') });
    if (!failures.length) return { ok: true };
    return { ok: false, kind: kindOf(failures[0]), message: JSON.stringify(failures[0].detail), caseData: spec };
  },
  async recheck(spec) {
    const failures = await run(spec);
    page.errors.length = 0;
    return kindOf(failures[0]);
  },
};
