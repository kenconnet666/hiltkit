/**
 * 主题 tokens 的短写：样式里整个值写 '_xs'（按属性查 token-map.ts 的对照表找组）或 '_space.md'（带组名），
 * 展开声明时换成 token 变量 `var(--…)`。tokens 由主题库用 defineTokens 登记（@zerodep-dev/vue-tsx-pro-ui 的 config/theme/tokens.ts）。
 * 补全、悬停靠类型（主题库用 declare module 填入的 token 接口）；写错的 token 在第一次用到时报错。
 */
import { TOKEN_GROUP_OF } from './token-map';

/** 组名（colors、space…）→ 这组 token 的变量引用 */
const registry = new Map<string, Readonly<Record<string, string>>>();

const TOKEN = /^_(?:(\w+)\.)?(\w+)$/;
/** 值中间夹着的 token 短写（'calc(-1 * _xs)'）：只认整个值，夹在中间的不会换成变量 */
const EMBEDDED = /(?:^|[\s(,])(_[A-Za-z]\w*(?:\.\w+)?)(?=$|[\s),])/;

/**
 * 登记主题 tokens：组名 → defineVars 的结果，返回原对象（主题库把它导出成 `t`，`t.space.md` 用在模板字符串里）。
 * 同名的组后登记的为准
 */
export function defineTokens<const Groups extends Record<string, Readonly<Record<string, string>>>>(
  groups: Groups,
): Groups {
  for (const [name, group] of Object.entries(groups)) registry.set(name, group);
  return groups;
}

/** 整个值是 token 的短写时换成 token 变量；不是时原样返回，夹在值中间的短写报错 */
export function resolveToken(property: string, text: string): string {
  const match = text.charCodeAt(0) === 95 ? TOKEN.exec(text) : null;
  if (!match) {
    const embedded = text.includes('_') ? EMBEDDED.exec(text)?.[1] : undefined;
    if (embedded) {
      const path = embedded.includes('.') ? embedded.slice(1) : `组.${embedded.slice(1)}`;
      throw new Error(
        `样式：${property} 的值 '${text}' 中间夹着 token ${embedded}，只有整个值是 token 时才换成变量；` +
          `请写成模板字符串里的 \${t.${path}}`,
      );
    }
    return text;
  }
  const [, qualified, name] = match;
  const group = qualified ?? TOKEN_GROUP_OF.get(property);
  if (!group) {
    throw new Error(
      `样式：${property} 没有短写对应的 token 组，'${text}' 要写带组名的 '_组.${name}'`,
    );
  }
  const value = registry.get(group)?.[name!];
  if (value === undefined) {
    const hint = registry.size ? '' : '；主题 tokens 还没登记（defineTokens）';
    throw new Error(`样式：找不到 token '${text}'（${property}，${group} 组）${hint}`);
  }
  return value;
}
