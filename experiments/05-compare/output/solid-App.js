import { template as _$template } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<b>child`);
import { Counter } from './Counter.jsx';

// 调用方：传 class / style / 事件 / ref / children
export function App() {
  let el;
  return _$createComponent(Counter, {
    label: "n",
    "class": "outer",
    style: {
      color: 'red'
    },
    onClick: () => console.log('outer click'),
    ref(r$) {
      var _ref$ = el;
      typeof _ref$ === "function" ? _ref$(r$) : el = r$;
    },
    get children() {
      return _tmpl$();
    }
  });
}