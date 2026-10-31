/**
 * 按当前语言和时区格式化日期、数字、金额、相对时间、列表。
 *
 *   const format = useFormat();
 *   <td>{() => format.date(order.createdAt)}</td>
 *
 * 写在函数里才跟着语言变，这和框架的规则一致：`{format.date(x)}` 只取一次。
 * 空值返回空字符串，表格、列表里不用每处判断；格式不对时原样显示输入，并上报问题。
 */
import { reportIssue } from 'hiltkit';
import { parseDate, type DateInput, type ParsedDate } from './dates';
import { dateFormatter, listFormatter, numberFormatter, relativeFormatter } from './intl-cache';
import { useLocaleState, type LocaleState } from './locale';

type Empty = null | undefined;
type NumberInput = number | bigint | string;

export interface RelativeOptions extends Intl.RelativeTimeFormatOptions {
  /** 相对于哪个时刻，默认现在。结果不会自己跟着时间走，要刷新就放进定时更新的信号里 */
  now?: DateInput;
}

export interface Formatter {
  /** 日期：默认 `{ dateStyle: 'medium' }`。没有时区的字符串（'2026-10-31'）是几号就显示几号 */
  date(value: DateInput | Empty, options?: Intl.DateTimeFormatOptions): string;
  /** 时间：默认 `{ timeStyle: 'short' }` */
  time(value: DateInput | Empty, options?: Intl.DateTimeFormatOptions): string;
  /** 日期和时间：默认 `{ dateStyle: 'medium', timeStyle: 'short' }` */
  dateTime(value: DateInput | Empty, options?: Intl.DateTimeFormatOptions): string;
  /** 相对时间：“昨天”“3 小时后”，自动选单位 */
  relative(value: DateInput | Empty, options?: RelativeOptions): string;
  /** 数字：`{ style: 'percent' }`、`{ maximumFractionDigits: 2 }` 都可以。字符串按十进制原样算，不丢精度 */
  number(value: NumberInput | Empty, options?: Intl.NumberFormatOptions): string;
  /** 金额：不传币种时用 Provider 的 currency */
  currency(
    value: NumberInput | Empty,
    currency?: string,
    options?: Intl.NumberFormatOptions,
  ): string;
  /** 列表：“甲、乙和丙” */
  list(items: Iterable<string> | Empty, options?: Intl.ListFormatOptions): string;
}

const DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
const TIME: Intl.DateTimeFormatOptions = { timeStyle: 'short' };
const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

const badDate = (value: unknown): string => {
  reportIssue(
    'HILT006',
    `格式化不了这个日期：${String(value)}。`,
    '传 Date、时间戳或 ISO 字符串。',
  );
  return String(value);
};

function formatDate(
  state: LocaleState,
  value: DateInput | Empty,
  options: Intl.DateTimeFormatOptions,
): string {
  if (value == null || value === '') return '';
  const parsed = parseDate(value);
  if (!parsed) return badDate(value);
  const calendar = state.calendar();
  const hourCycle = state.explicitHourCycle();
  const resolved: Intl.DateTimeFormatOptions = {
    ...(calendar ? { calendar } : {}),
    ...(hourCycle ? { hourCycle } : {}),
    // 墙上时间在 UTC 下显示回写的数字，换算才会出错；时刻才看时区。这样纯日期也不依赖时区
    timeZone: parsed.wall ? 'UTC' : (options.timeZone ?? state.timeZone()),
    ...options,
    ...(parsed.wall ? { timeZone: 'UTC' } : {}),
  };
  return dateFormatter(state.locale(), resolved).format(parsed.time);
}

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
];
/** 墙上时间要和“当前时区的今天”比，昨天、明天才对 */
function wallNow(state: LocaleState, now: number): number {
  const parts = dateFormatter('en-US', {
    timeZone: state.timeZone(),
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(now);
  const part = (type: string) => +parts.find((item) => item.type === type)!.value;
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
}
function formatRelative(
  state: LocaleState,
  value: DateInput | Empty,
  options: RelativeOptions,
): string {
  if (value == null || value === '') return '';
  const parsed: ParsedDate | undefined = parseDate(value);
  if (!parsed) return badDate(value);
  const { now, ...rest } = options;
  const base = now === undefined ? Date.now() : (parseDate(now)?.time ?? Date.now());
  const from = parsed.wall ? wallNow(state, base) : base;
  const diff = parsed.time - from;
  const size = Math.abs(diff);
  const [unit, ms] = UNITS.find(([, length]) => size >= length) ?? UNITS[UNITS.length - 1]!;
  return relativeFormatter(state.locale(), { numeric: 'auto', ...rest }).format(
    Math.trunc(diff / ms),
    unit,
  );
}

/** 拿到当前语言的格式化方法。方法在调用时才读语言和时区 */
export function useFormat(): Formatter {
  const state = useLocaleState();
  const number = (value: NumberInput | Empty, options?: Intl.NumberFormatOptions) =>
    value == null || value === ''
      ? ''
      : numberFormatter(state.locale(), options).format(value as number);
  return {
    date: (value, options = DATE) => formatDate(state, value, options),
    time: (value, options = TIME) => formatDate(state, value, options),
    dateTime: (value, options = DATE_TIME) => formatDate(state, value, options),
    relative: (value, options = {}) => formatRelative(state, value, options),
    number,
    currency(value, currency = state.currency(), options) {
      if (currency) return number(value, { ...options, style: 'currency', currency });
      reportIssue(
        'HILT007',
        '格式化金额时没有币种。',
        '给 Provider 传 currency，或者调用时传币种。',
      );
      return number(value, options);
    },
    list: (items, options) =>
      items == null ? '' : listFormatter(state.locale(), options).format(items),
  };
}
