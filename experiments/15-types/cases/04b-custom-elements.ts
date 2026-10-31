// 自定义元素：用声明合并登记，属性、元素类型（ref / currentTarget）、事件各管各的。
import type { BoolAttr } from '@hilt/runtime';

export class XCardElement extends HTMLElement {
  open = false;
}

declare module '@hilt/runtime/elements' {
  interface CustomElements {
    'x-card': {
      props: { heading?: string; elevated?: BoolAttr };
      element: XCardElement;
      /** 事件名连字符转驼峰：x-toggle → onXToggle */
      events: { 'x-toggle': CustomEvent<boolean> };
    };
  }
}
