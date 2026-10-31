// 骨架占位：只够验证工作区链路（类型、JSX、开发解析、构建）。框架实现从 experiments/18-plain 迁入时整体替换。

/** JSX 产出的描述对象 */
export interface VNode {
  readonly type: string | ((props: Record<string, unknown>) => unknown);
  readonly props: Record<string, unknown>;
}

function render(value: unknown, parent: Node): void {
  if (value === null || value === undefined || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const item of value) render(item, parent);
    return;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    parent.appendChild(document.createTextNode(String(value)));
    return;
  }
  const { type, props } = value as VNode;
  if (typeof type === 'function') {
    render(type(props), parent);
    return;
  }
  const element = document.createElement(type);
  for (const [key, item] of Object.entries(props)) {
    if (key !== 'children') element.setAttribute(key, String(item));
  }
  render(props.children, element);
  parent.appendChild(element);
}

/** 把视图渲染进容器 */
export function mount(view: () => unknown, host: Element): void {
  render(view(), host);
}
