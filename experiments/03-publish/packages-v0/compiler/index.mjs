// 原型编译器：符文 + JSX → 只依赖 @hilt/runtime 的纯 JS。验证产物形态，不处理所有边界情况。
//   let x = _state(v)            → const x = signal(v)，读 x()，写 x(v)
//   const x = _state({...})      → const x = deep({...})，读写都不变
//   _derived(e) / _effect(fn)    → computed(() => e) / effect(fn)
//   _component(({a = 1, ...r}) => …) → (props) => …，读 a 变成 props.a ?? 1，r = omit(props, ['a'])
//   JSX 属性的书写顺序就是合并层次：<x a="1" {...rest} b={v}/> → merge({a:'1'}, rest, {get b(){…}})
import { createHash } from 'node:crypto';
import { transformAsync, types as t } from '@babel/core';
import syntaxJsx from '@babel/plugin-syntax-jsx';
import typescript from '@babel/plugin-transform-typescript';

const RUNTIME = '@hilt/runtime';
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
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
    this.templates = [];
    this.uid = 0;
    /** _state.raw 声明的变量：写入时不包深代理 */
    this.rawSignals = new Set();
    this.hot = undefined;
    this.hotWraps = [];
    this.extraImports = new Set();
    this.hotInfo = undefined;
  }
  runtime(name) {
    this.imports.add(name);
    return t.identifier(`_hilt_${name}`);
  }
  id(prefix) {
    return t.identifier(`_${prefix}${this.uid++}`);
  }
  template(html) {
    const id = t.identifier(`_tpl${this.templates.length}`);
    this.templates.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(id, pure(t.callExpression(this.runtime('template'), [t.stringLiteral(html)]))),
      ]),
    );
    return id;
  }
  finish() {
    const specifiers = [...this.imports].map((name) =>
      t.importSpecifier(t.identifier(`_hilt_${name}`), t.identifier(name)),
    );
    const extra = [...this.extraImports].map((name) =>
      t.importDeclaration([t.importSpecifier(t.identifier(`_hilt_${name}`), t.identifier(name))], t.stringLiteral('@hilt/css-hot')),
    );
    const nodes = [...(specifiers.length ? [t.importDeclaration(specifiers, t.stringLiteral(RUNTIME))] : []), ...extra, ...this.templates];
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
  // 原型里 let 的 _state 本来就是浅的，_state.raw 按同一种处理
  // _state.raw、_bindable.raw：不代理，其余和不带 raw 的相同
  if (t.isMemberExpression(call.callee) && call.callee.property.name === 'raw' && ['_state', '_bindable'].includes(call.callee.object.name)) return call.callee.object.name;
  return undefined;
};

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
  t.isIdentifier(call.callee, { name: 'recipe' });
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
  const sideEffects = program.node.body.some((statement) => {
    if (!t.isExpressionStatement(statement)) return false;
    return !(t.isCallExpression(statement.expression) && t.isIdentifier(statement.expression.callee, { name: 'useStyleEngine' }));
  });
  program.traverse({
    CallExpression(path) {
      const declarator = topLevelDeclarator(path);
      if (!declarator) return;
      const name = declarator.node.id.name;
      if (runeOf(path.node) === '_component') componentCuts.push([path.node.start, path.node.end]);
      if (isStyleCall(path.node)) {
        cuts.push([path.node.start, path.node.end]);
        ctx.hotWraps.push(() => {
          ctx.extraImports.add('hotStyles');
          path.replaceWith(t.callExpression(t.identifier('_hilt_hotStyles'), [t.stringLiteral(`${ctx.hot}#${name}`), path.node]));
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
      if (name !== '_derived' && (name !== '_state' || kind === 'const')) {
        if (name === '_state') {
          structural.push(() => {
            const value = path.node.init.arguments[0] ?? t.identifier('undefined');
            path.get('init').replaceWith(t.callExpression(ctx.runtime('deep'), [value]));
          });
        }
        return;
      }
      const local = path.node.id.name;
      const writable = kind === 'let';
      // let 的 _state 整体替换时，新对象也要是深代理
      const deepWrites = name === '_state' && !isRawState(path.node.init);
      if (name === '_state' && isRawState(path.node.init)) ctx.rawSignals.add(local);
      rewriteReferences(
        path.scope.getBinding(local),
        () => t.callExpression(t.identifier(local), []),
        (value) => t.callExpression(t.identifier(local), [deepWrites ? t.callExpression(ctx.runtime('deep'), [value]) : value]),
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
              : t.callExpression(ctx.runtime(writable ? 'overridable' : 'computed'), [t.arrowFunctionExpression([], arg)]),
          );
      });
    },
    CallExpression(path) {
      const name = runeOf(path.node);
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
function initialValue(ctx, call) {
  const arg = call.arguments[0] ?? t.identifier('undefined');
  const value = isRawState(call) ? arg : t.callExpression(ctx.runtime('deep'), [arg]);
  return mayBeReactive(arg) ? t.callExpression(ctx.runtime('untrack'), [t.arrowFunctionExpression([], value)]) : value;
}
const bindableInitial = initialValue;

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
      // 规则一句话：声明成 _bindable 的 prop 可写、可被 _bind 绑定；其余 prop 只读
      if (runeOf(fallback) === '_bindable') {
        // 回调由组件自己调用，不能跟着 rest 落到元素上
        seen.push(changeHandlerOf(key));
        if (isRawState(fallback)) ctx.rawSignals.add(local.name);
        rewriteReferences(
          binding,
          () => t.callExpression(t.identifier(local.name), []),
          (next) => t.callExpression(t.identifier(local.name), [next]),
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
                t.booleanLiteral(isRawState(fallback)),
              ]),
            ),
          ]),
        );
      } else {
        const member = () => t.memberExpression(t.identifier(propsId.name), t.stringLiteral(key), true);
        // 默认值同 Svelte：可以是任意表达式，用到时才求值。这里用 ?? 简化（null 也走默认值，正式版要区分）
        rewriteReferences(
          binding,
          () => (fallback ? t.logicalExpression('??', member(), t.cloneNode(fallback)) : member()),
          () => {
            throw new Error(`原型不支持写 prop：${key}`);
          },
          false,
        );
      }
    }
    const restProperty = param.properties.find((property) => t.isRestElement(property));
    if (restProperty) {
      prelude.push(() =>
        t.variableDeclaration('const', [
          t.variableDeclarator(
            restProperty.argument,
            t.callExpression(ctx.runtime('omit'), [
              t.identifier(propsId.name),
              t.arrayExpression(seen.map((key) => t.stringLiteral(key))),
            ]),
          ),
        ]),
      );
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

// ---- 第 2 遍：JSX ----
const isComponentName = (name) => t.isJSXMemberExpression(name) || /^[A-Z]/.test(name.name);
function tagExpression(name) {
  if (t.isJSXMemberExpression(name)) {
    return t.memberExpression(tagExpression(name.object), t.identifier(name.property.name));
  }
  return t.identifier(name.name);
}
const attrName = (attr) =>
  t.isJSXNamespacedName(attr.name) ? `${attr.name.namespace.name}:${attr.name.name.name}` : attr.name.name;

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

/** 写回目标：x() → x(next)，对象属性 → 赋值 */
function writeTo(ctx, target, next) {
  if (t.isCallExpression(target)) {
    const raw = ctx.rawSignals.has(target.callee.name);
    return t.callExpression(t.cloneNode(target.callee), [raw ? next : t.callExpression(ctx.runtime('deep'), [next])]);
  }
  return t.assignmentExpression('=', t.cloneNode(target), next);
}

/** 属性 → 合并层的属性列表。attributes 是同一元素的全部属性 */
function propertiesOf(ctx, attr, attributes) {
  const key = attrName(attr);
  const value = attrValue(attr);
  // ref={el}：el 是可写的符文变量时把元素写进去，不用再转一道
  if (key === 'ref' && writable(value)) {
    return [dataProperty('ref', t.arrowFunctionExpression([t.identifier('_node')], t.callExpression(t.cloneNode(value.callee), [t.identifier('_node')])))];
  }
  const bind = bindOf(value);
  if (!bind) {
    // 同一元素上 value={_bind(x)} onValueChange={fn}：回调已经并进绑定里，这里不再单独生成
    const bound = attributes.some((other) => isBindAttr(other) && changeHandlerOf(attrName(other)) === key);
    return bound ? [] : [layerProperty(key, value)];
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
/** 第 1 遍之后可写的值是 x()（无参调用）或对象属性 */
const writable = (value) =>
  (t.isCallExpression(value) && !value.arguments.length && t.isIdentifier(value.callee)) || t.isMemberExpression(value);

function propsExpression(ctx, attributes, childrenValue) {
  const layers = [];
  let current = [];
  for (const attr of attributes) {
    if (t.isJSXSpreadAttribute(attr)) {
      if (current.length) layers.push(t.objectExpression(current));
      current = [];
      // 展开的值可能变：做成函数层，由 spread 跟踪键的增减。直接求值的话它就被外层 insert 读到，整个组件跟着重建
      layers.push(mayBeReactive(attr.argument) ? t.arrowFunctionExpression([], attr.argument) : attr.argument);
    } else {
      current.push(...propertiesOf(ctx, attr, attributes));
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

// ---- 服务端产物：拼字符串，没有 DOM、没有 effect。动态段前后放 [ ] 注释，水合时靠它们认领 ----
function compileElementServer(ctx, root) {
  const parts = [];
  const raw = (text) => parts.push(t.stringLiteral(text));

  function walk(node) {
    const tag = node.openingElement.name.name;
    const attributes = node.openingElement.attributes;
    raw(`<${tag}`);
    const others = attributes.filter((attr) => !isBindAttr(attr));
    for (const attr of attributes) {
      if (!isBindAttr(attr)) continue;
      const bind = bindOf(attrValue(attr));
      // 多选组要看元素的 value，服务端先不输出
      if (!bind.mods.includes('group')) parts.push(t.callExpression(ctx.runtime('ssrAttr'), [t.stringLiteral(attrName(attr)), bind.target]));
    }
    if (others.some((attr) => t.isJSXSpreadAttribute(attr) || attr.name?.name === 'sx')) {
      parts.push(t.callExpression(ctx.runtime('ssrSpread'), [propsExpression(ctx, others)]));
    } else {
      for (const attr of others) {
        const key = attrName(attr);
        const value = attrValue(attr);
        if (/^on[A-Z]/.test(key) || key === 'ref') continue;
        if (t.isStringLiteral(value)) raw(` ${key}="${escapeAttr(value.value)}"`);
        else if (t.isBooleanLiteral(value) && value.value) raw(` ${key}`);
        else if (t.isNumericLiteral(value)) raw(` ${key}="${value.value}"`);
        else parts.push(t.callExpression(ctx.runtime('ssrAttr'), [t.stringLiteral(key), value]));
      }
    }
    raw('>');
    if (VOID.has(tag)) return;
    const cleaned = cleanChildren(node.children);
    for (const child of cleaned) {
      if (child.kind === 'text') {
        raw(escapeText(child.text));
      } else if (child.kind === 'jsx' && isNative(child.node)) {
        walk(child.node);
      } else {
        const value = child.kind === 'expr' ? child.node : compileNode(ctx, child.node);
        const only = cleaned.length === 1;
        if (!only) raw('<!--[-->');
        parts.push(t.callExpression(ctx.runtime('ssrChild'), [value]));
        if (!only) raw('<!--]-->');
      }
    }
    raw(`</${tag}>`);
  }
  walk(root);
  return t.callExpression(ctx.runtime('ssr'), [t.arrayExpression(parts)]);
}

function compileComponentCall(ctx, node) {
  return t.callExpression(ctx.runtime('component'), [
    tagExpression(node.openingElement.name),
    propsExpression(ctx, node.openingElement.attributes, childrenValue(ctx, node.children)),
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
  const read = t.callExpression(t.cloneNode(id), []);
  return t.isLogicalExpression(expr)
    ? t.conditionalExpression(read, expr.right, t.nullLiteral())
    : t.conditionalExpression(read, expr.consequent, expr.alternate);
}

function compileElement(ctx, root) {
  const statements = [];
  const rootId = ctx.id('el');

  function html(node) {
    const tag = node.openingElement.name.name;
    const attributes = node.openingElement.attributes;
    // sx 要和 class 一起算，走同一条路
    const hasSpread = attributes.some((attr) => t.isJSXSpreadAttribute(attr) || attr.name?.name === 'sx');
    let out = `<${tag}`;
    const dynamic = [];
    // 原生元素的 _bind 单独接：属性本身还是原生属性，只是多接一个事件
    const others = attributes.filter((attr) => !isBindAttr(attr));
    for (const attr of attributes) {
      if (isBindAttr(attr)) dynamic.push({ kind: 'bindNative', key: attrName(attr), bind: bindOf(attrValue(attr)) });
    }
    if (hasSpread) dynamic.push({ kind: 'spread', attributes: others });
    else {
      for (const attr of others) {
        const key = attrName(attr);
        const value = attrValue(attr);
        if (t.isStringLiteral(value)) out += ` ${key}="${escapeAttr(value.value)}"`;
        else if (t.isBooleanLiteral(value) && value.value) out += ` ${key}`;
        else if (t.isNumericLiteral(value)) out += ` ${key}="${value.value}"`;
        else dynamic.push({ kind: 'attr', key, value });
      }
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
          const inner = html(child.node);
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
    return { out, tag, dynamic, childPlans };
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
      if (/^on[A-Z]/.test(key)) {
        const handler = isFunctionExpr(value) || t.isIdentifier(value)
          ? value
          : t.arrowFunctionExpression([t.identifier('_e')], t.callExpression(value, [t.identifier('_e')]));
        statements.push(
          t.expressionStatement(t.callExpression(ctx.runtime('on'), [t.cloneNode(id), t.stringLiteral(key.slice(2).toLowerCase()), handler])),
        );
      } else if (key === 'ref') {
        const setter = writable(value)
          ? t.arrowFunctionExpression([t.identifier('_node')], t.callExpression(t.cloneNode(value.callee), [t.identifier('_node')]))
          : value;
        statements.push(t.expressionStatement(t.callExpression(ctx.runtime('setRef'), [t.cloneNode(id), setter])));
      } else if (mayBeReactive(value)) {
        statements.push(
          t.expressionStatement(
            t.callExpression(ctx.runtime('effect'), [
              t.arrowFunctionExpression(
                [],
                t.blockStatement([
                  t.expressionStatement(t.callExpression(ctx.runtime('setAttr'), [t.cloneNode(id), t.stringLiteral(key), value])),
                ]),
              ),
            ]),
          ),
        );
      } else {
        statements.push(t.expressionStatement(t.callExpression(ctx.runtime('setAttr'), [t.cloneNode(id), t.stringLiteral(key), value])));
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

  const plan = html(root);
  const tpl = ctx.template(plan.out);
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
  if (!t.isJSXExpressionContainer(path.parent)) return;
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
  const readItem = () => (keyed ? t.callExpression(t.identifier(itemId.name), []) : t.identifier(itemId.name));

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
    rewriteRead(fn.scope.getBinding(name), () => t.callExpression(t.identifier(name), []));
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
          ctx.hot = options.hot;
          if (ctx.hot) prepareHot(program, ctx, options.source);
          compileRunes(program, ctx);
          for (const wrap of ctx.hotWraps) wrap();
          program.scope.crawl();
          // 在编译 JSX 之前：要从行的根元素上取下 key
          program.traverse({ CallExpression: (path) => compileMapToFor(path, ctx) });
          program.scope.crawl();
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

export async function compile(code, filename, { generate = 'client', hot } = {}) {
  let footer = '';
  const result = await transformAsync(code, {
    filename,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [[plugin, { generate, hot, source: code, onFooter: (text) => (footer = text) }], [typescript, { isTSX: true, allExtensions: true }]],
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
