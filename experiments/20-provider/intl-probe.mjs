// Provider 依赖的 Intl 能力：三个浏览器和 Node 各量一遍。node 20-provider/intl-probe.mjs
import { firefox, chromium, webkit } from 'playwright';

const probe = () => {
  const has = (fn) => {
    try {
      return fn();
    } catch (error) {
      return `不支持：${error.message.slice(0, 50)}`;
    }
  };
  const time = (run, count) => {
    const start = performance.now();
    for (let i = 0; i < count; i++) run(i);
    return +((performance.now() - start) / count * 1000).toFixed(2);
  };
  const date = new Date(Date.UTC(2026, 9, 31, 16, 30));
  const cached = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' });
  return {
    temporal: typeof Temporal !== 'undefined',
    getTextInfo: has(() => JSON.stringify(new Intl.Locale('ar').getTextInfo?.() ?? new Intl.Locale('ar').textInfo ?? '无')),
    getWeekInfo: has(() => JSON.stringify(new Intl.Locale('zh-CN').getWeekInfo?.() ?? new Intl.Locale('zh-CN').weekInfo ?? '无')),
    getHourCycles: has(() => JSON.stringify(new Intl.Locale('zh-CN').getHourCycles?.() ?? new Intl.Locale('zh-CN').hourCycles ?? '无')),
    durationFormat: typeof Intl.DurationFormat !== 'undefined',
    timeZones: has(() => Intl.supportedValuesOf('timeZone').length),
    resolvedZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    shanghai: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(date),
    tokyoEn: new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo', hourCycle: 'h23' }).format(date),
    buddhist: new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium', timeZone: 'UTC' }).format(date),
    badZone: has(() => new Intl.DateTimeFormat('en', { timeZone: 'Mars/Base' }).format(date)),
    badLocale: has(() => new Intl.DateTimeFormat('not_a_locale').format(date)),
    plainDateUtcBug: new Date('2026-10-31').toLocaleDateString('en-US', { timeZone: 'America/New_York' }),
    relative: new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(-1, 'day'),
    list: new Intl.ListFormat('zh-CN').format(['甲', '乙', '丙']),
    currency: new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(1234.5),
    usPerNewDateFormat: time(() => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }), 300),
    usPerCachedFormat: time((i) => cached.format(date.getTime() + i), 3000),
    usPerNewNumberFormat: time(() => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }), 300),
  };
};

const results = { node: probe() };
for (const [name, kind] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await kind.launch();
  const page = await browser.newPage();
  results[name] = await page.evaluate(probe);
  await browser.close();
}
const keys = Object.keys(results.node);
console.log(`| 项目 | ${Object.keys(results).join(' | ')} |`);
console.log(`| --- | ${Object.keys(results).map(() => '---').join(' | ')} |`);
for (const key of keys) console.log(`| ${key} | ${Object.values(results).map((row) => String(row[key]).replaceAll('|', '/')).join(' | ')} |`);
