import { template as _$template } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { spread as _$spread } from "solid-js/web";
import { mergeProps as _$mergeProps } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<button>: <!> / <!> `);
import { createMemo, createSignal, splitProps } from 'solid-js';

// 小组件：状态、派生、动态属性、透传 rest、children
export function Counter(props) {
  const [local, rest] = splitProps(props, ['label', 'children']);
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$5 = _el$2.nextSibling,
      _el$3 = _el$5.nextSibling,
      _el$6 = _el$3.nextSibling,
      _el$4 = _el$6.nextSibling;
    _$spread(_el$, _$mergeProps(rest, {
      get ["class"]() {
        return 'btn ' + (doubled() > 4 ? 'big' : '');
      },
      get ["data-doubled"]() {
        return doubled();
      },
      "onClick": () => setCount(c => c + 1)
    }), false, true);
    _$insert(_el$, () => local.label, _el$2);
    _$insert(_el$, count, _el$5);
    _$insert(_el$, doubled, _el$6);
    _$insert(_el$, () => local.children, null);
    return _el$;
  })();
}