/**
 * Provider：给一棵子树设语言、时区和文案。可以嵌套，只覆盖写了的属性，其余实时继承上层。
 *
 *   const locale = sig('zh-CN');
 *   <Provider locale={locale} timeZone="Asia/Shanghai" messages={zhCN}>
 *     <App />
 *   </Provider>
 *
 * 属性遵循框架规则：传值只取一次，传函数或 sig 才是活的。写错的语言标签、时区不会让页面崩掉：
 * 上报问题（HILT005），回退到上一层。
 *
 * 只管语言和主题。路由、请求、权限这些不放进来，各有各的上下文，用不到就摇掉。
 */
import {
  derived,
  effect,
  provide,
  read,
  reportIssue,
  type Child,
  type Prop,
  type ReadSig,
} from 'hiltkit';
import type { Theme } from '../theme/define';
import { dateFormatter } from './intl-cache';
import {
  LocaleContext,
  directionOf,
  rootState,
  useLocaleState,
  type HourCycle,
  type LocaleState,
  type TextDirection,
  type WeekDay,
} from './locale';
import type { MessagePack } from './messages';

export interface ProviderProps {
  /** BCP 47 语言标签，如 zh-CN。决定日期、数字的格式和文字方向 */
  locale?: Prop<string | undefined>;
  /** IANA 时区，如 Asia/Shanghai。服务端渲染要写，服务端不知道用户在哪 */
  timeZone?: Prop<string | undefined>;
  /** 组件文案。可以只翻一部分，其余回退到上一层、最后是组件自带的英文 */
  messages?: Prop<MessagePack | undefined>;
  /** 文字方向。不写时：写了 locale 按语言，否则继承上层 */
  dir?: Prop<TextDirection | undefined>;
  /** 12 或 24 小时制。不写时继承上层，最后按语言 */
  hourCycle?: Prop<HourCycle | undefined>;
  /** 一周的第一天，1 是周一，7 是周日。不写时继承上层，最后按语言 */
  weekStart?: Prop<WeekDay | undefined>;
  /** 日历，如 buddhist。不写时继承上层，最后由语言决定 */
  calendar?: Prop<string | undefined>;
  /** format.currency 默认的币种，如 CNY。不写时继承上层 */
  currency?: Prop<string | undefined>;
  /** 主题：lightTheme、darkTheme、navyTheme 或 defineTheme 的结果。不写时继承上层，最外层是亮色 */
  theme?: Prop<Theme | undefined>;
  /** 按下时的波纹。不写时继承上层，默认开启 */
  ripple?: Prop<boolean | undefined>;
  children?: Child;
}

/** 校验一个设置：写错了上报并落回上层，不让 Intl 的 RangeError 把页面弄崩 */
function checked(
  value: Prop<string | undefined> | undefined,
  parent: ReadSig<string>,
  normalize: (text: string) => string,
  name: string,
): ReadSig<string> {
  return derived(() => {
    const text = read(value);
    if (text === undefined) return parent();
    try {
      return normalize(text);
    } catch {
      const fallback = parent();
      reportIssue('HILT005', `${name} 写错了：${text}，已回退到 ${fallback}。`, '检查拼写。');
      return fallback;
    }
  });
}
const normalizeLocale = (text: string): string => Intl.getCanonicalLocales(text)[0]!;
const normalizeZone = (text: string): string => {
  // 不支持的时区在建格式器时抛错。用同一个缓存，校验过的之后格式化不再多建一次
  dateFormatter('en-US', { timeZone: text });
  return text;
};
/** 写了用写的，否则继承上层 */
const inherited = <T,>(value: Prop<T | undefined> | undefined, parent: ReadSig<T>): ReadSig<T> =>
  value === undefined ? parent : () => read(value) ?? parent();

export function Provider(props: ProviderProps) {
  const parent = useLocaleState();
  const locale = checked(props.locale, parent.locale, normalizeLocale, 'locale');
  const { messages } = props;
  const state: LocaleState = {
    locale,
    timeZone: checked(props.timeZone, parent.timeZone, normalizeZone, 'timeZone'),
    // 换了语言就不继承上层写明的方向：zh-CN 里嵌一段 ar，方向应该跟着 ar
    explicitDir:
      props.locale === undefined ? inherited(props.dir, parent.explicitDir) : () => read(props.dir),
    explicitHourCycle: inherited(props.hourCycle, parent.explicitHourCycle),
    explicitWeekStart: inherited(props.weekStart, parent.explicitWeekStart),
    calendar: inherited(props.calendar, parent.calendar),
    currency: inherited(props.currency, parent.currency),
    theme: inherited(props.theme, parent.theme),
    ripple: inherited(props.ripple, parent.ripple),
    packs:
      messages === undefined
        ? parent.packs
        : derived(() => {
            const pack = read(messages);
            return pack ? [...parent.packs(), pack] : parent.packs();
          }),
  };
  provide(LocaleContext, state);
  const isRoot = parent === rootState;
  // 页面底色在容器外面，只有最外层负责，而且只在挂载后写：服务端的 html 不归组件管
  if (isRoot && props.theme !== undefined) paintDocument(state.theme);
  // 只有最外层、以及写了 locale、dir、theme 的才放元素：这一点在创建时就定了，语言、主题变化不会让子树重建。
  // 最外层总是放，服务端和客户端的结构才确定
  if (
    !isRoot &&
    props.locale === undefined &&
    props.dir === undefined &&
    props.theme === undefined
  ) {
    return props.children;
  }
  const scheme = () => state.theme()?.colorScheme;
  const common = {
    lang: locale,
    dir: () => state.explicitDir() ?? directionOf(locale()),
    style: () => ({ display: 'contents', colorScheme: scheme() }),
    'data-theme': () => state.theme()?.name,
  };
  if (props.theme === undefined) return <div {...common}>{props.children}</div>;
  return (
    <div {...common} sx={() => state.theme()?.style as never}>
      {props.children}
    </div>
  );
}

/** 页面底色和原生控件的配色方案跟着主题走 */
function paintDocument(theme: ReadSig<Theme | undefined>): void {
  effect(() => {
    const current = theme();
    const root = document.documentElement.style;
    root.backgroundColor = current?.colors.canvas ?? '';
    root.colorScheme = current?.colorScheme ?? '';
    return () => {
      root.backgroundColor = '';
      root.colorScheme = '';
    };
  });
}
