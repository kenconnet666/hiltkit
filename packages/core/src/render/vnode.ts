/**
 * 描述对象：JSX 的产物。标准 JSX 转换成 `jsx(type, props)`，这里就是它返回的东西。
 * 它只描述“要什么”，真正建 DOM 在 `render.ts`，拼字符串在 `server/render.ts`。
 */

/** 一个元素（type 是标签名）或组件（type 是函数） */
export class VNode {
  readonly type: any;
  readonly props: any;
  /** 开发模式的 JSX 传来的源码位置，调试工具用。生产构建没有这个字段 */
  declare source?: unknown;
  constructor(type: any, props: any) {
    this.type = type;
    this.props = props;
  }
}

/** 不是元素、不是组件，自己决定怎么渲染（列表、错误边界、传送、懒加载） */
export class Custom {
  /** 客户端怎么渲染：插到 parent 的 before 前面 */
  readonly dom: (parent: Node, before: Node | null, svg: boolean) => void;
  /** 服务端怎么渲染：返回 HTML，子内容用传进来的 toHtml */
  readonly html: (toHtml: (value: unknown) => string) => string;
  constructor(
    dom: (parent: Node, before: Node | null, svg: boolean) => void,
    html: (toHtml: (value: unknown) => string) => string,
  ) {
    this.dom = dom;
    this.html = html;
  }
}

/** 不用 JSX 时手写描述对象 */
export const createElement = (type: any, props?: any): VNode => new VNode(type, props ?? {});
