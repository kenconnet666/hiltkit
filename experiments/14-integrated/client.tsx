import { component, hydrate, mount } from '@hilt/runtime';
import * as app from './app.tsx';

const host = (id: string) => {
  const el = document.createElement('div');
  el.id = id;
  document.body.append(el);
  return el;
};
(window as any).app = app;
(window as any).mountCase = (name: string) => mount(() => component((app as any)[name], {}), host(`host-${name}`));
(window as any).hydrateCase = (name: string, target: HTMLElement) => hydrate(() => component((app as any)[name], {}), target);
/** 两条路写出来的属性：[spread 的结果, 编译路径的结果] */
(window as any).attrPairs = () => {
  const out = [];
  for (let index = 0; index < app.attrCount; index++) {
    const a = host(`a${index}`);
    mount(() => component(app.AttrSpread, { index }), a);
    const b = host(`b${index}`);
    mount(() => app.attrCompiled[index](), b);
    const read = (root: HTMLElement) => {
      const el = root.firstElementChild as any;
      const attrs: any = Object.fromEntries([...el.attributes].map((attr: any) => [attr.name, attr.value]).sort());
      // style 的文本格式不算差别（setProperty 和字面量序列化不同），比解析后的结果
      if (attrs.style) attrs.style = el.style.cssText;
      return { attrs, value: el.value, checked: el.checked };
    };
    out.push([read(a), read(b)]);
  }
  return out;
};
