/**
 * 语言和时区的上下文。`Provider` 写入，`useLocale`、`useFormat`、`useMessages` 读取。
 *
 * 上下文里存的都是读取函数，不是值：上层换了语言，下层不用重建就能读到新的。
 * 组件单独使用时（外面没有 Provider）拿到的是这里的根状态：en-US 加运行环境的时区。
 */
import {
  createContext,
  derived,
  inject,
  isHydrating,
  isServerRendering,
  reportIssue,
  sig,
  type ContextKey,
  type ReadSig,
} from 'hiltkit';
import type { MessagePack } from './messages';

/** 12 或 24 小时制。h11、h24 几乎没人用，不收 */
export type HourCycle = 'h12' | 'h23';
/** 一周的第一天：1 是周一，7 是周日（和 Intl 一致） */
export type WeekDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type TextDirection = 'ltr' | 'rtl';

/** 上下文里的状态。带 explicit 的只记写明的设置，用的时候才按语言补默认值 */
export interface LocaleState {
  readonly locale: ReadSig<string>;
  readonly timeZone: ReadSig<string>;
  readonly explicitDir: ReadSig<TextDirection | undefined>;
  readonly explicitHourCycle: ReadSig<HourCycle | undefined>;
  readonly explicitWeekStart: ReadSig<WeekDay | undefined>;
  readonly calendar: ReadSig<string | undefined>;
  readonly currency: ReadSig<string | undefined>;
  /** 语言包，外层在前 */
  readonly packs: ReadSig<readonly MessagePack[]>;
}

const browserZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;
/** 浏览器的时区。水合结束后才写入，读它的绑定到时候自动更新 */
const hostZone = sig.raw<string | undefined>(undefined);
let warnedServerZone = false;
let zoneScheduled = false;

/**
 * 没设时区时用哪个。服务端不知道用户在哪，用 UTC 并提醒；水合时要和服务端的输出一致，也用 UTC，
 * 等这一轮接管完再换成浏览器时区，用到时区的绑定跟着更新。
 */
function systemZone(): string {
  const known = hostZone();
  if (known) return known;
  if (isServerRendering()) {
    if (!warnedServerZone) {
      warnedServerZone = true;
      reportIssue(
        'HILT004',
        '服务端渲染时格式化了时间，但没有设时区，先按 UTC 输出，挂载后会跳到用户的时区。',
        '给 Provider 传 timeZone：用户资料或 Cookie 里存的时区。',
      );
    }
    return 'UTC';
  }
  if (isHydrating()) {
    if (!zoneScheduled) {
      zoneScheduled = true;
      queueMicrotask(() => hostZone.set(browserZone()));
    }
    return 'UTC';
  }
  return browserZone();
}

const none = () => undefined;
/** 外面没有 Provider 时的状态 */
export const rootState: LocaleState = {
  locale: () => 'en-US',
  timeZone: systemZone,
  explicitDir: none,
  explicitHourCycle: none,
  explicitWeekStart: none,
  calendar: none,
  currency: none,
  packs: () => [],
};
export const LocaleContext: ContextKey<LocaleState> = createContext<LocaleState>(rootState);
/** 当前的状态（内部用）。对外是 useLocale */
export const useLocaleState = (): LocaleState => inject(LocaleContext);

/** 语言的文字方向。阿拉伯文、希伯来文是 rtl */
export function directionOf(locale: string): TextDirection {
  const intl = new Intl.Locale(locale) as Intl.Locale & {
    getTextInfo?: () => { direction: TextDirection };
    textInfo?: { direction: TextDirection };
  };
  // 老版本是属性，新版本是方法
  return (intl.getTextInfo?.() ?? intl.textInfo)?.direction ?? 'ltr';
}
function weekStartOf(locale: string): WeekDay {
  const intl = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: WeekDay };
    weekInfo?: { firstDay: WeekDay };
  };
  return (intl.getWeekInfo?.() ?? intl.weekInfo)?.firstDay ?? 1;
}
function hourCycleOf(locale: string): HourCycle {
  const intl = new Intl.Locale(locale) as Intl.Locale & {
    getHourCycles?: () => string[];
    hourCycles?: string[];
  };
  const first = (intl.getHourCycles?.() ?? intl.hourCycles)?.[0];
  return first === 'h12' || first === 'h11' ? 'h12' : 'h23';
}

/** 当前的语言设置。都是读取函数，写在函数子节点或函数属性里就跟着变 */
export interface LocaleReaders {
  /** BCP 47 语言标签，如 zh-CN */
  readonly locale: ReadSig<string>;
  /** IANA 时区，如 Asia/Shanghai */
  readonly timeZone: ReadSig<string>;
  /** 文字方向：写了就是写的，否则按语言 */
  readonly dir: ReadSig<TextDirection>;
  /** 小时制：写了就是写的，否则按语言 */
  readonly hourCycle: ReadSig<HourCycle>;
  /** 一周的第一天：写了就是写的，否则按语言 */
  readonly weekStart: ReadSig<WeekDay>;
  /** 日历，如 buddhist；没写时是 undefined，由语言决定 */
  readonly calendar: ReadSig<string | undefined>;
  /** 默认币种，如 CNY；没写时是 undefined */
  readonly currency: ReadSig<string | undefined>;
}
/** 读当前的语言设置。外面没有 Provider 时是 en-US 加运行环境的时区 */
export function useLocale(): LocaleReaders {
  const state = useLocaleState();
  return {
    locale: state.locale,
    timeZone: state.timeZone,
    dir: derived(() => state.explicitDir() ?? directionOf(state.locale())),
    hourCycle: derived(() => state.explicitHourCycle() ?? hourCycleOf(state.locale())),
    weekStart: derived(() => state.explicitWeekStart() ?? weekStartOf(state.locale())),
    calendar: state.calendar,
    currency: state.currency,
  };
}
