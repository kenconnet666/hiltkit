/**
 * 服务端拼 HTML 的基础件：转义、单个属性、特殊元素（select、textarea、option）。
 * 规则和浏览器端共用 `attrs/rules.ts`，输出的 HTML 解析后要和客户端建出来的 DOM 同形，水合才能认领。
 */
import {
  BOOL,
  CHILD,
  KIND_MASK,
  PROP,
  PROP_ONLY,
  TABLE,
  UNSAFE_SPREAD,
  URL_ATTR,
  YESNO,
  classOf,
  config,
  layersOf,
  scan,
  styleFromValue,
  styleOf,
  styleText,
  sxValues,
  unsafeUrl,
  warn,
} from '../attrs/rules';

/** 没有要转义的字符就不做替换：大多数文字都是这样，一万行能省不少时间 */
export const escapeText = (text: unknown): string => {
  const s = String(text);
  return /[&<]/.test(s) ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;') : s;
};
const escapeAttr = (text: unknown): string => {
  const s = String(text);
  return /[&"]/.test(s) ? s.replace(/&/g, '&amp;').replace(/"/g, '&quot;') : s;
};
export const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** 单个属性写成 ` name="value"`；不出现返回 ''。tag 只用来区分 value 在不同元素上的写法 */
export function ssrAttr(name: string, value: unknown, tag = ''): string {
  if (value == null) return '';
  // class 是字符串时不建分层
  if (name === 'class' && typeof value === 'string')
    return value ? ` class="${escapeAttr(value)}"` : '';
  if (name === 'class') {
    const text = classOf([{ class: value }, undefined]);
    return text ? ` class="${escapeAttr(text)}"` : '';
  }
  if (name === 'style') {
    const text = styleText(styleFromValue(value));
    return text ? ` style="${escapeAttr(text)}"` : '';
  }
  let kind = ((TABLE[name] as number | undefined) ?? 0) & KIND_MASK;
  if (kind === URL_ATTR) {
    if (unsafeUrl(value)) {
      warn(`${name} 是 javascript: 链接，已拦截`);
      return '';
    }
    kind = 0;
  } else if (kind === YESNO) {
    if (typeof value === 'boolean') value = value ? 'yes' : 'no';
    kind = 0;
  }
  if (kind === BOOL) {
    const on = typeof value === 'string' ? value : value ? '' : null;
    return on === null ? '' : on === '' ? ` ${name}` : ` ${name}="${escapeAttr(on)}"`;
  }
  if (kind === PROP) {
    // textarea 的值是子文本，select 的值落在 option 的 selected 上
    if (name === 'value') {
      return tag === 'textarea' || tag === 'select' ? '' : ` value="${escapeAttr(value)}"`;
    }
    return value ? ` ${name}` : '';
  }
  if (kind === PROP_ONLY) return '';
  if (name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110) return '';
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol')
    return '';
  return ` ${name}="${escapeAttr(value)}"`;
}

/** 一个元素的全部属性。props 是展开过的普通对象 */
function renderAttrs(tag: string, props: object) {
  const layers = layersOf(props);
  const { names, kinds, vals, acc } = scan(layers, true);
  let attrs = '';
  let inner: string | undefined;
  let value: unknown;
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    // 明确写在 JSX 上的 innerHTML 由 server/render.ts 单独处理，走到这里的都来自动态键：来源可能不可信
    if (UNSAFE_SPREAD[name]) {
      warn(`${name} 不能经 spread 写入`);
      continue;
    }
    if ((kinds[i]! & KIND_MASK) === PROP_ONLY && CHILD[name]) {
      inner = escapeText(vals[i]);
      continue;
    }
    if (name === 'value') {
      value = vals[i];
      if (tag === 'textarea' && value != null) inner = escapeText(value);
    }
    attrs += ssrAttr(name, vals[i], tag);
  }
  if (acc) {
    const values = acc & 4 ? sxValues(layers) : [];
    const has = values.some(Boolean);
    if (has && !config.sx)
      throw new Error('sx 需要样式引擎：先导入创建样式的模块（create、recipe…）');
    const sx = has ? config.sx!(...values) : undefined;
    const classes = classOf(layers, sx?.class);
    if (classes) attrs += ` class="${escapeAttr(classes)}"`;
    const style = styleText(styleOf(layers, sx?.style));
    if (style) attrs += ` style="${escapeAttr(style)}"`;
  }
  return { attrs, inner, value };
}

/** 渲染 <select value> 的子节点时，option 靠它决定 selected */
let currentSelect: { value: unknown } | undefined;
/** select、textarea、option 的值不是普通 attribute：整个元素一起算。children 是读取函数，select 的值要先定下来 */
export function ssrElement(tag: string, props: object, children: () => string): string {
  const { attrs, inner: own, value } = renderAttrs(tag, props);
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  const previous = currentSelect;
  if (tag === 'select') currentSelect = value === undefined ? undefined : { value };
  let inner: string;
  try {
    inner = own ?? children();
  } finally {
    currentSelect = previous;
  }
  let extra = '';
  if (tag === 'option' && currentSelect && String(value ?? inner) === String(currentSelect.value)) {
    extra = ' selected';
  }
  // HTML 解析器会吞掉 <textarea> 后面紧跟的第一个换行：值以换行开头时要补一个
  if (tag === 'textarea' && /^[\r\n]/.test(inner)) inner = `\n${inner}`;
  return `<${tag}${attrs}${extra}>${inner}</${tag}>`;
}
