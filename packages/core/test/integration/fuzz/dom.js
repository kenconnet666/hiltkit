// 页面里用的 DOM 工具（打进浏览器端的 bundle）：规范化、比较、变动记录。
// 规范化的目的是“两棵 DOM 该不该算同一个界面”：
//   - 注释一律丢掉（动态段标记 <!--[--> <!--]-->、相邻文本分隔 <!---->）；相邻文本合并，空文本丢掉
//   - class 当集合、style 当 属性->值 表（浏览器解析后的）
//   - useId 的值按首次出现的顺序改名（水合之后新建的组件拿到的编号和从头挂载不同，只要对得上就行）
//   - 表单控件比较“当前状态”（value / checked / selected property），default attribute（value、checked、selected）单独放在 d 里，
//     严格模式才比：它们只影响 form.reset() 和属性选择器
const XHTML = 'http://www.w3.org/1999/xhtml';
/** 只表示“默认值”的 attribute：input 的 value / checked，option 的 selected（option 的 value 是真属性，不算） */
const isDefaultAttr = (tag, name) =>
  (tag === 'input' && (name === 'value' || name === 'checked')) ||
  (tag === 'option' && name === 'selected');

/** 行内样式的规范形式：浏览器解析后的 属性:值 排序 */
export function styleSignature(el) {
  const map = [];
  for (let i = 0; i < el.style.length; i++) {
    const name = el.style[i];
    map.push(`${name}:${el.style.getPropertyValue(name)}${el.style.getPropertyPriority(name)}`);
  }
  return map.sort().join(';');
}

/**
 * select 的当前选中项。两种情况下“选哪个”本来就没有统一语义，只记原因不比结果：
 *   - 值（data-want，构建器写的）不匹配任何 option：服务端解析出来默认选第一项，客户端 el.value = x 会变成什么都不选
 *   - 有重复的 option value：服务端把每个匹配项都标 selected（解析器取最后一个），客户端 el.value = x 取第一个
 */
function selectState(el) {
  const values = [...el.options].map((option) => option.value);
  const want = el.getAttribute('data-want');
  if (want !== null && !values.includes(want)) return { unmatched: true };
  if (new Set(values).size !== values.length) return { duplicateValues: true };
  return { value: el.value, index: el.selectedIndex };
}

function elementShape(el, strict) {
  const tag = el.localName;
  const a = {};
  const d = {};
  for (const attr of [...el.attributes].sort((x, y) => (x.name < y.name ? -1 : 1))) {
    if (attr.name === 'class') {
      const tokens = [...new Set(attr.value.split(/\s+/).filter(Boolean))].sort();
      if (tokens.length) a.class = tokens.join(' ');
    } else if (attr.name === 'style') {
      const text = styleSignature(el);
      if (text) a.style = text;
    } else if (isDefaultAttr(tag, attr.name)) d[attr.name] = attr.value;
    else a[attr.name] = attr.value;
  }
  const out = {
    tag: el.namespaceURI === XHTML ? tag : `${el.namespaceURI.split('/').pop()}:${tag}`,
    a,
  };
  if (tag === 'input') {
    out.p = { value: el.value, checked: el.checked };
  } else if (tag === 'textarea') out.p = { value: el.value };
  else if (tag === 'select') out.p = selectState(el);
  if (strict && Object.keys(d).length) out.d = d;
  return out;
}

function children(node, strict) {
  const out = [];
  let text = '';
  const flush = () => {
    if (text) out.push(text);
    text = '';
  };
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) text += child.data;
    else if (child.nodeType === 1) {
      flush();
      out.push(shape(child, strict));
    }
  }
  flush();
  return out;
}
function shape(el, strict) {
  const out = elementShape(el, strict);
  // textarea 的文本是 default value，当前值在 p.value 里
  if (el.localName !== 'textarea') {
    const kids = children(el, strict);
    if (kids.length) out.c = kids;
  }
  return out;
}

// useId 的值形如 h0、h1-2。页面里不能出现 <h1>~<h6> 这样的标签名（会被当成 id 改名），构建器避开了它们
const ID_TOKEN = /\bh\d+(?:-\d+)*\b/g;
/** 容器里的内容 -> 可比较的 JSON。strict = 连 default attribute 一起比 */
export function normalize(host, { strict = false } = {}) {
  const text = JSON.stringify(children(host, strict));
  const names = new Map();
  const renamed = text.replace(ID_TOKEN, (token) => {
    if (!names.has(token)) names.set(token, `#${names.size}`);
    return names.get(token);
  });
  return JSON.parse(renamed);
}

/** 第一处不同：返回路径加两边的值，相同返回 undefined */
export function firstDiff(a, b, path = '') {
  if (a === b) return undefined;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object')
    return `${path || '/'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b))
    return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  if (Array.isArray(a)) {
    if (a.length !== b.length)
      return `${path}: 子节点数 ${a.length} ≠ ${b.length}  左 ${JSON.stringify(a).slice(0, 300)}  右 ${JSON.stringify(b).slice(0, 300)}`;
    for (let i = 0; i < a.length; i++) {
      const found = firstDiff(
        a[i],
        b[i],
        `${path}/${typeof a[i] === 'object' && a[i] ? a[i].tag : 'text'}[${i}]`,
      );
      if (found) return found;
    }
    return undefined;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = firstDiff(a[key], b[key], `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

/** 容器里所有节点（含注释、文本）按文档序 */
export function allNodes(host) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ALL);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

const describe = (record) =>
  `${record.type}:${record.target.nodeName}${record.attributeName ? `@${record.attributeName}` : ''}${record.addedNodes?.length ? `+${[...record.addedNodes].map((n) => n.nodeName).join()}` : ''}${record.removedNodes?.length ? `-${[...record.removedNodes].map((n) => n.nodeName).join()}` : ''}`;

/** 记录一个容器里的全部变动。take() 取走到现在为止的记录 */
export function watch(host) {
  const observer = new MutationObserver(() => {});
  observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
  return {
    take: () => observer.takeRecords(),
    describe,
    stop: () => observer.disconnect(),
  };
}

/** 页面级的报错收集：pageerror 之外，hilt 内核里被边界吞掉的错误也算 */
export function collectErrors() {
  const errors = [];
  window.addEventListener('error', (event) => errors.push(`error: ${event.message}`));
  window.addEventListener('unhandledrejection', (event) =>
    errors.push(`unhandledrejection: ${event.reason}`),
  );
  const original = console.error;
  console.error = (...args) => {
    errors.push(`console.error: ${args.map(String).join(' ')}`);
    original.apply(console, args);
  };
  console.warn = () => {};
  return errors;
}
