// 自定义元素的登记：声明合并，props / element / events 三项。
import type { Attr, BoolAttr } from 'hiltkit/jsx-runtime';

export interface XCardElement extends HTMLElement {
  open: boolean;
}

declare module 'hiltkit/jsx-runtime' {
  interface CustomElements {
    'x-card': {
      props: { heading?: Attr<string>; elevated?: Attr<BoolAttr> };
      element: XCardElement;
      events: { 'x-toggle': CustomEvent<boolean> };
    };
  }
}
