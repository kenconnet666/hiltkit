// 原型编译器：符文 + JSX → 纯 JS，运行时依赖 @hilt/runtime，用到 sx 时再依赖 @hilt/css/abi（bind、select）。验证产物形态，不处理所有边界情况。
//   let x = _state(v)            → const x = signal(state(v))，读 x.value，写 x.value = state(v)
//   const x = _state({...})      → const x = state({...})，读写都不变
//   _derived(e) / _effect(fn)    → computed(() => e) / userEffect(fn)
//   _component(({a = 1, ...r}) => …) → (props) => …，读 a 变成 or(props.a, 1)，r = omit(props, 模块级 Set)
//   JSX 属性的书写顺序就是合并层次：<x a="1" {...rest} b={v}/> → merge({a:'1'}, rest, {get b(){…}})
//   属性写法编译期选好（规则表和运行时同一张）：class={x} → setClass，disabled={x} → attrBool，onClickCapture → on(el, 'click', fn, {capture:true})
import { createHash } from 'node:crypto';
import { transformAsync, types as t } from '@babel/core';
import syntaxJsx from '@babel/plugin-syntax-jsx';
import typescript from '@babel/plugin-transform-typescript';
import { ALIAS, ATTR, BOOL, CHILD, CLASS, KIND_MASK, LATE, PROP, PROP_ONLY, STYLE, TABLE, UNSAFE_SPREAD, eventOf, isEventKey, tierOf, unsafeUrl } from '../runtime/rules.js';
import { ssrAttr as renderAttr } from '../runtime/server.js';

const RUNTIME = '@hilt/runtime';
const CSS_ABI = '@hilt/css/abi';
const CSS = '@hilt/css';
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
/** SVG 的子元素：模板要放进 <svg> 里解析才有正确的命名空间。a、title、style、script 两边都有，按所在位置算 */
const SVG_ONLY = new Set('circle clipPath defs desc ellipse feBlend feColorMatrix feComposite feFlood feGaussianBlur feMerge feMergeNode feOffset filter foreignObject g image line linearGradient marker mask mpath path pattern polygon polyline radialGradient rect stop symbol text textPath tspan use'.split(' '));
const escapeText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escapeAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const pure = (node) => {
  t.addComment(node, 'leading', '#__PURE__', false);
  return node;
};

class FileContext {
  constructor(program) {
    this.program = program;
    this.imports = new Set();
    this.abiImports = new Set();
    this.cssImports = new Set();
    this.bindImports = new Set();
    this.templates = [];
    this.uid = 0;
    /** 符文变量（signal 形态）：写回时认得出 x.value */
    this.signals = new Set();
    /** 实验 17-bind：能写回的符文变量（let、_model）和深代理对象 */
    this.writableVars = new Set();
    this.stateObjects = new Set();
    /** _state.raw 声明的变量：写入时不包深代理 */
    this.rawSignals = new Set();
    this.hot = undefined;
    this.hotWraps = [];
    this.hotInfo = undefined;
  }
  runtime(name) {
    this.imports.add(name);
    return t.identifier(`_hilt_${name}`);
  }
  /** 编译器输出要用的引擎函数（bind、select）：不是用户 API，单独一个入口 */
  abi(name) {
    this.abiImports.add(name);
    return t.identifier(`_css_${name}`);
  }
  css(name) {
    this.cssImports.add(name);
    return t.identifier(`_css_${name}`);
  }
  /** 实验 17-bind：绑定的运行时放在实验目录里 */
  bindHelper(name) {
    this.bindImports.add(name);
    return t.identifier(`_bind_${name}`);
  }
  /** 提到模块顶层的常量：冻住的静态样式对象（引擎按对象身份缓存）、omit 的键集合 */
  hoist(expression) {
    const id = t.identifier(`_hoisted${(this.hoisted = (this.hoisted ?? 0) + 1)}`);
    this.templates.push(t.variableDeclaration('const', [t.variableDeclarator(id, expression)]));
    return t.cloneNode(id);
  }
  id(prefix) {
    return t.identifier(`_${prefix}${this.uid++}`);
  }
  template(html, svg) {
    const id = t.identifier(`_tpl${this.uid++}`);
    const args = svg ? [t.stringLiteral(html), t.booleanLiteral(true)] : [t.stringLiteral(html)];
    this.templates.push(t.variableDeclaration('const', [t.variableDeclarator(id, pure(t.callExpression(this.runtime('template'), args)))]));
    return id;
  }
  finish() {
    const specifiers = [...this.imports].map((name) =>
      t.importSpecifier(t.identifier(`_hilt_${name}`), t.identifier(name)),
    );
    const named = (names, source) =>
      names.size ? [t.importDeclaration([...names].map((name) => t.importSpecifier(t.identifier(`_css_${name}`), t.identifier(name))), t.stringLiteral(source))] : [];
    const nodes = [
      ...(specifiers.length ? [t.importDeclaration(specifiers, t.stringLiteral(RUNTIME))] : []),
      ...named(this.abiImports, CSS_ABI),
      ...named(this.cssImports, CSS),
      ...(this.bindImports.size
        ? [t.importDeclaration([...this.bindImports].map((name) => t.importSpecifier(t.identifier(`_bind_${name}`), t.identifier(name))), t.stringLiteral(this.twoWayFrom))]
        : []),
      ...this.templates,
    ];
    const body = this.program.node.body;
    const firstCode = body.findIndex((node) => !t.isImportDeclaration(node));
    body.splice(firstCode === -1 ? body.length : firstCode, 0, ...nodes);
  }
}

// ---- 第 1 遍：符文 ----
// 先改读写（路径都还有效），再做结构变换：把节点挪进箭头函数之后，原来的路径就失效了
const runeOf = (call) => {
  if (!t.isCallExpression(call)) return undefined;
  if (t.isIdentifier(call.callee)) return call.callee.name;
  // _state.raw、_bindable.raw：不代理，其余和不带 raw 的相同；_derived.by(fn)：函数体写法
  if (t.isMemberExpression(call.callee) && call.callee.property.name === 'raw' && ['_state', '_bindable'].includes(call.callee.object.name)) return call.callee.object.name;
  if (t.isMemberExpression(call.callee) && call.callee.property.name === 'by' && call.callee.object.name === '_derived') return '_derived';
  return undefined;
};
const isDerivedBy = (call) => t.isMemberExpression(call.callee) && call.callee.property.name === 'by';
/** 原始值字面量和只产出原始值的运算：不用包深代理 */
function isPrimitiveExpr(node) {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node) || t.isTemplateLiteral(node) || t.isBigIntLiteral(node)) return true;
  if (t.isIdentifier(node, { name: 'undefined' })) return true;
  if (t.isUnaryExpression(node)) return true;
  if (t.isUpdateExpression(node)) return true;
  if (t.isBinaryExpression(node)) return true;
  return false;
}

/** _state(x) 的 x 是初始值，_derived(x) 本来就惰性：这些参数里的对象字面量不算“活对象” */
function insideInitialValue(path) {
  return !!path.findParent((parent) => {
    if (parent.isFunction()) return true;
    return parent.isCallExpression() && ['_state', '_bindable', '_derived', '_untrack'].includes(runeOf(parent.node));
  })?.isCallExpression();
}

/**
 * 活对象规则：对象字面量里的符文变量，如果和这个变量在同一层函数里，属性就是活的（访问器）。
 * 组件体、组合式函数体只执行一次，这个位置取快照几乎没有意义；嵌套函数（事件、回调）里照旧是当时的值。
 */
function makeLiveProperty(ref, binding, read, write) {
  const property = ref.parentPath;
  if (!property.isObjectProperty() || property.node.value !== ref.node || property.node.computed) return false;
  if (ref.getFunctionParent()?.node !== binding.scope.getFunctionParent()?.block) return false;
  if (insideInitialValue(ref)) return false;
  const key = property.node.key;
  const members = [t.objectMethod('get', t.cloneNode(key), [], t.blockStatement([t.returnStatement(read())]))];
  if (write) {
    members.push(
      t.objectMethod('set', t.cloneNode(key), [t.identifier('_next')], t.blockStatement([t.expressionStatement(write(t.identifier('_next')))])),
    );
  }
  property.replaceWithMultiple(members);
  return true;
}

function rewriteReferences(binding, read, write, writable = true) {
  // 先复制：replaceWithMultiple 会把新生成的引用登记回 referencePaths，边遍历边增长就改写了两遍
  for (const ref of [...binding.referencePaths]) {
    if (t.isJSXIdentifier(ref.node)) continue;
    const parent = ref.parent;
    // x++ 的 x 同时算引用和写入，归写入处理
    if (t.isUpdateExpression(parent)) continue;
    if (makeLiveProperty(ref, binding, read, writable ? write : undefined)) continue;
    if (t.isObjectProperty(parent) && parent.shorthand) parent.shorthand = false;
    ref.replaceWith(read());
  }
  for (const violation of binding.constantViolations) {
    if (violation.isAssignmentExpression()) {
      const value =
        violation.node.operator === '='
          ? violation.node.right
          : t.binaryExpression(violation.node.operator.slice(0, -1), read(), violation.node.right);
      violation.replaceWith(write(value));
    } else if (violation.isUpdateExpression()) {
      violation.replaceWith(write(t.binaryExpression(violation.node.operator[0], read(), t.numericLiteral(1))));
    }
  }
}

/** _bind(x)、_bind.trim(x)、_bind.lazy.trim(x)：取出写回目标和修饰符 */
function bindOf(value) {
  if (!t.isCallExpression(value)) return undefined;
  const mods = [];
  let callee = value.callee;
  while (t.isMemberExpression(callee) && !callee.computed) {
    mods.unshift(callee.property.name);
    callee = callee.object;
  }
  if (!t.isIdentifier(callee, { name: '_bind' })) return undefined;
  return { target: value.arguments[0], mods };
}

/** 能写回的只有：let 的 _state、_derived，默认值写 _state 的 prop，对象属性 */
function bindProblem(arg, scope) {
  if (t.isMemberExpression(arg)) return undefined;
  if (!t.isIdentifier(arg)) return '这是表达式，算出来的值写不回去';
  const binding = scope.getBinding(arg.name);
  if (!binding) return `${arg.name} 没有声明`;
  if (binding.kind === 'param') {
    const pattern = binding.path.isObjectPattern?.() ? binding.path.node : undefined;
    const property = pattern?.properties.find((item) => t.isAssignmentPattern(item.value) && item.value.left.name === arg.name);
    if (property && runeOf(property.value.right) === '_bindable') return undefined;
    return `prop ${arg.name} 是只读的，要转交绑定就声明成 ${arg.name} = _bindable(默认值)`;
  }
  const rune = binding.path.isVariableDeclarator() ? runeOf(binding.path.node.init) : undefined;
  if (rune !== '_state' && rune !== '_derived') return `${arg.name} 不是响应式变量`;
  if (binding.kind !== 'let') return `${arg.name} 是 const，写不回去`;
  return undefined;
}

function validateBinds(program) {
  program.traverse({
    CallExpression(path) {
      const bind = bindOf(path.node);
      if (!bind) return;
      if (!t.isJSXExpressionContainer(path.parent) || !t.isJSXAttribute(path.parentPath.parent)) {
        throw path.buildCodeFrameError('_bind 只能直接写在 JSX 属性上');
      }
      const problem = bindProblem(bind.target, path.scope);
      if (problem) throw path.buildCodeFrameError(`_bind 的值要能写回：${problem}。只想换算就写 value={表达式} onValueChange={(v) => …}`);
    },
  });
}

/** 这个函数是不是“只执行一次的设置函数”：组件，或者函数体里直接声明了符文的函数（组合式函数） */
function isSetupFunction(fn) {
  if (!fn) return false;
  if (t.isCallExpression(fn.parent) && runeOf(fn.parent) === '_component') return true;
  if (!t.isBlockStatement(fn.node.body)) return false;
  return fn.node.body.body.some(
    (statement) => t.isVariableDeclaration(statement) && statement.declarations.some((item) => ['_state', '_derived'].includes(runeOf(item.init))),
  );
}
const hasCall = (node) => {
  let found = false;
  t.traverseFast(node, (child) => {
    if (t.isCallExpression(child) || t.isOptionalCallExpression(child) || t.isNewExpression(child) || t.isAwaitExpression(child) || t.isFunction(child) || t.isJSX(child)) found = true;
  });
  return found;
};

/**
 * 活对象规则的扩展：设置函数里对象字面量的属性值，如果是属性链或不含调用的表达式，并且读到了这个函数里的变量，
 * 也变成 getter：{ variant: appearance.variant, on: count > 0 }。含函数调用的不动，调用可能有副作用，由作者决定。
 */
function liftLiveExpressions(program) {
  program.traverse({
    ObjectProperty(path) {
      if (path.node.computed || !t.isExpression(path.node.value)) return;
      const value = path.node.value;
      if (t.isIdentifier(value) || t.isLiteral(value) && !t.isTemplateLiteral(value) || t.isObjectExpression(value) || t.isArrayExpression(value) || hasCall(value)) return;
      if (path.findParent((parent) => parent.isJSX())) return;
      const fn = path.getFunctionParent();
      if (!isSetupFunction(fn) || insideInitialValue(path)) return;
      const valuePath = path.get('value');
      let readsLocal = false;
      const check = (id) => {
        const binding = id.scope.getBinding(id.node.name);
        if (binding && binding.scope.getFunctionParent()?.block === fn.node) readsLocal = true;
      };
      if (valuePath.isIdentifier()) check(valuePath);
      valuePath.traverse({ ReferencedIdentifier: check });
      if (!readsLocal) return;
      path.replaceWith(t.objectMethod('get', t.cloneNode(path.node.key), [], t.blockStatement([t.returnStatement(value)])));
    },
  });
  program.scope.crawl();
}

// ---- 开发期热更新 ----
const topLevelDeclarator = (path) => {
  const declarator = path.parentPath;
  if (!declarator?.isVariableDeclarator() || !t.isIdentifier(declarator.node.id)) return undefined;
  const statement = declarator.parentPath.parentPath;
  return statement.isProgram() || (statement.isExportNamedDeclaration() && statement.parentPath.isProgram()) ? declarator : undefined;
};
const isStyleCall = (call) =>
  (t.isMemberExpression(call.callee) && t.isIdentifier(call.callee.object, { name: 'css' }) && ['create', 'recipe'].includes(call.callee.property.name)) ||
  t.isIdentifier(call.callee, { name: 'recipe' }) ||
  t.isIdentifier(call.callee, { name: 'create' });
const isStableValueCall = (call) => t.isIdentifier(call.callee) && ['createContext', 'createService'].includes(call.callee.name);

/**
 * 顶层的样式、context、服务要跨热更新保持同一个对象：导入方手里拿的还是它，不用连锁重新执行。
 * 同时算出“骨架”：去掉样式参数后的源码哈希。骨架没变说明只改了样式，规则已经原地改好，一个组件都不用重建
 */
function prepareHot(program, ctx, source) {
  const cuts = [];
  const componentCuts = [];
  let otherExports = false;
  // 有顶层副作用的模块（mount 的入口）不能自己接住更新：重新执行就挂载第二份应用
  const sideEffects = program.node.body.some((statement) => t.isExpressionStatement(statement));
  program.traverse({
    CallExpression(path) {
      const declarator = topLevelDeclarator(path);
      if (!declarator) return;
      const name = declarator.node.id.name;
      if (runeOf(path.node) === '_component') componentCuts.push([path.node.start, path.node.end]);
      if (isStyleCall(path.node)) {
        cuts.push([path.node.start, path.node.end]);
        ctx.hotWraps.push(() => {
          // 第二个参数是开发模式的可读名字，进组合类的类名（Button-styles-root-x1abc）
          if (t.isIdentifier(path.node.callee, { name: 'create' }) && path.node.arguments.length === 1) {
            const base = String(ctx.hot).split('/').pop().replace(/\.[jt]sx?$/, '');
            path.node.arguments.push(t.stringLiteral(`${base}.${name}`));
          }
          path.replaceWith(t.callExpression(ctx.css('hotStyles'), [t.stringLiteral(`${ctx.hot}#${name}`), path.node]));
          path.skip();
        });
      } else if (isStableValueCall(path.node)) {
        ctx.hotWraps.push(() => {
          const call = path.node;
          path.replaceWith(t.callExpression(ctx.runtime('hotValue'), [t.stringLiteral(`${ctx.hot}#${name}`), t.arrowFunctionExpression([], call)]));
          path.skip();
        });
      }
    },
    ExportNamedDeclaration(path) {
      if (path.node.source) return;
      const declarations = path.node.declaration?.declarations;
      if (!declarations) {
        otherExports = true;
        return;
      }
      for (const item of declarations) {
        const init = item.init;
        const stable = t.isCallExpression(init) && (runeOf(init) === '_component' || isStyleCall(init) || isStableValueCall(init));
        if (!stable) otherExports = true;
      }
    },
  });
  const without = (ranges) => {
    let text = source;
    for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + text.slice(end);
    return createHash('sha256').update(text).digest('hex').slice(0, 12);
  };
  // 骨架：去掉样式。没变 → 只改了样式。对外面：再去掉组件。没变 → 导出的函数、常量没动，导入方不用重新执行
  ctx.hotInfo = { skeleton: without(cuts), surface: without([...cuts, ...componentCuts]), otherExports, sideEffects };
}

function compileRunes(program, ctx) {
  validateBinds(program);
  liftLiveExpressions(program);
  const structural = [];
  program.traverse({
    VariableDeclarator(path) {
      const name = runeOf(path.node.init);
      const kind = path.parent.kind;
      // 实验 17-bind：let x = _writable(读, 写)：读写都是普通变量，写入走你给的函数。拦截、换算都用它
      if (name === '_writable') {
        const local = path.node.id.name;
        ctx.signals.add(local);
        ctx.rawSignals.add(local);
        ctx.writableVars.add(local);
        rewriteReferences(path.scope.getBinding(local), () => valueOf(local), (value) => t.assignmentExpression('=', valueOf(local), value));
        structural.push(() => {
          path.parent.kind = 'const';
          path.get('init.callee').replaceWith(ctx.bindHelper('writable'));
        });
        return;
      }
      // 实验 17-bind：let value = _model(来源 prop, 默认值)。读写都是普通变量；类型上 prop 是 Model<T>，局部变量是 T
      if (name === '_model') {
        const local = path.node.id.name;
        ctx.signals.add(local);
        ctx.rawSignals.add(local);
        ctx.writableVars.add(local);
        rewriteReferences(path.scope.getBinding(local), () => valueOf(local), (value) => t.assignmentExpression('=', valueOf(local), value));
        structural.push(() => {
          path.parent.kind = 'const';
          const [source, fallback] = path.node.init.arguments;
          path.get('init').replaceWith(t.callExpression(ctx.bindHelper('model'), [t.cloneNode(source.object), t.stringLiteral(source.property.value ?? source.property.name), fallback ?? t.identifier('undefined')]));
        });
        return;
      }
      if (name !== '_derived' && (name !== '_state' || kind === 'const')) {
        if (name === '_state') {
          if (!isRawState(path.node.init)) ctx.stateObjects.add(path.node.id.name);
          structural.push(() => {
            const value = path.node.init.arguments[0] ?? t.identifier('undefined');
            path.get('init').replaceWith(isRawState(path.node.init) ? value : t.callExpression(ctx.runtime('state'), [value]));
          });
        }
        return;
      }
      const local = path.node.id.name;
      const writable = kind === 'let';
      // let 的 _state 整体替换时，新对象也要是深代理
      const deepWrites = name === '_state' && !isRawState(path.node.init);
      ctx.signals.add(local);
      if (writable) ctx.writableVars.add(local);
      if (name === '_state' && isRawState(path.node.init)) ctx.rawSignals.add(local);
      rewriteReferences(
        path.scope.getBinding(local),
        () => valueOf(local),
        (value) => t.assignmentExpression('=', valueOf(local), deepWrites ? wrapState(ctx, value) : value),
        writable,
      );
      structural.push(() => {
        path.parent.kind = 'const';
        const arg = path.node.init.arguments[0];
        // _state(x) 的 x 明摆着是初始值：不算在组件体里读了响应式数据
        path
          .get('init')
          .replaceWith(
            name === '_state'
              ? t.callExpression(ctx.runtime('signal'), [initialValue(ctx, path.node.init)])
              : t.callExpression(ctx.runtime(writable ? 'overridable' : 'computed'), [isDerivedBy(path.node.init) ? arg : t.arrowFunctionExpression([], arg)]),
          );
      });
    },
    CallExpression(path) {
      const name = runeOf(path.node);
      const callee = path.node.callee;
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: '_state' }) && callee.property.name === 'snapshot') {
        structural.push(() => path.get('callee').replaceWith(ctx.runtime('snapshot')));
      }
      // 实验 17-bind：_ref(x) 取到变量背后的壳，_ref(o.a) 是对象字段的壳
      if (name === '_ref') {
        structural.push(() => {
          const target = path.node.arguments[0];
          const isSignal = t.isMemberExpression(target) && t.isIdentifier(target.object) && target.property.name === 'value' && ctx.signals.has(target.object.name);
          if (isSignal) path.replaceWith(t.cloneNode(target.object));
          else path.replaceWith(t.callExpression(ctx.bindHelper('fieldRef'), [t.cloneNode(target.object), t.stringLiteral(target.property.name)]));
        });
      }
      if (name === '_effect') structural.push(() => path.get('callee').replaceWith(ctx.runtime('userEffect')));
      if (name === '_untrack') {
        structural.push(() =>
          path.replaceWith(t.callExpression(ctx.runtime('untrack'), [t.arrowFunctionExpression([], path.node.arguments[0])])),
        );
      }
      if (name === '_component') structural.push(prepareComponent(path, ctx));
    },
  });
  // 外层先做会让内层路径失效：从内到外（遍历是从外到内进入的，所以倒序）
  for (const run of structural.reverse()) run();
}

const isRawState = (call) => t.isMemberExpression(call.callee);
const valueOf = (name) => t.memberExpression(t.identifier(name), t.identifier('value'));
const wrapState = (ctx, value) => (isPrimitiveExpr(value) ? value : t.callExpression(ctx.runtime('state'), [value]));
function initialValue(ctx, call) {
  const arg = call.arguments[0] ?? t.identifier('undefined');
  const value = isRawState(call) ? arg : wrapState(ctx, arg);
  return mayBeReactive(arg) ? t.callExpression(ctx.runtime('untrack'), [t.arrowFunctionExpression([], value)]) : value;
}
const bindableInitial = initialValue;
/** 除了在 JSX 里展开，rest 还被读了（rest.x、传给函数）：要能读属性的视图，否则轻量的 Layers 就够了 */
function restOnlySpread(binding) {
  return binding.referencePaths.every((ref) => t.isJSXSpreadAttribute(ref.parent));
}

/** _component(({a = 1, b: c, on = _bindable(false), ...rest}) => body) */
function prepareComponent(path, ctx) {
  const fn = path.get('arguments.0');
  const param = fn.node.params[0];
  const propsId = ctx.id('props');
  const prelude = [];
  if (t.isObjectPattern(param)) {
    const seen = [];
    for (const property of param.properties) {
      if (t.isRestElement(property)) continue;
      const key = property.key.name ?? property.key.value;
      seen.push(key);
      const value = property.value;
      const local = t.isAssignmentPattern(value) ? value.left : value;
      const fallback = t.isAssignmentPattern(value) ? value.right : undefined;
      const binding = fn.scope.getBinding(local.name);
      if (runeOf(fallback) === '_state') {
        throw new Error(`prop ${key} 不能用 _state 声明：要让父级绑定就写 ${local.name} = _bindable(默认值)；只要初值就在函数体里写 let current = _state(${local.name})`);
      }
      // 实验 17-bind：_model 在解构里写法同 _bindable，prop 的类型就是 T，父级传变量就带上写入
      if (runeOf(fallback) === '_model') {
        seen.push(changeHandlerOf(key));
        ctx.signals.add(local.name);
        ctx.rawSignals.add(local.name);
        ctx.writableVars.add(local.name);
        rewriteReferences(binding, () => valueOf(local.name), (next) => t.assignmentExpression('=', valueOf(local.name), next));
        prelude.push(() =>
          t.variableDeclaration('const', [
            t.variableDeclarator(t.identifier(local.name), t.callExpression(ctx.bindHelper('model'), [t.identifier(propsId.name), t.stringLiteral(key), fallback.arguments[0] ?? t.identifier('undefined')])),
          ]),
        );
        continue;
      }
      // 规则一句话：声明成 _bindable 的 prop 可写、可被 _bind 绑定；其余 prop 只读
      if (runeOf(fallback) === '_bindable') {
        // 回调由组件自己调用，不能跟着 rest 落到元素上
        seen.push(changeHandlerOf(key));
        ctx.signals.add(local.name);
        ctx.writableVars.add(local.name);
        if (isRawState(fallback)) ctx.rawSignals.add(local.name);
        rewriteReferences(
          binding,
          () => valueOf(local.name),
          (next) => t.assignmentExpression('=', valueOf(local.name), next),
        );
        prelude.push(() =>
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier(local.name),
              t.callExpression(ctx.runtime('bindable'), [
                t.identifier(propsId.name),
                t.stringLiteral(key),
                // 和 _state 一样：默认深代理，.raw 不代理，默认值只求一次、不追踪
                bindableInitial(ctx, fallback),
                ...(isRawState(fallback) ? [] : [ctx.runtime('state')]),
              ]),
            ),
          ]),
        );
      } else {
        const member = () => t.memberExpression(t.identifier(propsId.name), t.stringLiteral(key), true);
        // 默认值同 Svelte：只有 undefined 才走默认值（null 是明确给的）；可以是任意表达式，用到时才求值，只求一次
        let read = member;
        if (fallback && (t.isLiteral(fallback) && !t.isTemplateLiteral(fallback))) {
          read = () => t.callExpression(ctx.runtime('or'), [member(), t.cloneNode(fallback)]);
        } else if (fallback) {
          const make = ctx.id('default');
          prelude.push(() => t.variableDeclaration('const', [t.variableDeclarator(t.cloneNode(make), t.callExpression(ctx.runtime('computed'), [t.arrowFunctionExpression([], fallback)]))]));
          read = () => t.callExpression(ctx.runtime('orElse'), [member(), t.cloneNode(make)]);
        }
        rewriteReferences(
          binding,
          read,
          () => {
            throw new Error(`prop ${key} 是只读的`);
          },
          false,
        );
      }
    }
    const restProperty = param.properties.find((property) => t.isRestElement(property));
    if (restProperty) {
      const onlySpread = restOnlySpread(fn.scope.getBinding(restProperty.argument.name));
      prelude.push(() => {
        const keys = ctx.hoist(t.newExpression(t.identifier('Set'), [t.arrayExpression(seen.map((key) => t.stringLiteral(key)))]));
        const rest = t.callExpression(ctx.runtime('omit'), [t.identifier(propsId.name), keys]);
        return t.variableDeclaration('const', [t.variableDeclarator(restProperty.argument, onlySpread ? rest : t.callExpression(ctx.runtime('propsView'), [rest]))]);
      });
    }
  }
  return () => {
    // 不解构时参数就是 props 本身，名字留给用户
    if (t.isObjectPattern(param)) fn.node.params = [t.identifier(propsId.name)];
    if (!t.isBlockStatement(fn.node.body)) fn.node.body = t.blockStatement([t.returnStatement(fn.node.body)]);
    fn.node.body.body.unshift(...prelude.map((make) => make()));
    const declarator = ctx.hot ? topLevelDeclarator(path) : undefined;
    if (declarator) {
      // 组件包一层稳定的函数：导入方手里的引用不变，改了组件只重建它的实例
      path.replaceWith(t.callExpression(ctx.runtime('hotComponent'), [t.stringLiteral(`${ctx.hot}#${declarator.node.id.name}`), fn.node]));
      path.skip();
    } else {
      path.replaceWith(fn.node);
    }
  };
}

// ---- sx：静态的项原样放进数组，依赖状态的项换成 bind / select ----
const REACTIVE_INITS = /^_hilt_(signal|state|computed|overridable|bindable)$/;

/** 标识符绑定在模块顶层、不会变、也不是响应式来源（signal、深代理）：读它得到的是常量 */
function isStaticBinding(binding) {
  if (!binding || !binding.scope.path.isProgram() || !binding.constant) return false;
  const declarator = binding.path;
  if (declarator.isVariableDeclarator() && t.isCallExpression(declarator.node.init)) {
    const callee = declarator.node.init.callee;
    if (t.isIdentifier(callee) && REACTIVE_INITS.test(callee.name)) return false;
  }
  return true;
}

/** 值是常量：字面量、模块顶层的不可变绑定（及其成员链）、全由常量组成的对象与数组 */
function isStaticExpr(node, scope) {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node)) return true;
  if (t.isTemplateLiteral(node)) return node.expressions.every((e) => isStaticExpr(e, scope));
  if (t.isIdentifier(node)) return node.name === 'undefined' || isStaticBinding(scope.getBinding(node.name));
  if (t.isMemberExpression(node)) return isStaticExpr(node.object, scope) && (!node.computed || isStaticExpr(node.property, scope));
  if (t.isUnaryExpression(node)) return isStaticExpr(node.argument, scope);
  if (t.isArrayExpression(node)) return node.elements.every((e) => e && !t.isSpreadElement(e) && isStaticExpr(e, scope));
  if (t.isObjectExpression(node)) {
    return node.properties.every(
      (p) => t.isObjectProperty(p) && (!p.computed || isStaticExpr(p.key, scope)) && isStaticExpr(p.value, scope),
    );
  }
  return false;
}

/** 纯字面量的对象：可以提到模块顶层冻住（引用了标识符的不行，声明顺序可能还没到） */
function isPureLiteral(node) {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node)) return true;
  if (t.isArrayExpression(node)) return node.elements.every((e) => e && isPureLiteral(e));
  if (t.isObjectExpression(node)) return node.properties.every((p) => t.isObjectProperty(p) && !p.computed && isPureLiteral(p.value));
  return false;
}

const isEmptySx = (node) => t.isNullLiteral(node) || t.isBooleanLiteral(node) || (t.isIdentifier(node) && node.name === 'undefined');

/** 编译器拆好的 sx：是数据，不是读取 */
const sxData = new WeakSet();
/**
 * sx 的值 → 数据数组。静态的项（create 的命名空间、字面量对象）原样放进去；
 *   `cond && x`、`cond ? a : b`、`styles[key]`、别处传来的 sx（props.sx）→ select(() => 表达式)
 *   `styles.bar(width)`（静态的函数、动态的参数）→ bind(styles.bar, () => [width])
 * 结果是不带访问器的数据：元素上的 sx 不再整段起 effect，引擎只为动态的项起一个 effect。
 * 认不出的形状（展开元素）返回 undefined，保持整段读取。
 */
function sxExpression(ctx, scope, value) {
  const out = [];
  let ok = true;
  const visit = (node) => {
    if (!ok || isEmptySx(node)) return;
    if (t.isArrayExpression(node)) {
      for (const element of node.elements) {
        if (!element) continue;
        if (t.isSpreadElement(element)) ok = false;
        else visit(element);
      }
      return;
    }
    if (isStaticExpr(node, scope)) {
      out.push(t.isObjectExpression(node) && isPureLiteral(node) ? ctx.hoist(t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('freeze')), [node])) : node);
      return;
    }
    if (t.isCallExpression(node) && !node.arguments.some((arg) => t.isSpreadElement(arg)) && isStaticExpr(node.callee, scope)) {
      // 参数全是常量：和读常量一样，渲染时算一次
      if (node.arguments.every((arg) => isStaticExpr(arg, scope))) {
        out.push(node);
        return;
      }
      out.push(t.callExpression(ctx.abi('bind'), [node.callee, t.arrowFunctionExpression([], t.arrayExpression(node.arguments))]));
      return;
    }
    out.push(t.callExpression(ctx.abi('select'), [t.arrowFunctionExpression([], node)]));
  };
  visit(value);
  if (!ok) return undefined;
  const result = out.length === 1 && !t.isObjectExpression(out[0]) ? out[0] : t.arrayExpression(out);
  sxData.add(result);
  return result;
}

// ---- 第 2 遍：JSX ----
const isComponentName = (name) => t.isJSXMemberExpression(name) || /^[A-Z]/.test(name.name);
function tagExpression(name) {
  if (t.isJSXMemberExpression(name)) {
    return t.memberExpression(tagExpression(name.object), t.identifier(name.property.name));
  }
  return t.identifier(name.name);
}
const rawAttrName = (attr) =>
  t.isJSXNamespacedName(attr.name) ? `${attr.name.namespace.name}:${attr.name.name.name}` : attr.name.name;
/** React 拼写在原生元素上编译期改名；组件的 prop 名字不动 */
const attrName = (attr) => rawAttrName(attr);
const nativeName = (name) => ALIAS[name] ?? name;

/** 表达式里有没有可能读到响应式数据：调用或属性访问（嵌套函数里的不算，定义时不执行） */
function mayBeReactive(node) {
  if (t.isFunction(node)) return false;
  if (t.isCallExpression(node) || t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) return true;
  if (t.isLiteral(node) && !t.isTemplateLiteral(node)) return false;
  if (t.isIdentifier(node)) return false;
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = node[key];
    for (const item of Array.isArray(child) ? child : [child]) {
      if (item && t.isNode(item) && mayBeReactive(item)) return true;
    }
  }
  return false;
}
const isFunctionExpr = (node) => t.isArrowFunctionExpression(node) || t.isFunctionExpression(node);

function attrValue(attr) {
  if (attr.value == null) return t.booleanLiteral(true);
  if (t.isStringLiteral(attr.value)) return attr.value;
  return attr.value.expression;
}

function getterProperty(key, value) {
  const keyNode = t.isValidIdentifier(key) ? t.identifier(key) : t.stringLiteral(key);
  return t.objectMethod('get', keyNode, [], t.blockStatement([t.returnStatement(value)]));
}
function dataProperty(key, value) {
  return t.objectProperty(t.isValidIdentifier(key) ? t.identifier(key) : t.stringLiteral(key), value);
}
/** 编译 JSX 得到的表达式：读它就会创建 DOM */
const builtContent = new WeakSet();
function containsContent(node) {
  let found = false;
  t.traverseFast(node, (child) => {
    if (builtContent.has(child)) found = true;
  });
  return found;
}
/**
 * 内容类的值（children、header={<X />}）传函数，不做 getter：
 * {children && <span>{children}</span>} 判断真假时不能创建 DOM，否则内容建两次，水合时节点还会被提前认领
 */
function layerProperty(key, value) {
  if (containsContent(value) && !isFunctionExpr(value) && !t.isArrayExpression(value)) return dataProperty(key, t.arrowFunctionExpression([], value));
  return mayBeReactive(value) ? getterProperty(key, value) : dataProperty(key, value);
}

/** value → onValueChange：不用带冒号的属性名，TS 的跳转、补全、重命名都正常 */
const changeHandlerOf = (key) => `on${key[0].toUpperCase()}${key.slice(1)}Change`;

const isBindAttr = (attr) => t.isJSXAttribute(attr) && !!bindOf(attrValue(attr));

/** 写回目标：符文变量 x.value = state(next)，对象属性 → 赋值 */
function writeTo(ctx, target, next) {
  const signalName = t.isMemberExpression(target) && !target.computed && target.property.name === 'value' && t.isIdentifier(target.object) ? target.object.name : undefined;
  const wrap = signalName && ctx.signals.has(signalName) && !ctx.rawSignals.has(signalName);
  return t.assignmentExpression('=', t.cloneNode(target), wrap ? t.callExpression(ctx.runtime('state'), [next]) : next);
}

/** 实验 17-bind（autoBind）：属性值是一个能写回的位置：符文变量、深代理的字段、转交的 prop */
function writableTarget(ctx, value) {
  if (!t.isMemberExpression(value)) return undefined;
  if (!value.computed && value.property.name === 'value' && t.isIdentifier(value.object) && ctx.signals.has(value.object.name)) return ctx.writableVars.has(value.object.name) ? 'signal' : undefined;
  let root = value;
  while (t.isMemberExpression(root)) root = root.object;
  if (!t.isIdentifier(root)) return undefined;
  if (ctx.stateObjects.has(root.name)) return 'state';
  if (value.object === root && root.name.startsWith('_props') && t.isStringLiteral(value.property)) return 'prop';
  return undefined;
}
/** 原生元素要的壳：变量背后的节点，字段就现做一个 */
function shellOf(ctx, value) {
  const kind = writableTarget(ctx, value);
  if (kind === 'signal') return t.cloneNode(value.object);
  if (kind !== 'state') return undefined;
  const next = t.identifier('_next');
  return t.callExpression(ctx.bindHelper('writable'), [t.arrowFunctionExpression([], t.cloneNode(value)), t.arrowFunctionExpression([t.cloneNode(next)], t.assignmentExpression('=', t.cloneNode(value), t.cloneNode(next)))]);
}

/** 属性 → 合并层的属性列表。attributes 是同一元素的全部属性 */
function propertiesOf(ctx, attr, attributes, isComponent) {
  const key = attrName(attr);
  const value = attrValue(attr);
  // ref={el}：el 是可写的符文变量时把元素写进去，不用再转一道
  if (key === 'ref' && writable(value)) {
    return [dataProperty('ref', t.arrowFunctionExpression([t.identifier('_node')], t.assignmentExpression('=', t.cloneNode(value), t.identifier('_node'))))];
  }
  // 编译器拆好的 sx 是数据：不做 getter，不起 effect
  if (key === 'sx' && sxData.has(value)) return [dataProperty('sx', value)];
  const bind = bindOf(value);
  if (!bind) {
    // 同一元素上 value={_bind(x)} onValueChange={fn}：回调已经并进绑定里，这里不再单独生成
    const bound = attributes.some((other) => isBindAttr(other) && changeHandlerOf(attrName(other)) === key);
    if (bound) return [];
    const target = ctx.autoBind && isComponent ? writableTarget(ctx, value) : undefined;
    if (target) {
      const next = t.identifier('_next');
      const write = target === 'prop' ? t.callExpression(ctx.bindHelper('setProp'), [t.cloneNode(value.object), t.cloneNode(value.property), t.cloneNode(next)]) : writeTo(ctx, value, t.cloneNode(next));
      const keyNode = t.isValidIdentifier(key) ? t.identifier(key) : t.stringLiteral(key);
      return [getterProperty(key, value), t.objectMethod('set', keyNode, [next], t.blockStatement([t.expressionStatement(write)]))];
    }
    return [layerProperty(key, value)];
  }
  const handler = changeHandlerOf(key);
  const explicit = attributes.find((other) => !t.isJSXSpreadAttribute(other) && attrName(other) === handler);
  const next = () => t.identifier('_next');
  const write = writeTo(ctx, bind.target, next());
  // 写回之后再通知：value={_bind(x)} onValueChange={log}，两个都要
  const body = explicit
    ? t.blockStatement([t.expressionStatement(write), t.expressionStatement(t.callExpression(attrValue(explicit), [next()]))])
    : write;
  return [
    getterProperty(key, bind.target),
    dataProperty(handler, t.callExpression(ctx.runtime('bound'), [t.arrowFunctionExpression([next()], body), t.stringLiteral(key)])),
  ];
}
/** 第 1 遍之后可写的值是 x.value 或对象属性 */
const writable = (value) => t.isMemberExpression(value);

function propsExpression(ctx, attributes, childrenValue, isComponent = false) {
  const layers = [];
  let current = [];
  for (const attr of attributes) {
    if (t.isJSXSpreadAttribute(attr)) {
      if (current.length) layers.push(t.objectExpression(current));
      current = [];
      // 展开的值可能变：做成函数层，由 spread 跟踪键的增减。直接求值的话它就被外层 insert 读到，整个组件跟着重建
      layers.push(mayBeReactive(attr.argument) ? t.arrowFunctionExpression([], attr.argument) : attr.argument);
    } else {
      current.push(...propertiesOf(ctx, attr, attributes, isComponent));
    }
  }
  if (childrenValue) {
    current.push(
      isFunctionExpr(childrenValue) || t.isIdentifier(childrenValue)
        ? dataProperty('children', childrenValue)
        : layerProperty('children', childrenValue),
    );
  }
  if (current.length || !layers.length) layers.push(t.objectExpression(current));
  if (layers.length === 1 && t.isObjectExpression(layers[0])) return layers[0];
  return t.callExpression(ctx.runtime('merge'), layers);
}

function cleanChildren(children) {
  const out = [];
  for (const child of children) {
    if (t.isJSXText(child)) {
      const lines = child.value.split(/\r\n|\n|\r/);
      let text = '';
      lines.forEach((line, index) => {
        let piece = line.replace(/\t/g, ' ');
        if (index !== 0) piece = piece.replace(/^ +/, '');
        if (index !== lines.length - 1) piece = piece.replace(/ +$/, '');
        if (!piece) return;
        if (index !== lines.length - 1 && lines.slice(index + 1).some((rest) => /[^ \t]/.test(rest))) piece += ' ';
        text += piece;
      });
      if (text) out.push({ kind: 'text', text });
    } else if (t.isJSXExpressionContainer(child)) {
      if (t.isJSXEmptyExpression(child.expression)) continue;
      if (t.isStringLiteral(child.expression)) out.push({ kind: 'text', text: child.expression.value });
      else out.push({ kind: 'expr', node: child.expression });
    } else if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      out.push({ kind: 'jsx', node: child });
    }
  }
  return out;
}
const isNative = (node) => t.isJSXElement(node) && !isComponentName(node.openingElement.name);

/**
 * 多个子节点：除字面量外每项都包成函数，每项单独成一段、互不牵连（insert 遇到函数起一个嵌套的 effect）。
 * 水合时还靠它保证次序：节点要按文档顺序认领，不能在建数组时就把后面的元素先创建出来
 */
const lazyItem = (item) =>
  (t.isLiteral(item) && !t.isTemplateLiteral(item)) || isFunctionExpr(item) ? item : t.arrowFunctionExpression([], item);

function childItems(ctx, children) {
  return cleanChildren(children).map((child) =>
    child.kind === 'text' ? t.stringLiteral(child.text) : child.kind === 'expr' ? child.node : compileNode(ctx, child.node),
  );
}

function compileNode(ctx, node) {
  const result = compileContent(ctx, node);
  builtContent.add(result);
  return result;
}
function compileContent(ctx, node) {
  if (t.isJSXFragment(node)) return t.arrayExpression(childItems(ctx, node.children).map(lazyItem));
  const name = node.openingElement.name;
  if (isComponentName(name)) return compileComponentCall(ctx, node);
  return ctx.generate === 'server' ? compileElementServer(ctx, node) : compileElement(ctx, node);
}

function childrenValue(ctx, children) {
  const items = childItems(ctx, children);
  if (!items.length) return undefined;
  if (items.length === 1) return items[0];
  return t.arrayExpression(items.map(lazyItem));
}

// ---- 原生元素的属性：规则表和运行时同一张，写法编译期选好 ----
/** 作者在 JSX 里显式写的内容键：spread 为了安全不写它们，所以不进合并层 */
const CONTENT_KEYS = new Set(['innerHTML', 'textContent', 'outerHTML', 'srcdoc']);
const SSR_WHOLE = new Set(['select', 'textarea', 'option']);
/** 实验 17-bind：传壳就双向的键 */
const TWO_WAY = new Set(['value', 'checked']);
const isSpreadAttr = (attr) => t.isJSXSpreadAttribute(attr);
const isCustomTag = (tag) => tag.includes('-');
const literalOf = (value) => {
  if (t.isStringLiteral(value) || t.isNumericLiteral(value) || t.isBooleanLiteral(value)) return { value: value.value };
  if (t.isNullLiteral(value)) return { value: null };
  return undefined;
};
/** 原生元素上的 React 拼写编译期改名，key 只给列表用，不是属性 */
function nativeAttributes(node) {
  const out = [];
  for (const attr of node.openingElement.attributes) {
    if (isSpreadAttr(attr)) {
      out.push(attr);
      continue;
    }
    if (t.isJSXIdentifier(attr.name)) {
      if (attr.name.name === 'key') continue;
      attr.name.name = nativeName(attr.name.name);
    }
    out.push(attr);
  }
  return out;
}
/** 这些值写不进模板：只有 property 的、克隆后不生效的（muted）、落在子节点或 option 上的（textarea、select 的 value）、不是属性的 */
function canBake(tag, key, literal) {
  if (literal === undefined || literal.value === null || isEventKey(key) || key === 'ref' || key === 'sx') return false;
  const kind = (typeof TABLE[key] === 'number' ? TABLE[key] : 0) & KIND_MASK;
  if (kind === PROP_ONLY || key === 'muted') return false;
  if (key === 'value' && (tag === 'select' || tag === 'textarea')) return false;
  return true;
}
const usesSpread = (tag, attributes) =>
  isCustomTag(tag) || attributes.some((attr) => isSpreadAttr(attr) || (rawAttrName(attr) === 'sx' && !sxData.has(attrValue(attr))));

// ---- 服务端产物：拼字符串，没有 DOM、没有 effect。动态段前后放 [ ] 注释，水合时靠它们认领 ----
function compileElementServer(ctx, root) {
  function walkChildren(node, parts) {
    const cleaned = cleanChildren(node.children);
    for (const child of cleaned) {
      if (child.kind === 'text') {
        parts.push(t.stringLiteral(escapeText(child.text)));
      } else if (child.kind === 'jsx' && isNative(child.node)) {
        walk(child.node, parts);
      } else {
        const value = child.kind === 'expr' ? child.node : compileNode(ctx, child.node);
        const only = cleaned.length === 1;
        if (!only) parts.push(t.stringLiteral('<!--[-->'));
        parts.push(t.callExpression(ctx.runtime('ssrChild'), [value]));
        if (!only) parts.push(t.stringLiteral('<!--]-->'));
      }
    }
  }
  function walk(node, parts) {
    const raw = (text) => parts.push(t.stringLiteral(text));
    const tag = node.openingElement.name.name;
    const attributes = nativeAttributes(node);
    if (SSR_WHOLE.has(tag)) {
      const inner = [];
      walkChildren(node, inner);
      parts.push(
        t.callExpression(ctx.runtime('ssrChild'), [
          t.callExpression(ctx.runtime('ssrElement'), [
            t.stringLiteral(tag),
            propsExpression(ctx, attributes),
            t.arrowFunctionExpression([], t.callExpression(ctx.runtime('ssr'), [t.arrayExpression(inner)])),
          ]),
        ]),
      );
      return;
    }
    raw(`<${tag}`);
    let others = attributes.filter((attr) => !isBindAttr(attr));
    // 实验 17-bind：value、checked 可能是壳，服务端取当前值
    if (ctx.twoWayFrom) {
      for (const attr of others) {
        if (isSpreadAttr(attr) || !TWO_WAY.has(rawAttrName(attr))) continue;
        parts.push(t.callExpression(ctx.runtime('ssrAttr'), [t.stringLiteral(attrName(attr)), t.callExpression(ctx.bindHelper('unref'), [attrValue(attr)]), t.stringLiteral(tag)]));
      }
      others = others.filter((attr) => isSpreadAttr(attr) || !TWO_WAY.has(rawAttrName(attr)));
    }
    const content = others.find((attr) => !isSpreadAttr(attr) && (rawAttrName(attr) === 'innerHTML' || rawAttrName(attr) === 'textContent'));
    const merged = others.filter((attr) => attr !== content);
    for (const attr of attributes) {
      if (!isBindAttr(attr)) continue;
      const bind = bindOf(attrValue(attr));
      // 多选组要看元素的 value，服务端先不输出
      if (!bind.mods.includes('group')) parts.push(t.callExpression(ctx.runtime('ssrAttr'), [t.stringLiteral(attrName(attr)), bind.target, t.stringLiteral(tag)]));
    }
    // sx 的类和变量要和 class、style 写进同一个属性：有 sx 就整个元素一起算
    if (usesSpread(tag, merged) || merged.some((attr) => rawAttrName(attr) === 'sx')) {
      parts.push(t.callExpression(ctx.runtime('ssrSpread'), [propsExpression(ctx, merged), t.stringLiteral(tag)]));
    } else {
      for (const attr of merged) {
        const key = attrName(attr);
        const value = attrValue(attr);
        if (isEventKey(key) || key === 'ref') continue;
        const literal = literalOf(value);
        if (literal) raw(renderAttr(key, literal.value, tag));
        else parts.push(t.callExpression(ctx.runtime('ssrAttr'), [t.stringLiteral(key), value, t.stringLiteral(tag)]));
      }
    }
    raw('>');
    if (VOID.has(tag)) return;
    if (content) {
      const value = attrValue(content);
      parts.push(
        rawAttrName(content) === 'innerHTML'
          ? t.callExpression(ctx.runtime('ssrChild'), [t.callExpression(ctx.runtime('ssrRaw'), [value])])
          : t.callExpression(ctx.runtime('ssrChild'), [value]),
      );
    } else {
      walkChildren(node, parts);
    }
    raw(`</${tag}>`);
  }
  const parts = [];
  walk(root, parts);
  return t.callExpression(ctx.runtime('ssr'), [t.arrayExpression(parts)]);
}

function compileComponentCall(ctx, node) {
  return t.callExpression(ctx.runtime('component'), [
    tagExpression(node.openingElement.name),
    propsExpression(ctx, node.openingElement.attributes, childrenValue(ctx, node.children), true),
  ]);
}

/** {cond && <x/>}、{cond ? <a/> : <b/>}：条件单独成 computed，条件结果不变时分支不重建 */
function conditionGuard(ctx, statements, expr) {
  const guardable =
    (t.isLogicalExpression(expr) && expr.operator === '&&' && mayBeReactive(expr.left)) ||
    (t.isConditionalExpression(expr) && mayBeReactive(expr.test));
  if (!guardable) return expr;
  const id = ctx.id('cond');
  const test = t.isLogicalExpression(expr) ? expr.left : expr.test;
  statements.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        id,
        t.callExpression(ctx.runtime('computed'), [t.arrowFunctionExpression([], t.unaryExpression('!', t.unaryExpression('!', test)))]),
      ),
    ]),
  );
  const read = t.memberExpression(t.cloneNode(id), t.identifier('value'));
  return t.isLogicalExpression(expr)
    ? t.conditionalExpression(read, expr.right, t.nullLiteral())
    : t.conditionalExpression(read, expr.consequent, expr.alternate);
}

/** 属性写到元素上的调用：编译期知道标签和键，直接选好写法，省掉运行时查表 */
function writeCall(ctx, id, key, value, tag, inSvg) {
  const call = (name, ...args) => t.callExpression(ctx.runtime(name), [t.cloneNode(id), ...args]);
  const keyNode = () => t.stringLiteral(key);
  if (ctx.twoWayFrom && TWO_WAY.has(key)) return t.callExpression(ctx.bindHelper('twoWay'), [t.cloneNode(id), keyNode(), value]);
  if (key === 'class') return call('setClass', value);
  if (key === 'style') return call('setStyle', value);
  if (inSvg || isCustomTag(tag)) return call('setAttr', keyNode(), value);
  const kind = (typeof TABLE[key] === 'number' ? TABLE[key] : 0) & KIND_MASK;
  if (kind === BOOL) return call('attrBool', keyNode(), value);
  if (kind === PROP) return key === 'value' ? call('attrValue', value) : call('attrState', keyNode(), value);
  if (kind === PROP_ONLY) return call('attrProp', keyNode(), value);
  if (kind === ATTR) return call('attrStr', keyNode(), value);
  return call('setAttr', keyNode(), value);
}

function compileElement(ctx, root) {
  const statements = [];
  const rootId = ctx.id('el');

  function html(node, inSvgParent) {
    const tag = node.openingElement.name.name;
    const inSvg = (inSvgParent || tag === 'svg') && tag !== 'foreignObject';
    const attributes = nativeAttributes(node);
    let out = `<${tag}`;
    const dynamic = [];
    // 原生元素的 _bind 单独接：属性本身还是原生属性，只是多接一个事件
    const others = attributes.filter((attr) => !isBindAttr(attr));
    for (const attr of attributes) {
      if (isBindAttr(attr)) dynamic.push({ kind: 'bindNative', key: attrName(attr), bind: bindOf(attrValue(attr)) });
    }
    if (usesSpread(tag, others)) {
      // spread 为了安全不写 innerHTML 这类键：作者显式写的要单独接
      const content = others.filter((attr) => !isSpreadAttr(attr) && (CONTENT_KEYS.has(rawAttrName(attr)) || (ctx.twoWayFrom && TWO_WAY.has(rawAttrName(attr)))));
      for (const attr of content) dynamic.push({ kind: 'attr', key: attrName(attr), value: attrValue(attr) });
      dynamic.unshift({ kind: 'spread', attributes: others.filter((attr) => !content.includes(attr)) });
    } else {
      const items = others.map((attr) => {
        const key = attrName(attr);
        const value = attrValue(attr);
        return { key, value, literal: literalOf(value), baked: canBake(tag, key, literalOf(value)) };
      });
      // 模板里的属性克隆时就生效：有动态属性时，排在最后写的（src、value）也要等动态属性写完
      const writesAttrs = items.some((item) => !item.baked && !isEventKey(item.key) && item.key !== 'ref');
      for (const item of items) {
        if (item.baked && writesAttrs && typeof TABLE[item.key] === 'number' && TABLE[item.key] & LATE) item.baked = false;
        if (item.baked) out += renderAttr(item.key, item.literal.value, tag);
      }
      const writes = items.filter((item) => !item.baked);
      const tier = (item) => tierOf(typeof TABLE[item.key] === 'number' ? TABLE[item.key] : 0);
      writes.sort((a, b) => tier(a) - tier(b));
      for (const item of writes) dynamic.push({ kind: 'attr', key: item.key, value: item.value });
    }
    out += '>';
    const childPlans = [];
    if (!VOID.has(tag)) {
      let textRun = false;
      const cleaned = cleanChildren(node.children);
      for (const child of cleaned) {
        // 唯一的动态子节点：直接追加到父元素，模板里不用放标记（同 Solid）
        if (cleaned.length === 1 && child.kind !== 'text' && !(child.kind === 'jsx' && isNative(child.node))) {
          childPlans.push({
            kind: 'dynamic',
            noMarker: true,
            value: child.kind === 'expr' ? child.node : compileNode(ctx, child.node),
          });
          continue;
        }
        if (child.kind === 'text') {
          // 相邻文本在解析时合成一个节点：只算一个
          out += escapeText(child.text);
          if (!textRun) childPlans.push({ kind: 'text' });
          textRun = true;
          continue;
        }
        textRun = false;
        if (child.kind === 'jsx' && isNative(child.node)) {
          const inner = html(child.node, inSvg);
          out += inner.out;
          childPlans.push({ kind: 'element', plan: inner });
        } else {
          out += '<!>';
          childPlans.push({
            kind: 'dynamic',
            value: child.kind === 'expr' ? child.node : compileNode(ctx, child.node),
          });
        }
      }
      out += `</${tag}>`;
    }
    return { out, tag, inSvg, dynamic, childPlans };
  }

  function needsRef(plan) {
    return plan.dynamic.length > 0 || plan.childPlans.some((child) => child.kind === 'dynamic' || (child.kind === 'element' && needsRef(child.plan)));
  }

  function wire(plan, id) {
    for (const item of plan.dynamic) {
      if (item.kind === 'spread') {
        statements.push(
          t.expressionStatement(t.callExpression(ctx.runtime('spread'), [t.cloneNode(id), propsExpression(ctx, item.attributes)])),
        );
        continue;
      }
      if (item.kind === 'bindNative') {
        const next = t.identifier('_next');
        statements.push(
          t.expressionStatement(
            t.callExpression(ctx.runtime('bindInput'), [
              t.cloneNode(id),
              t.stringLiteral(item.key),
              t.arrowFunctionExpression([], item.bind.target),
              t.arrowFunctionExpression([t.cloneNode(next)], writeTo(ctx, item.bind.target, t.cloneNode(next))),
              t.arrayExpression(item.bind.mods.map((mod) => t.stringLiteral(mod))),
            ]),
          ),
        );
        continue;
      }
      const { key, value } = item;
      const shell = ctx.autoBind && TWO_WAY.has(key) ? shellOf(ctx, value) : undefined;
      if (shell) {
        statements.push(t.expressionStatement(t.callExpression(ctx.bindHelper('twoWay'), [t.cloneNode(id), t.stringLiteral(key), shell])));
        continue;
      }
      if (isEventKey(key)) {
        const info = eventOf(key);
        const handler = isFunctionExpr(value) || t.isIdentifier(value)
          ? value
          : t.arrowFunctionExpression([t.identifier('_e')], t.callExpression(value, [t.identifier('_e')]));
        const args = [t.cloneNode(id), t.stringLiteral(info.exact ?? info.lower), handler];
        if (info.options) args.push(ctx.hoist(t.valueToNode(info.options)));
        statements.push(t.expressionStatement(t.callExpression(ctx.runtime('on'), args)));
      } else if (key === 'ref') {
        const setter = writable(value)
          ? t.arrowFunctionExpression([t.identifier('_node')], t.assignmentExpression('=', t.cloneNode(value), t.identifier('_node')))
          : value;
        statements.push(t.expressionStatement(t.callExpression(ctx.runtime('setRef'), [t.cloneNode(id), setter])));
      } else if (key === 'sx') {
        statements.push(t.expressionStatement(t.callExpression(ctx.runtime('setSx'), [t.cloneNode(id), value])));
      } else if (mayBeReactive(value)) {
        statements.push(
          t.expressionStatement(
            t.callExpression(ctx.runtime('renderEffect'), [
              t.arrowFunctionExpression([], t.blockStatement([t.expressionStatement(writeCall(ctx, id, key, value, plan.tag, plan.inSvg))])),
            ]),
          ),
        );
      } else {
        statements.push(t.expressionStatement(writeCall(ctx, id, key, value, plan.tag, plan.inSvg)));
      }
    }
    // 走到最后一个要用的子节点为止
    let lastNeeded = -1;
    plan.childPlans.forEach((child, index) => {
      if (child.kind === 'dynamic' || (child.kind === 'element' && needsRef(child.plan))) lastNeeded = index;
    });
    let previous;
    for (let index = 0; index <= lastNeeded; index++) {
      const child = plan.childPlans[index];
      if (child.noMarker) {
        const value = conditionGuard(ctx, statements, child.value);
        statements.push(
          t.expressionStatement(t.callExpression(ctx.runtime('insert'), [t.cloneNode(id), t.arrowFunctionExpression([], value)])),
        );
        continue;
      }
      const childId = ctx.id('c');
      // 不直接写 .firstChild / .nextSibling：水合时要跳过服务端内容里的动态段
      const access = previous
        ? t.callExpression(ctx.runtime('next'), [t.cloneNode(previous)])
        : t.callExpression(ctx.runtime('first'), [t.cloneNode(id)]);
      statements.push(t.variableDeclaration('const', [t.variableDeclarator(childId, access)]));
      if (child.kind === 'element') wire(child.plan, childId);
      if (child.kind === 'dynamic') {
        const value = conditionGuard(ctx, statements, child.value);
        statements.push(
          t.expressionStatement(
            t.callExpression(ctx.runtime('insert'), [
              t.cloneNode(id),
              t.arrowFunctionExpression([], value),
              t.cloneNode(childId),
            ]),
          ),
        );
      }
      previous = childId;
    }
  }

  const rootTag = root.openingElement.name.name;
  const svgRoot = SVG_ONLY.has(rootTag);
  const plan = html(root, svgRoot);
  const tpl = ctx.template(plan.out, svgRoot);
  statements.push(t.variableDeclaration('const', [t.variableDeclarator(rootId, t.callExpression(t.cloneNode(tpl), []))]));
  wire(plan, rootId);
  statements.push(t.returnStatement(t.cloneNode(rootId)));
  return t.callExpression(t.arrowFunctionExpression([], t.blockStatement(statements)), []);
}

/**
 * {list.map((item, i) => <li key={item.id}>…</li>)} → 列表组件。组件体只执行一次，普通的 map 只会渲染一遍，
 * 所以 JSX 子节点位置的 map 就是列表，不用再学一个 <For>。
 *   没写 key：按对象身份复用行，item 就是对象本身（深代理保证身份稳定）。
 *   写了 key：id 相同的行复用，数据换了行跟着更新，所以 item 编译成读取（item()）。
 *   i 总是读取：重排时要更新。解构的参数改写成属性读取，否则解构那一刻就丢了响应性。
 */
function compileMapToFor(path, ctx) {
  // {list.map(…)}，也认 {cond ? list.map(…) : <Empty />}、{cond && list.map(…)}
  let holder = path.parentPath;
  while (holder.isConditionalExpression() || holder.isLogicalExpression() || holder.isParenthesizedExpression?.()) holder = holder.parentPath;
  if (!holder.isJSXExpressionContainer()) return;
  const callee = path.node.callee;
  if (!t.isMemberExpression(callee) || callee.computed || callee.property.name !== 'map') return;
  const fn = path.get('arguments.0');
  if (!fn.isArrowFunctionExpression()) return;
  let body = fn.node.body;
  if (t.isParenthesizedExpression(body)) body = body.expression;
  if (!t.isJSXElement(body)) return;

  const attributes = body.openingElement.attributes;
  const keyAttr = attributes.find((attr) => t.isJSXAttribute(attr) && attr.name.name === 'key');
  const keyed = !!keyAttr;
  if (keyed) attributes.splice(attributes.indexOf(keyAttr), 1);
  const [itemParam, indexParam] = fn.get('params');
  const itemId = ctx.id('item');
  const rewriteRead = (binding, read) => {
    for (const ref of [...binding.referencePaths]) {
      if (t.isObjectProperty(ref.parent) && ref.parent.shorthand) ref.parent.shorthand = false;
      ref.replaceWith(read());
    }
  };
  const readItem = () => (keyed ? valueOf(itemId.name) : t.identifier(itemId.name));

  // key 用行的原始数据算，不经过读取
  let keyFn;
  if (keyed) {
    const keyParam = t.cloneNode(itemParam.node);
    const keyValue = t.cloneNode(keyAttr.value.expression);
    keyFn = t.arrowFunctionExpression([keyParam], keyValue);
  }
  if (itemParam?.isObjectPattern()) {
    for (const property of itemParam.node.properties) {
      const key = property.key.name;
      const binding = fn.scope.getBinding(property.value.name);
      rewriteRead(binding, () => t.memberExpression(readItem(), t.identifier(key)));
    }
  } else if (itemParam) {
    rewriteRead(fn.scope.getBinding(itemParam.node.name), readItem);
  }
  if (indexParam) {
    const name = indexParam.node.name;
    rewriteRead(fn.scope.getBinding(name), () => valueOf(name));
  }
  fn.node.params[0] = t.identifier(itemId.name);

  const properties = [getterProperty('each', callee.object), dataProperty('children', fn.node)];
  if (keyFn) properties.push(dataProperty('key', keyFn));
  const list = t.callExpression(ctx.runtime('component'), [ctx.runtime('For'), t.objectExpression(properties)]);
  builtContent.add(list);
  path.replaceWith(list);
}

function plugin(_api, options) {
  return {
    name: 'hilt-prototype',
    visitor: {
      Program: {
        enter(program) {
          const ctx = new FileContext(program);
          ctx.generate = options.generate ?? 'client';
          ctx.twoWayFrom = options.twoWayFrom;
          ctx.autoBind = options.autoBind;
          ctx.hot = options.hot;
          if (ctx.hot) prepareHot(program, ctx, options.source);
          else if (options.dev) wrapHotStyles(program, ctx, options.filename);
          compileRunes(program, ctx);
          for (const wrap of ctx.hotWraps) wrap();
          program.scope.crawl();
          // 在编译 JSX 之前：要从行的根元素上取下 key
          program.traverse({ CallExpression: (path) => compileMapToFor(path, ctx) });
          program.scope.crawl();
          // sx：'split' 静态项与动态项分开（默认）；'whole' 整段当读取（基准对照用）
          if ((options.sx ?? 'split') === 'split') {
            program.traverse({
              JSXAttribute(path) {
                if (path.node.name.name !== 'sx' || !t.isJSXExpressionContainer(path.node.value)) return;
                const result = sxExpression(ctx, path.scope, path.node.value.expression);
                if (result) path.node.value.expression = result;
              },
            });
          }
          program.traverse({
            'JSXElement|JSXFragment': {
              exit(path) {
                const parent = path.parent;
                if (t.isJSXElement(parent) || t.isJSXFragment(parent)) return;
                path.replaceWith(compileNode(ctx, path.node));
                path.skip();
              },
            },
          });
          if (ctx.hot) {
            const { skeleton, surface, otherExports, sideEffects } = ctx.hotInfo;
            const moduleId = JSON.stringify(ctx.hot);
            ctx.runtime('hotModule');
            ctx.runtime('hotCommit');
            program.pushContainer(
              'body',
              t.expressionStatement(t.callExpression(t.identifier('_hilt_hotModule'), [t.stringLiteral(ctx.hot), t.stringLiteral(skeleton), t.stringLiteral(surface)])),
            );
            if (!sideEffects) ctx.footer = `\nif (import.meta.hot) import.meta.hot.accept((mod) => { if (mod) _hilt_hotCommit(${moduleId}, ${otherExports}, import.meta.hot); });\n`;
          }
          ctx.finish();
          options.onFooter?.(ctx.footer ?? '');
        },
      },
    },
  };
}

/** 只要可读类名和样式热更新、不要组件热更新（构建期 dev）：`const styles = create({...})` → hotStyles('文件:styles', create({...}, '文件.styles')) */
function wrapHotStyles(program, ctx, filename) {
  const base = String(filename).split(/[\\/]/).pop().replace(/\.[jt]sx?$/, '');
  for (const statement of program.node.body) {
    const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!t.isVariableDeclaration(declaration)) continue;
    for (const declarator of declaration.declarations) {
      if (!t.isIdentifier(declarator.id) || !t.isCallExpression(declarator.init) || !isStyleCall(declarator.init)) continue;
      const init = declarator.init;
      if (t.isIdentifier(init.callee, { name: 'create' }) && init.arguments.length === 1) init.arguments.push(t.stringLiteral(`${base}.${declarator.id.name}`));
      declarator.init = t.callExpression(ctx.css('hotStyles'), [t.stringLiteral(`${filename}:${declarator.id.name}`), init]);
    }
  }
}

export async function compile(code, filename, { generate = 'client', hot, sx = 'split', dev = false, twoWayFrom, autoBind } = {}) {
  let footer = '';
  const result = await transformAsync(code, {
    filename,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [[plugin, { generate, hot, sx, dev, filename, twoWayFrom, autoBind, source: code, onFooter: (text) => (footer = text) }], [typescript, { isTSX: true, allExtensions: true }]],
    generatorOpts: { jsescOption: { minimal: true } },
  });
  return { code: result.code + footer, map: result.map };
}

/** Vite 插件：只编译应用自己的文件，node_modules 里的预编译产物不碰 */
export function hilt() {
  return {
    name: 'hilt',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0];
      if (file.includes('node_modules') || !file.endsWith('.tsx')) return null;
      return compile(code, file);
    },
  };
}
void syntaxJsx;
