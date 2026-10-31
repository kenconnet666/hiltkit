// 方向 1：内核图。随机 DAG（signal、computed、三种 effect、动态依赖分支、嵌套、onCleanup、untrack、dispose），
// 随机批量写入后 flush，和“不看调度器、只看语义”的参考模型比：
//   - computed 的值（flush 前拉取、flush 后）都等于从头算的结果
//   - 每次 effect 运行读到的值都是最终状态（无毛刺）
//   - 重跑次数 = 上一次运行里“追踪过的依赖”有没有变（外层重跑则内层作废重建）
//   - 清理次数 = 已结束的运行次数（重跑一次清一次，销毁清最后一次），销毁后不再跑
//   - 同一轮里 renderEffect 的重跑都排在用户 effect 前面
// 用例是纯 JSON（可最小化）：{ nodes, roots, steps, writers }。
// FUZZ_REACTIVE：换成被故意改坏的内核副本，验证这套检查真的抓得到问题（变异测试）
const R = await import(process.env.FUZZ_REACTIVE ?? '../03-publish/packages/runtime/reactive.js');
import { makeRng } from './lib/rng.mjs';

// ---------------------------------------------------------------- 表达式
/** 表达式只读节点：e = n（读节点）| c（常量）| sum | mod | if（test 为偶数取 a 否则取 b，产生动态依赖） */
export function evalExpr(expr, read) {
  switch (expr?.e) {
    case 'n':
      return read(expr.id);
    case 'sum': {
      let total = 0;
      for (const arg of expr.args) total += evalExpr(arg, read);
      return total;
    }
    case 'mod': {
      const value = evalExpr(expr.arg, read);
      const k = expr.k > 0 ? expr.k : 1;
      return ((value % k) + k) % k;
    }
    case 'if':
      return evalExpr(evalExpr(expr.test, read) % 2 === 0 ? expr.a : expr.b, read);
    default:
      return expr?.v ?? 0;
  }
}

// ---------------------------------------------------------------- 生成
function genExpr(rng, below, depth) {
  const leaf = () => (below > 0 && !rng.chance(0.1) ? { e: 'n', id: rng.chance(0.5) ? below - 1 - rng.int(Math.min(below, 3)) : rng.int(below) } : { e: 'c', v: rng.int(3) });
  if (depth <= 0 || rng.chance(0.3)) return leaf();
  switch (rng.weighted([['sum', 3], ['mod', 3], ['if', 4]])) {
    case 'sum':
      return { e: 'sum', args: Array.from({ length: rng.range(2, 3) }, () => genExpr(rng, below, depth - 1)) };
    case 'mod':
      return { e: 'mod', k: rng.range(2, 3), arg: genExpr(rng, below, depth - 1) };
    default:
      return { e: 'if', test: genExpr(rng, below, depth - 1), a: genExpr(rng, below, depth - 1), b: genExpr(rng, below, depth - 1) };
  }
}

export function generate(seed, { mixed = false } = {}) {
  const rng = makeRng(seed);
  const writers = rng.chance(0.25);
  const signalCount = rng.range(2, 6);
  const nodes = Array.from({ length: signalCount }, () => ({ kind: 'signal', init: rng.int(3) }));
  const computedCount = rng.range(1, 8);
  const outputs = [];
  for (let i = 0; i < computedCount; i++) {
    if (writers && rng.chance(0.3)) {
      outputs.push(nodes.length);
      nodes.push({ kind: 'output', expr: genExpr(rng, nodes.length, 3) });
    } else {
      nodes.push({ kind: 'computed', expr: genExpr(rng, nodes.length, 3) });
    }
  }
  let defId = 0;
  const kinds = [['render', 3], ['effect', 3], ['user', 2]];
  const genDef = (parentKind, depth, plain) => {
    const kind = parentKind && !mixed && parentKind !== 'render' ? rng.pick(['effect', 'user']) : rng.weighted(kinds);
    const body = [];
    const count = rng.range(1, plain ? 4 : 2);
    for (let i = 0; i < count; i++) {
      const roll = rng.next();
      if (roll < 0.45 || !plain) body.push({ s: 'read', e: genExpr(rng, nodes.length, 2), tracked: plain ? !rng.chance(0.25) : true });
      else if (roll < 0.6 && depth > 0) body.push({ s: 'when', e: genExpr(rng, nodes.length, 1), then: [{ s: 'child', def: genDef(kind, depth - 1, plain) }, ...(rng.chance(0.3) ? [{ s: 'read', e: genExpr(rng, nodes.length, 1), tracked: true }] : [])] });
      else if (roll < 0.75 && depth > 0) body.push({ s: 'child', def: genDef(kind, depth - 1, plain) });
      else if (roll < 0.85) body.push({ s: 'cleanup' });
      else if (roll < 0.95) body.push({ s: 'untrack', body: [{ s: 'read', e: genExpr(rng, nodes.length, 1), tracked: false }] });
      else body.push({ s: 'read', e: genExpr(rng, nodes.length, 2), tracked: true });
    }
    return { id: defId++, kind, probe: !rng.chance(0.1), body };
  };
  const roots = [];
  for (let i = rng.range(1, 5); i > 0; i--) roots.push(genDef(undefined, writers ? 0 : 2, !writers));
  // 写入型：每个 output 节点配一个根 effect，无条件把表达式的值写进去
  for (const id of outputs) {
    const kind = rng.pick(['render', 'effect', 'user']);
    roots.push({ id: defId++, kind, probe: true, body: [{ s: 'read', e: { e: 'c', v: 0 }, tracked: true }, { s: 'write', out: id }] });
  }
  const steps = [];
  const sigCount = signalCount;
  for (let i = rng.range(3, 8); i > 0; i--) {
    const ops = [];
    for (let j = rng.range(0, 5); j > 0; j--) {
      const roll = rng.next();
      if (roll < 0.6) ops.push({ o: 'w', id: rng.int(sigCount), v: rng.int(3) });
      else if (roll < 0.75 && !writers) ops.push({ o: 'r', id: rng.int(nodes.length) });
      else if (roll < 0.9 && !writers) ops.push({ o: 'd', pick: rng.int(1000) });
      else if (!writers) ops.push({ o: 'stale', pick: rng.int(1000) });
    }
    // 拉取读放在最后：flush 前读 signal 会提交中间值，之后再写回原值，依赖方已被标脏（alien-signals 的取舍），不属于缺陷但没法用“值没变”来建模
    ops.sort((a, b) => (a.o === 'r') - (b.o === 'r'));
    steps.push({ ops, flush: rng.chance(0.2) ? 'microtask' : 'sync' });
  }
  return { nodes, roots, steps, writers };
}

// ---------------------------------------------------------------- 执行 + 参考模型
class Failure extends Error {
  constructor(kind, detail) {
    super(`${kind}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    this.kind = kind;
  }
}

/** 一个内核实例的真实侧：真实节点 + 运行日志 */
class Real {
  constructor(c, errors) {
    this.c = c;
    this.errors = errors;
    this.nodes = c.nodes.map((n, i) => this.make(n, i));
    this.instances = []; // 创建顺序
    this.log = []; // { t: 'run' | 'cleanup', inst, run, kind, flush }
    this.flushNo = 0;
    this.stops = [];
  }
  make(node, id) {
    if (node.kind === 'signal') return R.signal(node.init);
    if (node.kind === 'output') return R.signal(0);
    return R.computed(() => evalExpr(node.expr, (ref) => this.nodes[ref]?.value ?? 0));
  }
  read = (id, tracked, rec) => {
    const node = this.nodes[id];
    if (!node) return 0;
    const v = node.value;
    rec.reads.push({ id, v, tracked });
    return v;
  };
  create(def, parent) {
    const inst = { def, kind: def.kind, path: `${parent ? parent.path : ''}/${def.id}`, runs: 0, cleanups: 0, rec: undefined, recs: [], handle: undefined, createdFlush: this.flushNo, lineage: parent ? [...parent.lineage, [parent, parent.runs]] : [] };
    this.instances.push(inst);
    const fn = () => this.run(inst);
    if (def.kind === 'render') inst.handle = { node: R.renderEffect(fn) };
    else if (def.kind === 'effect') inst.handle = { stop: R.effect(fn) };
    else R.userEffect(fn);
    return inst;
  }
  run(inst) {
    const run = ++inst.runs;
    const rec = { reads: [], flush: this.flushNo, run };
    inst.rec = rec;
    inst.recs.push(rec);
    this.log.push({ t: 'run', inst, run, kind: inst.kind, flush: this.flushNo });
    if (inst.def.probe) R.onCleanup(() => this.cleaned(inst, run));
    this.exec(inst, inst.def.body, rec, true);
  }
  cleaned(inst, run) {
    inst.cleanups++;
    this.log.push({ t: 'cleanup', inst, run, flush: this.flushNo });
  }
  exec(inst, stmts, rec, tracked) {
    const read = (id) => this.read(id, tracked, rec);
    for (const stmt of stmts) {
      switch (stmt.s) {
        case 'read':
          if (tracked && stmt.tracked !== false) evalExpr(stmt.e, read);
          else R.untrack(() => evalExpr(stmt.e, (id) => this.read(id, false, rec)));
          break;
        case 'when':
          if (evalExpr(stmt.e, read) % 2 === 0) this.exec(inst, stmt.then, rec, tracked);
          break;
        case 'child':
          if (tracked) this.create(stmt.def, inst);
          else R.untrack(() => this.create(stmt.def, inst));
          break;
        case 'cleanup': {
          const run = inst.runs;
          rec.extra = (rec.extra ?? 0) + 1;
          R.onCleanup(() => this.cleaned(inst, run));
          break;
        }
        case 'untrack':
          R.untrack(() => this.exec(inst, stmt.body, rec, false));
          break;
        case 'write': {
          const out = this.c.nodes[stmt.out];
          if (out?.kind === 'output') this.nodes[stmt.out].value = evalExpr(out.expr, read);
          break;
        }
      }
    }
  }
}

/** 参考模型：只按语义推演，不碰调度器 */
class Model {
  constructor(c) {
    this.c = c;
    this.sig = c.nodes.map((n) => (n.kind === 'signal' ? n.init : 0));
    this.instances = [];
    this.roots = [];
    this.hasWriter = new Set();
    const scan = (stmts) => {
      for (const stmt of stmts) {
        if (stmt.s === 'write') this.hasWriter.add(stmt.out);
        if (stmt.then) scan(stmt.then);
        if (stmt.body) scan(stmt.body);
      }
    };
    for (const root of c.roots) scan(root.body);
  }
  /** 当前信号值下，所有节点的值（从头算，不缓存跨状态） */
  values() {
    const memo = new Map();
    const val = (id) => {
      if (memo.has(id)) return memo.get(id);
      const node = this.c.nodes[id];
      let v = 0;
      if (!node) v = 0;
      else if (node.kind === 'signal') v = this.sig[id];
      else if (node.kind === 'output') v = this.hasWriter.has(id) ? evalExpr(node.expr, val) : 0;
      else v = evalExpr(node.expr, val);
      memo.set(id, v);
      return v;
    };
    return val;
  }
  create(def, parent, val) {
    const mi = { def, path: `${parent ? parent.path : ''}/${def.id}`, runs: 0, finished: 0, extraRuns: [], children: new Map(), dead: false, reads: [], handle: false };
    this.instances.push(mi);
    this.run(mi, val);
    return mi;
  }
  /** 作废整棵子树：每个还没“结束”的运行记一次清理 */
  kill(mi) {
    if (mi.dead) return;
    mi.dead = true;
    for (const child of mi.children.values()) this.kill(child);
    mi.finished = mi.runs;
  }
  run(mi, val) {
    for (const child of mi.children.values()) this.kill(child);
    mi.children = new Map();
    mi.runs++;
    mi.finished = mi.runs - 1;
    const reads = [];
    mi.reads = reads;
    mi.extraRuns[mi.runs - 1] = 0;
    this.exec(mi, mi.def.body, reads, true, val);
  }
  exec(mi, stmts, reads, tracked, val) {
    const read = (id) => {
      if (!this.c.nodes[id]) return 0;
      const v = val(id);
      reads.push({ id, v, tracked });
      return v;
    };
    for (const stmt of stmts) {
      switch (stmt.s) {
        case 'read':
          evalExpr(stmt.e, tracked && stmt.tracked !== false ? read : (id) => (this.c.nodes[id] ? (reads.push({ id, v: val(id), tracked: false }), val(id)) : 0));
          break;
        case 'when':
          if (evalExpr(stmt.e, read) % 2 === 0) this.exec(mi, stmt.then, reads, tracked, val);
          break;
        case 'child':
          mi.children.set(stmt.def.id, this.create(stmt.def, mi, val));
          break;
        case 'cleanup':
          mi.extraRuns[mi.runs - 1] = (mi.extraRuns[mi.runs - 1] ?? 0) + 1;
          break;
        case 'untrack':
          this.exec(mi, stmt.body, reads, false, val);
          break;
        case 'write': {
          const out = this.c.nodes[stmt.out];
          if (out?.kind === 'output') evalExpr(out.expr, read);
          break;
        }
      }
    }
  }
  /** flush：外层先判断，外层重跑就不再看内层 */
  flush() {
    const val = this.values();
    const visit = (mi) => {
      if (mi.dead) return;
      const changed = mi.reads.some((r) => r.tracked && val(r.id) !== r.v);
      if (changed) this.run(mi, val);
      else for (const child of [...mi.children.values()]) visit(child);
    };
    for (const root of this.rootInstances) visit(root);
  }
  start() {
    const val = this.values();
    this.rootInstances = this.c.roots.map((def) => this.create(def, undefined, val));
  }
  expectedCleanups(mi) {
    let total = 0;
    for (let run = 0; run < mi.finished; run++) total += (mi.def.probe ? 1 : 0) + (mi.extraRuns[run] ?? 0);
    return total;
  }
}

/** 同一个 def 在同一条路径上先后创建的实例，按创建顺序一一对应 */
function byPath(list) {
  const map = new Map();
  for (const item of list) {
    if (!map.has(item.path)) map.set(item.path, []);
    map.get(item.path).push(item);
  }
  return map;
}

function verify(real, model, plain, flushStart) {
  const val = model.values();
  const cn = real.c.nodes;
  // computed、output 的值
  for (let id = 0; id < cn.length; id++) {
    if (cn[id].kind === 'signal') continue;
    const got = real.nodes[id].value;
    if (got !== val(id)) throw new Failure('node-value', { id, got, want: val(id) });
  }
  // 每次运行读到的值都是最终状态（写入型的中间态允许看到旧值，只查最后一次）
  for (const inst of real.instances) {
    const recs = plain ? inst.recs.filter((rec) => rec.flush >= flushStart) : inst.recs.slice(-1);
    for (const rec of recs) for (const r of rec.reads) if (r.v !== val(r.id)) throw new Failure(plain ? 'glitch' : 'final-read', { path: inst.path, run: rec.run, read: r, want: val(r.id) });
  }
  const realPaths = byPath(real.instances);
  const modelPaths = byPath(model.instances);
  const paths = new Set([...realPaths.keys(), ...modelPaths.keys()]);
  for (const path of paths) {
    const a = realPaths.get(path) ?? [];
    const b = modelPaths.get(path) ?? [];
    if (a.length !== b.length) throw new Failure('instance-count', { path, real: a.length, model: b.length });
    for (let i = 0; i < a.length; i++) {
      const inst = a[i];
      const mi = b[i];
      if (!plain) {
        if (!mi.dead && inst.rec && JSON.stringify(inst.rec.reads) !== JSON.stringify(mi.reads)) throw new Failure('final-reads', { path, real: inst.rec.reads, model: mi.reads });
        continue;
      }
      if (inst.runs !== mi.runs) throw new Failure(inst.runs > mi.runs ? 'extra-run' : 'missed-run', { path, instance: i, real: inst.runs, model: mi.runs, dead: mi.dead, kind: inst.kind });
      const want = model.expectedCleanups(mi);
      if (inst.cleanups !== want) throw new Failure('cleanup-count', { path, instance: i, real: inst.cleanups, model: want, runs: inst.runs, dead: mi.dead });
      if (inst.rec && JSON.stringify(inst.rec.reads) !== JSON.stringify(mi.reads)) throw new Failure('reads-differ', { path, real: inst.rec.reads, model: mi.reads });
    }
  }
  if (!plain) return;
  // 每个实例自己的 run / cleanup 严格交替
  // 下一次运行开始前，上一次运行登记的清理已经全部执行；清理不会早于它所属的运行；
  // 外层开始新一轮之前，它上一轮创建的内层（含更深的）已经全部清理完
  const cleaned = new Map();
  const current = new Map();
  for (const ev of real.log) {
    const per = cleaned.get(ev.inst) ?? cleaned.set(ev.inst, new Map()).get(ev.inst);
    if (ev.t === 'run') {
      current.set(ev.inst, ev.run);
      if (ev.run > 1) {
        const prev = ev.inst.recs[ev.run - 2];
        const want = (ev.inst.def.probe ? 1 : 0) + (prev?.extra ?? 0);
        if ((per.get(ev.run - 1) ?? 0) !== want) throw new Failure('rerun-before-cleanup', { path: ev.inst.path, run: ev.run, cleaned: per.get(ev.run - 1) ?? 0, want });
      }
    } else {
      if (!ev.inst.recs[ev.run - 1]) throw new Failure('cleanup-before-run', { path: ev.inst.path, run: ev.run });
      for (const [ancestor, ancestorRun] of ev.inst.lineage) {
        if ((current.get(ancestor) ?? 0) > ancestorRun) throw new Failure('child-cleanup-after-parent-rerun', { path: ev.inst.path, ancestor: ancestor.path, note: '外层已经开始新一轮，内层上一轮的清理才执行' });
      }
      per.set(ev.run, (per.get(ev.run) ?? 0) + 1);
    }
  }
  // 同一轮：DOM 绑定的重跑都在用户 effect 的重跑前面
  const perFlush = new Map();
  for (const ev of real.log) {
    if (ev.t !== 'run' || ev.run === 1) continue;
    if (!perFlush.has(ev.flush)) perFlush.set(ev.flush, []);
    perFlush.get(ev.flush).push(ev);
  }
  for (const events of perFlush.values()) {
    let sawUser = false;
    for (const ev of events) {
      if (ev.kind !== 'render') sawUser = true;
      else if (sawUser) throw new Failure('order', { path: ev.inst.path, note: 'renderEffect 在用户 effect 之后重跑' });
    }
  }
}

/** 跑一个用例；通过返回 undefined，失败抛 Failure */
export async function runCase(c) {
  const errors = [];
  R.onError((error) => errors.push(error));
  const real = new Real(c, errors);
  const model = new Model(c);
  const plain = !c.writers;
  try {
    real.flushNo = 0;
    model.start();
    for (const root of c.roots) real.create(root, undefined);
    R.flushSync();
    verify(real, model, plain, 0);
    let step = 0;
    for (const { ops, flush } of c.steps) {
      step++;
      real.flushNo = step;
      const flushStart = step;
      for (const op of ops) {
        if (op.o === 'w') {
          if (c.nodes[op.id]?.kind !== 'signal') continue;
          real.nodes[op.id].value = op.v;
          model.sig[op.id] = op.v;
        } else if (op.o === 'r') {
          if (!plain) continue;
          const val = model.values();
          const got = real.nodes[op.id]?.value;
          if (c.nodes[op.id] && got !== val(op.id)) throw new Failure('pull-read', { id: op.id, got, want: val(op.id) });
        } else if (op.o === 'd') {
          // 挑一个还活着、拿得到句柄的实例销毁
          const alive = model.instances.filter((mi) => !mi.dead);
          const handles = alive.map((mi) => ({ mi, inst: pairOf(real, model, mi) })).filter((x) => x.inst && (x.inst.handle?.stop || x.inst.handle?.node));
          if (!handles.length) continue;
          const { mi, inst } = handles[op.pick % handles.length];
          if (inst.handle.stop) inst.handle.stop();
          else R.dispose(inst.handle.node);
          model.kill(mi);
        } else if (op.o === 'stale') {
          // 对已经作废的实例再调一次它的停止函数：不能牵连别的
          const dead = model.instances.filter((mi) => mi.dead).map((mi) => pairOf(real, model, mi)).filter((x) => x?.handle?.stop);
          if (dead.length) dead[op.pick % dead.length].handle.stop();
        }
      }
      if (flush === 'sync') R.flushSync();
      else {
        await Promise.resolve();
        await Promise.resolve();
        R.flushSync();
      }
      model.flush();
      verify(real, model, plain, flushStart);
    }
    if (errors.length) throw new Failure('error-reported', String(errors[0]?.stack ?? errors[0]));
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure('exception', String(error.stack ?? error).split('\n').slice(0, 6).join(' | '));
  }
}

/** 模型实例对应的真实实例：同一路径上按创建顺序的下标 */
function pairOf(real, model, mi) {
  const index = model.instances.filter((x) => x.path === mi.path).indexOf(mi);
  return real.instances.filter((x) => x.path === mi.path)[index];
}

export const direction = {
  name: 'kernel',
  title: '内核图',
  defaultSeeds: 400,
  /** 返回 { ok, kind?, message?, caseData? } */
  async check(seed, options = {}) {
    const c = generate(seed, options);
    try {
      await runCase(c);
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: error.kind ?? 'exception', message: error.message, caseData: c };
    }
  },
  async recheck(c) {
    try {
      await runCase(c);
      return undefined;
    } catch (error) {
      return error.kind ?? 'exception';
    }
  },
};
