/**
 * 描述对象 → DOM。新建和水合共用一条路：水合时不建节点，沿 `hydration.ts` 的游标认领已有节点。
 *
 * 组件只是函数，执行一次就没了，不占节点；响应式只活在 `renderRegion`（函数子节点）和属性绑定里，
 * 所以更新时只有依赖了变化数据的那一小段重跑。
 */
import { closeOf, cursor, hydrating, isMark, setCursor } from '../hydration';
import {
  devHooks,
  getContext,
  renderEffect,
  runSetup,
  untrack,
  withContext,
} from '../reactivity/kernel';
import { applyProps } from './props';
import { Custom, VNode } from './vnode';

const SVG = 'http://www.w3.org/2000/svg';

function renderElement(node: VNode, parent: Node, before: Node | null, svg: boolean): void {
  const tag = node.type as string;
  const inSvg = (svg || tag === 'svg') && tag !== 'foreignObject';
  let el: any;
  if (hydrating) {
    el = cursor;
    if (devHooks && el?.localName !== tag) devHooks.mismatch(tag, el);
    setCursor(el.nextSibling);
  } else {
    el = inSvg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  }
  const { props } = node;
  devHooks?.element(el, node);
  const children = props.children;
  if (children !== undefined) {
    // 唯一的子节点是文字：一次 textContent，不用建文本节点再插入
    if (!hydrating && (typeof children === 'string' || typeof children === 'number')) {
      el.textContent = children;
    } else if (hydrating) {
      const resume = cursor;
      setCursor(el.firstChild);
      renderValue(children, el, null, inSvg);
      setCursor(resume);
    } else {
      renderValue(children, el, null, inSvg);
    }
  }
  // 子节点先于属性：select 的 value 要 option 在
  applyProps(el, props, tag);
  if (!hydrating) parent.insertBefore(el, before);
}

function renderComponent(node: VNode, parent: Node, before: Node | null, svg: boolean): void {
  if (devHooks) devHooks.component(node, () => mountComponent(node, parent, before, svg));
  else mountComponent(node, parent, before, svg);
}
function mountComponent(node: VNode, parent: Node, before: Node | null, svg: boolean): void {
  const record = node.type.$$hot;
  if (record) {
    // 开发期：每个实例单独一段，改了组件只重建这一段
    renderRegion(
      () => {
        void record.version.value;
        return new Custom(
          (p, b, s) =>
            runSetup((props: unknown) => renderValue(record.current(props), p, b, s), node.props),
          () => '',
        );
      },
      parent,
      before,
      svg,
    );
    return;
  }
  // 在组件体的作用域里渲染结果：provide 出来的 context 对内容有效，组件直接返回 children 也一样
  runSetup((props: unknown) => renderValue(node.type(props), parent, before, svg), node.props);
}

/**
 * 动态段：函数子节点。依赖一变整段重跑，换掉起止标记之间的内容。
 * 绝大多数动态段只是一段文字，所以先用一个裸文本节点，不放标记；内容变成别的才升级成带标记的范围。
 */
export function renderRegion(
  source: () => unknown,
  parent: Node,
  before: Node | null,
  svg: boolean,
): void {
  let start: Node | undefined;
  let end: Node | undefined;
  let adopting = hydrating;
  if (adopting) {
    start = cursor!;
    end = closeOf(start);
  }
  const saved = getContext();
  let text: Text | undefined;
  let rangeText: Text | undefined;
  const openRange = (target: Node, at: Node | null) => {
    start = document.createComment('[');
    end = document.createComment(']');
    target.insertBefore(start, at);
    target.insertBefore(end, at);
  };
  devHooks?.label('region', parent);
  renderEffect(() => {
    let value = withContext(saved, source);
    while (typeof value === 'function') value = withContext(saved, value as () => unknown);
    if (!start) {
      const primitive = typeof value === 'string' || typeof value === 'number';
      if (text) {
        if (primitive) {
          text.data = String(value);
          return;
        }
        // 文字变成别的内容：这时才放起止标记，把文字节点换掉
        const host = text.parentNode!;
        openRange(host, text);
        host.removeChild(text);
        text = undefined;
      } else if (primitive && parent.nodeType === 1) {
        // 列表行的片段（nodeType 11）里要放标记，行靠它们记范围
        text = document.createTextNode(String(value));
        parent.insertBefore(text, before);
        return;
      } else {
        openRange(parent, before);
      }
    }
    const target = end!.parentNode!;
    if (adopting) {
      adopting = false;
      setCursor(start!.nextSibling);
      untrack(() => withContext(saved, () => renderValue(value, target, end!, svg)));
      setCursor(end!.nextSibling);
      const only = start!.nextSibling;
      if (only !== end && only!.nextSibling === end && only!.nodeType === 3)
        rangeText = only as Text;
      return;
    }
    if (rangeText && (typeof value === 'string' || typeof value === 'number')) {
      rangeText.data = String(value);
      return;
    }
    rangeText = undefined;
    for (let node = start!.nextSibling; node !== end; node = start!.nextSibling)
      target.removeChild(node!);
    untrack(() => withContext(saved, () => renderValue(value, target, end!, svg)));
    if (typeof value === 'string' || typeof value === 'number')
      rangeText = start!.nextSibling as Text;
  });
}

/** 渲染任意子节点：null、布尔不输出，数组逐项，函数是动态段，其余转文字 */
export function renderValue(value: unknown, parent: Node, before: Node | null, svg = false): void {
  if (value == null || value === true || value === false) return;
  if (Array.isArray(value)) {
    for (const item of value) renderValue(item, parent, before, svg);
    return;
  }
  if (typeof value === 'function') return renderRegion(value as () => unknown, parent, before, svg);
  if (value instanceof VNode) {
    return typeof value.type === 'function'
      ? renderComponent(value, parent, before, svg)
      : renderElement(value, parent, before, svg);
  }
  if (value instanceof Custom) return value.dom(parent, before, svg);
  if (typeof Node !== 'undefined' && value instanceof Node) {
    parent.insertBefore(value, before);
    return;
  }
  const textValue = String(value);
  if (hydrating) {
    if (
      devHooks &&
      textValue !== '' &&
      cursor?.nodeType === 3 &&
      (cursor as Text).data !== textValue
    ) {
      devHooks.mismatch(textValue, cursor);
    }
    // 相邻文字之间服务端放了空注释分隔，这里跳过
    if (isMark(cursor, '')) setCursor(cursor!.nextSibling);
    if (textValue !== '' && cursor?.nodeType === 3) setCursor(cursor.nextSibling);
    return;
  }
  parent.insertBefore(document.createTextNode(textValue), before);
}
