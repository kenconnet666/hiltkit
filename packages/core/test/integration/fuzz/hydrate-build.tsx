// 水合方向的共用件（Node 端 renderToString 和浏览器端挂载 / 水合共用同一份）：
//   用例 JSON（描述一棵组件树）+ 状态（sig）-> 描述对象。没有编译器，所以直接 createElement / 组件函数。
// 节点种类 t：text、dyn（函数子节点）、sw（() => 条件 ? A : B）、when、for、frag、el、comp、id、input、checkbox、textarea、select、svg
import { For, createElement, merge, sig, useId, when } from 'hiltkit';
import { Fragment } from 'hiltkit/jsx-runtime';
import { create } from 'hiltkit/css';

// ---- 组件 ----
const styles = create({
  root: { padding: '3px' },
  active: { fontWeight: 700 },
  bar: (width: string) => ({ width }),
});

/** ...rest 转交到原生元素；children 原样传 */
function Box({ children, ...rest }: any) {
  return <div {...rest}>{children}</div>;
}
function Inline({ children, ...rest }: any) {
  return <span {...rest}>{children}</span>;
}
/** 内容 prop：title 可以是文本、节点、函数 */
function Card({ title, children, ...rest }: any) {
  return (
    <section {...rest}>
      <header>{title}</header>
      {children}
    </section>
  );
}
/** 直接返回 children */
function Pass({ children }: any) {
  return children;
}
/** 库自己的属性 + 使用方的属性，显式合并 */
function Merged({ children, ...rest }: any) {
  return (
    <div {...merge({ class: 'base', title: 'base-title', 'data-lib': 'x' }, rest)}>{children}</div>
  );
}
function Labelled({ label }: any) {
  const id = useId();
  return (
    <>
      <label for={id}>{label}</label>
      <input id={id} />
    </>
  );
}
const COMPONENTS: Record<string, any> = { Box, Inline, Card, Pass, Merged };

// ---- 状态 ----
/** 用例里的初值 { b0: false, s0: 'a', l0: [{id,label}] } -> { b0: sig, ... } */
export const makeState = (init: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(init).map(([name, value]) => [name, sig(value)])) as Record<
    string,
    any
  >;

// ---- 属性 ----
const WRAPS: Record<string, (value: any) => any> = {
  id: (value) => value,
  upper: (value) => (typeof value === 'string' ? value.toUpperCase() : value),
  nullIfEmpty: (value) => (value === '' ? null : value),
  undefIfEmpty: (value) => (value === '' ? undefined : value),
};
function attrValue(spec: any, st: any, row: any): any {
  switch (spec.k) {
    case 's':
      return spec.v;
    case 'd':
      return () => WRAPS[spec.w ?? 'id']!(st[spec.ref]());
    case 'bool':
      return () => !!st[spec.ref]();
    case 'if':
      return () => (st[spec.ref]() ? spec.v : spec.else);
    case 'item':
      return row.keyed ? () => row.item()[spec.f] : row.item[spec.f];
    case 'cls':
      return spec.items.map((item: any) => attrValue(item, st, row));
    case 'sty':
      return Object.fromEntries(
        spec.e.map(([name, value]: any) => [name, attrValue(value, st, row)]),
      );
    case 'sx':
      return spec.items.map((item: any) => {
        if (item.k === 'root') return styles.root;
        if (item.k === 'cond') return () => st[item.ref]() && styles.active;
        return () => styles.bar(st[item.ref]());
      });
    default: // ev
      return () => {};
  }
}
const attrsOf = (attrs: any, st: any, row: any) =>
  Object.fromEntries(
    Object.entries(attrs ?? {}).map(([name, spec]: any) => [name, attrValue(spec, st, row)]),
  );

// ---- 节点 ----
const content = (kids: any[] | undefined, st: any, row: any) => {
  if (!kids || !kids.length) return undefined;
  const built = kids.map((kid) => nodeOf(kid, st, row));
  return built.length === 1 ? built[0] : built;
};
/** 双向绑定的控件打个标记，页面端的“用户输入”操作只找它们 */
const fz = (n: any) => (n.mode === 'two' ? { 'data-fz': n.ref } : {});
function formValue(n: any, st: any) {
  if (n.mode === 'two') return st[n.ref];
  if (n.mode === 'one') return () => st[n.ref]();
  if (n.mode === 'static') return n.v;
  return undefined;
}
function nodeOf(n: any, st: any, row: any): unknown {
  switch (n.t) {
    case 'text':
      return n.num !== undefined ? n.num : n.v;
    case 'dyn':
      if (n.mode === 'sig') return st[n.ref];
      if (n.mode === 'maybe') return () => st[n.ref]() || null;
      if (n.mode === 'prefix') return () => `v:${st[n.ref]()}`;
      return () => st[n.ref]();
    case 'sw':
      return () => (st[n.ref]() ? nodeOf(n.a, st, row) : n.b ? nodeOf(n.b, st, row) : null);
    case 'when':
      return when(
        st[n.ref],
        () => nodeOf(n.then, st, row) as never,
        n.otherwise ? () => nodeOf(n.otherwise, st, row) as never : undefined,
      );
    case 'for': {
      const keyed = !!n.by;
      const each = n.eachFn ? () => st[n.ref]() : st[n.ref];
      const render = (item: any, index: () => number) => nodeOf(n.row, st, { keyed, item, index });
      return createElement(For, {
        each,
        by: keyed ? (item: any) => item.id : undefined,
        children: render,
      });
    }
    case 'item':
      return row.keyed ? () => row.item()[n.f] : row.item[n.f];
    case 'index':
      return row.index;
    case 'frag':
      return n.fragment
        ? createElement(Fragment, { children: content(n.kids, st, row) })
        : n.kids.map((kid: any) => nodeOf(kid, st, row));
    case 'el':
      return createElement(n.tag, {
        ...attrsOf(n.attrs, st, row),
        children: content(n.kids, st, row),
      });
    case 'comp': {
      const props: any = attrsOf(n.props, st, row);
      if (n.title) props.title = nodeOf(n.title, st, row);
      props.children = content(n.kids, st, row);
      return createElement(COMPONENTS[n.c], props);
    }
    case 'id':
      return createElement(Labelled, { label: n.label });
    case 'input':
      return createElement('input', {
        type: 'text',
        ...fz(n),
        ...attrsOf(n.attrs, st, row),
        value: formValue(n, st),
      });
    case 'checkbox':
      return createElement('input', {
        type: 'checkbox',
        ...fz(n),
        ...attrsOf(n.attrs, st, row),
        checked: formValue(n, st),
      });
    case 'textarea':
      return createElement('textarea', {
        ...fz(n),
        ...attrsOf(n.attrs, st, row),
        value: formValue(n, st),
      });
    case 'select':
      return createElement('select', {
        ...fz(n),
        'data-want': n.mode === 'static' ? n.v : () => st[n.ref](),
        ...attrsOf(n.attrs, st, row),
        value: formValue(n, st),
        children: content(n.kids, st, row),
      });
    default: // svg
      return createElement('svg', {
        viewBox: '0 0 10 10',
        ...attrsOf(n.attrs, st, row),
        children: content(n.kids, st, row),
      });
  }
}
export const build = (spec: any, st: any) => nodeOf(spec, st, undefined);
