/**
 * 把日期输入分成两类：时刻和墙上时间。
 *
 * 时刻是时间线上的一个点（Date、时间戳、带 Z 或时差的字符串），显示时要换算到当前时区。
 * 墙上时间没有时区（'2026-10-31'、'2026-10-31T14:30'、'14:30'），写的是几点就显示几点。
 * JS 自己的解析在这里有坑：`new Date('2026-10-31')` 按 UTC 算，在纽约会显示成 10 月 30 日；
 * `new Date('2026-10-31T14:30')` 按运行环境的时区算，服务端和客户端结果不同。所以墙上时间不交给它。
 */

/** 能格式化的日期值。Temporal 的对象用 toString() 传进来 */
export type DateInput = Date | number | string;

export interface ParsedDate {
  /** 毫秒。墙上时间是把写的数字当 UTC 算出来的，只用于在 UTC 下显示回原样 */
  readonly time: number;
  /** 是不是墙上时间 */
  readonly wall: boolean;
}

const WALL_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/;
const WALL_TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

function wallTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): ParsedDate | undefined {
  const time = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const check = new Date(time);
  // Date.UTC 会把 2 月 31 日进位成 3 月：对不上就是写错了
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 24)
    return undefined;
  return { time, wall: true };
}

/** 解析日期输入。格式不对返回 undefined */
export function parseDate(value: DateInput): ParsedDate | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? { time: value, wall: false } : undefined;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : { time, wall: false };
  }
  const date = WALL_DATE.exec(value);
  if (date) {
    const [, y, mo, d, h, mi, s, ms] = date;
    return wallTime(+y!, +mo!, +d!, +(h ?? 0), +(mi ?? 0), +(s ?? 0), +(ms ?? '0').padEnd(3, '0'));
  }
  const clock = WALL_TIME.exec(value);
  if (clock) {
    const [, h, mi, s] = clock;
    return wallTime(1970, 1, 1, +h!, +mi!, +(s ?? 0));
  }
  // Temporal.ZonedDateTime 的 toString 末尾带 [Asia/Shanghai]，Date.parse 不认
  const time = Date.parse(value.replace(/\[[^\]]*\]$/, ''));
  return Number.isNaN(time) ? undefined : { time, wall: false };
}
