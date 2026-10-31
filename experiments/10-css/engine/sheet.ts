/**
 * 引擎的样式表：一张 <style>，规则按名字（类名、关键帧名、变量组名）登记，同样的内容只插一次；
 * 记下规则原文（SSR 输出、测试断言用），热更新时按名字换掉。
 */
import { config } from './config';

interface Entry {
  /** 规则原文（含 @layer 包装） */
  texts: readonly string[];
  /** CSSOM 里的规则，热更新时按名字删掉 */
  rules: CSSRule[];
  /** 从服务端输出的样式表接管来的：只知道名字，没有原文 */
  adopted?: boolean;
  /** 开发模式：规则写成 <style> 里的文本节点（devtools 里看得到原文），热更新直接改它 */
  node?: Text;
}
const inserted = new Map<string, Entry>();
let sheet: CSSStyleSheet | null | undefined;
let styleElement: HTMLStyleElement | undefined;

/** 页面是服务端渲染出来的（接管了服务端输出的样式表） */
let fromServer = false;

/**
 * 内容会不断变化的规则（sx 对象字面量、运行时主题）：只在没有 CSSOM 的服务端限量记住，
 * 超过上限丢最早的。浏览器里规则在 CSSOM 里、元素还在用，不能丢。
 */
const volatileNames = new Set<string>();
export const VOLATILE_LIMIT = 2000;

/**
 * 引擎自己的样式表：放在 head 最前面，宿主页面后加载的同等特异性的 CSS 能盖过组件库。
 * 服务端渲染输出过这张表（renderStyleTag）时直接接管它：表里已有的规则按 data-names 登记，不再重复插入
 */
function styleSheet(): CSSStyleSheet | null {
  if (sheet !== undefined) return sheet;
  if (typeof document === 'undefined') return (sheet = null);
  const rendered = document.querySelector<HTMLStyleElement>('style[data-hilt-css]');
  if (rendered?.sheet) {
    fromServer = true;
    for (const name of rendered.dataset.names?.split(' ') ?? []) {
      if (name && !inserted.has(name)) inserted.set(name, { texts: [], rules: [], adopted: true });
    }
    styleElement = rendered;
    return (sheet = rendered.sheet);
  }
  const element = document.createElement('style');
  element.dataset.hiltCss = '';
  document.head.prepend(element);
  styleElement = element;
  sheet = element.sheet;
  if (config.layerOrder) {
    if (config.dev) element.append(layerOrderRule());
    else sheet!.insertRule(layerOrderRule(), 0);
  }
  return sheet;
}

const layerOrderRule = () => `@layer ${config.layerOrder};`;
const wrap = (text: string) => (config.layer ? `@layer ${config.layer}{${text}}` : text);

/** 插入一个名字的规则（已有时先删掉旧的：热更新改写规则） */
export function insert(name: string, texts: readonly string[], volatile = false) {
  const target = styleSheet();
  const previous = inserted.get(name);
  if (config.dev && styleElement) {
    // 开发模式：一个名字一个文本节点。insertRule 的规则 devtools 的元素面板里看不到原文，也没法直接改
    const node = previous?.node ?? styleElement.appendChild(document.createTextNode(''));
    const wrapped = texts.map(wrap);
    node.data = `${wrapped.join('\n')}\n`;
    inserted.set(name, { texts: wrapped, rules: [], node });
    return;
  }
  if (previous && target) {
    for (const rule of previous.rules) {
      const index = Array.prototype.indexOf.call(target.cssRules, rule);
      if (index >= 0) target.deleteRule(index);
    }
  }
  const wrapped = texts.map(wrap);
  const rules: CSSRule[] = [];
  if (target) {
    for (const text of wrapped) {
      // 浏览器不认的规则跳过，同 StyleX 的 inject；样式表里写错的 CSS 本来也会被忽略
      try {
        rules.push(target.cssRules[target.insertRule(text, target.cssRules.length)]!);
      } catch {}
    }
  }
  inserted.set(name, { texts: wrapped, rules });
  if (volatile && !target) {
    volatileNames.delete(name);
    volatileNames.add(name);
    if (volatileNames.size > VOLATILE_LIMIT) {
      const oldest = volatileNames.values().next().value!;
      volatileNames.delete(oldest);
      inserted.delete(oldest);
    }
  }
}

/**
 * 按名字登记的规则（变量组）：同名再调用换成新的（热更新重新执行模块），
 * 但接管服务端样式表时服务端已经输出过，不重复插入
 */
export function insertNamed(name: string, texts: readonly string[]) {
  if (sheet === undefined) styleSheet();
  if (inserted.get(name)?.adopted) return;
  insert(name, texts);
}

/**
 * 动态样式是否一律写成变量（dynamic.ts）：在服务端渲染、或接管了服务端渲染的页面里是。
 * 动态样式平时把"一直没变过的值"直接写进类里，是否变过记在整个进程里：服务端渲染过许多页面后早已转成变量，
 * 刚打开的浏览器却还没有，同一个元素两边的类就对不上（水合不一致）。一律写成变量，两边按同样的规则出类
 */
export function variablesOnly(): boolean {
  if (sheet === undefined) styleSheet();
  return sheet === null || fromServer;
}

/** 水合开始时调用：页面没带 renderStyleTag 的样式表也是服务端渲染的，动态样式同样要写成变量 */
export function markServerRendered() {
  fromServer = true;
}

/** 这个名字的规则插过没有；浏览器里第一次问时先接管服务端输出的样式表（见 styleSheet） */
export function isInserted(name: string): boolean {
  if (sheet === undefined) styleSheet();
  return inserted.has(name);
}

/** 规则表里现在有多少个名字（测试：服务端长期运行时不能无限增长） */
export const insertedCount = () => inserted.size;

export interface StyleTagOptions {
  /** 就算 HTML 里没出现也要带上的类名（防闪烁脚本会往 <html> 上加的主题类） */
  include?: readonly string[];
}

/**
 * 服务端渲染：一段 HTML 用到的规则写成一个 `<style data-hilt-css data-names="…">`，放进 head 的最前面。
 * 包括 class 里出现的引擎类名（组合类、主题类、标记）、这些规则引用的关键帧，以及全部变量组（:root 上的默认值）。
 * 类名按内容哈希，同样的样式在所有请求里同名，所以不必按请求隔离：渲染完按 HTML 取用到的就行。
 * 客户端接管这张表，data-names 里的规则不再重复插入
 */
export function renderStyleTag(html: string, options: StyleTagOptions = {}): string {
  const used = new Set<string>(options.include?.filter((name) => inserted.has(name)));
  for (const match of html.matchAll(/\bclass="([^"]*)"/g)) {
    for (const name of match[1]!.split(/\s+/)) if (inserted.has(name)) used.add(name);
  }
  for (const name of inserted.keys()) if (name.startsWith('--')) used.add(name);
  // 规则里引用的关键帧（animation 的名字也是引擎生成的 k…）
  for (const name of [...used]) {
    for (const text of inserted.get(name)!.texts) {
      for (const frame of text.match(/\bk[0-9a-z]+\b/g) ?? []) if (inserted.has(frame)) used.add(frame);
    }
  }
  const names = [...inserted.keys()].filter((name) => used.has(name));
  const css = [...(config.layerOrder ? [layerOrderRule()] : []), ...names.flatMap((name) => inserted.get(name)!.texts)].join('\n');
  // 规则原文里不会有 </style>；防御性地转义，免得用户的样式值截断标签
  return `<style data-hilt-css data-names="${names.join(' ')}">${css.replaceAll('</', '<\\/')}</style>`;
}

/** 已插入的全部规则原文，一条一行 */
export function styleText(): string {
  return [...inserted.values()].flatMap((record) => record.texts).join('\n');
}

/** murmurhash2（同 @emotion/hash、StyleX 的 createHash），转 36 进制 */
export function hash(text: string): string {
  let h = 0;
  let i = 0;
  let length = text.length;
  for (; length >= 4; ++i, length -= 4) {
    let k =
      (text.charCodeAt(i) & 0xff) |
      ((text.charCodeAt(++i) & 0xff) << 8) |
      ((text.charCodeAt(++i) & 0xff) << 16) |
      ((text.charCodeAt(++i) & 0xff) << 24);
    k = (k & 0xffff) * 0x5bd1e995 + (((k >>> 16) * 0xe995) << 16);
    k ^= k >>> 24;
    h =
      ((k & 0xffff) * 0x5bd1e995 + (((k >>> 16) * 0xe995) << 16)) ^
      ((h & 0xffff) * 0x5bd1e995 + (((h >>> 16) * 0xe995) << 16));
  }
  // 剩下不足 4 个字符的尾巴（同原算法的 switch 穿透）
  if (length >= 3) h ^= (text.charCodeAt(i + 2) & 0xff) << 16;
  if (length >= 2) h ^= (text.charCodeAt(i + 1) & 0xff) << 8;
  if (length >= 1) {
    h ^= text.charCodeAt(i) & 0xff;
    h = (h & 0xffff) * 0x5bd1e995 + (((h >>> 16) * 0xe995) << 16);
  }
  h ^= h >>> 13;
  h = (h & 0xffff) * 0x5bd1e995 + (((h >>> 16) * 0xe995) << 16);
  return ((h ^ (h >>> 15)) >>> 0).toString(36);
}
