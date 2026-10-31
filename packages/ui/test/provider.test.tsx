// Provider 的行为：真浏览器里跑。服务端渲染和水合在 integration/run.mjs
import { describe, expect, test, vi } from 'vitest';
import { flushSync, mount, sig } from 'hiltkit';
import {
  Provider,
  commonMessages,
  defineMessages,
  useFormat,
  useLocale,
  useMessages,
  type Formatter,
  type LocaleReaders,
} from '@hiltkit/ui';
import zhCN from '@hiltkit/ui/locale/zh-CN';

const render = (view: () => unknown) => {
  const host = document.createElement('div');
  mount(view, host);
  return host;
};
/** 拿到 Provider 里面的 useLocale、useFormat */
function inside(props: Record<string, unknown>) {
  let locale!: LocaleReaders;
  let format!: Formatter;
  const Probe = () => {
    locale = useLocale();
    format = useFormat();
    return null;
  };
  render(() => (
    <Provider {...props}>
      <Probe />
    </Provider>
  ));
  return { locale, format };
}
const INSTANT = '2026-10-31T16:30:00Z';

describe('设置和继承', () => {
  test('外面没有 Provider：en-US 加运行环境的时区，方向按语言', () => {
    let locale!: LocaleReaders;
    const Probe = () => {
      locale = useLocale();
      return null;
    };
    render(() => <Probe />);
    expect(locale.locale()).toBe('en-US');
    expect(locale.timeZone()).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(locale.dir()).toBe('ltr');
  });

  test('嵌套只覆盖写了的，其余继承', () => {
    let outer!: LocaleReaders;
    let inner!: LocaleReaders;
    const Outer = () => ((outer = useLocale()), null);
    const Inner = () => ((inner = useLocale()), null);
    render(() => (
      <Provider locale="zh-CN" timeZone="Asia/Shanghai" currency="CNY" hourCycle="h12">
        <Outer />
        <Provider timeZone="Asia/Tokyo">
          <Inner />
        </Provider>
      </Provider>
    ));
    expect(outer.timeZone()).toBe('Asia/Shanghai');
    expect(inner.timeZone()).toBe('Asia/Tokyo');
    expect(inner.locale()).toBe('zh-CN');
    expect(inner.currency()).toBe('CNY');
    expect(inner.hourCycle()).toBe('h12');
  });

  test('默认值跟着语言：方向、周起始、小时制', () => {
    const { locale } = inside({ locale: 'ar-EG' });
    expect(locale.dir()).toBe('rtl');
    const us = inside({ locale: 'en-US' }).locale;
    expect(us.weekStart()).toBe(7);
    expect(us.hourCycle()).toBe('h12');
    const cn = inside({ locale: 'zh-CN' }).locale;
    expect(cn.weekStart()).toBe(1);
    expect(cn.hourCycle()).toBe('h23');
  });

  test('写明的设置优先于语言的默认值', () => {
    const { locale } = inside({ locale: 'ar-EG', dir: 'ltr', weekStart: 3, hourCycle: 'h23' });
    expect(locale.dir()).toBe('ltr');
    expect(locale.weekStart()).toBe(3);
    expect(locale.hourCycle()).toBe('h23');
  });

  test('内层换语言不继承上层写明的方向', () => {
    let inner!: LocaleReaders;
    const Inner = () => ((inner = useLocale()), null);
    render(() => (
      <Provider locale="zh-CN" dir="ltr">
        <Provider locale="ar">
          <Inner />
        </Provider>
      </Provider>
    ));
    expect(inner.dir()).toBe('rtl');
  });

  test('写错的语言和时区：回退到上层并上报，不崩', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let inner!: LocaleReaders;
    const Inner = () => ((inner = useLocale()), null);
    render(() => (
      <Provider locale="zh-CN" timeZone="Asia/Tokyo">
        <Provider locale="not_a_locale" timeZone="Mars/Base">
          <Inner />
        </Provider>
      </Provider>
    ));
    expect(inner.locale()).toBe('zh-CN');
    expect(inner.timeZone()).toBe('Asia/Tokyo');
    expect(warn.mock.calls.map((call) => String(call[0])).join()).toContain('HILT005');
    warn.mockRestore();
  });
});

describe('DOM', () => {
  test('最外层放带 lang、dir 的元素，不影响布局', () => {
    const host = render(() => (
      <Provider locale="ar-EG">
        <p>x</p>
      </Provider>
    ));
    const wrapper = host.firstElementChild as HTMLElement;
    expect(wrapper.lang).toBe('ar-EG');
    expect(wrapper.dir).toBe('rtl');
    expect(wrapper.style.display).toBe('contents');
  });

  test('内层只改时区不放元素，写了语言才放', () => {
    const host = render(() => (
      <Provider locale="zh-CN">
        <Provider timeZone="Asia/Tokyo">
          <i id="a" />
        </Provider>
        <Provider locale="en-US">
          <i id="b" />
        </Provider>
      </Provider>
    ));
    expect(host.querySelector('#a')!.parentElement).toBe(host.firstElementChild);
    expect((host.querySelector('#b')!.parentElement as HTMLElement).lang).toBe('en-US');
  });

  test('切换语言只更新 lang，子树不重建', () => {
    const locale = sig('zh-CN');
    let builds = 0;
    const Child = () => {
      builds++;
      return <em>x</em>;
    };
    const host = render(() => (
      <Provider locale={locale}>
        <Child />
      </Provider>
    ));
    const em = host.querySelector('em');
    locale.set('ar');
    flushSync();
    expect(builds).toBe(1);
    expect(host.querySelector('em')).toBe(em);
    expect((host.firstElementChild as HTMLElement).dir).toBe('rtl');
  });
});

describe('格式化', () => {
  test('时刻按当前时区换算', () => {
    const { format } = inside({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' });
    expect(format.dateTime(INSTANT)).toBe('2026年11月1日 00:30');
    const tokyo = inside({ locale: 'en-US', timeZone: 'Asia/Tokyo', hourCycle: 'h23' }).format;
    expect(tokyo.dateTime(INSTANT)).toBe('Nov 1, 2026, 01:30');
  });

  test('Date、时间戳、带时差的字符串、Temporal 的写法都算时刻', () => {
    const { format } = inside({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' });
    const expected = '2026年11月1日 00:30';
    expect(format.dateTime(new Date(INSTANT))).toBe(expected);
    expect(format.dateTime(Date.parse(INSTANT))).toBe(expected);
    expect(format.dateTime('2026-11-01T00:30:00+08:00')).toBe(expected);
    expect(format.dateTime('2026-11-01T00:30:00+08:00[Asia/Shanghai]')).toBe(expected);
  });

  test('没有时区的字符串是墙上时间：在哪都显示写的那个', () => {
    for (const timeZone of ['America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      const { format } = inside({ locale: 'zh-CN', timeZone });
      expect(format.date('2026-10-31')).toBe('2026年10月31日');
      expect(format.dateTime('2026-10-31T14:30')).toBe('2026年10月31日 14:30');
      expect(format.time('14:30')).toBe('14:30');
    }
  });

  test('空值返回空字符串', () => {
    const { format } = inside({ locale: 'zh-CN' });
    for (const empty of [null, undefined, '']) {
      expect(format.date(empty)).toBe('');
      expect(format.number(empty)).toBe('');
      expect(format.currency(empty, 'CNY')).toBe('');
      expect(format.relative(empty)).toBe('');
    }
    expect(format.list(null)).toBe('');
  });

  test('写错的日期：原样显示并上报', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { format } = inside({ locale: 'zh-CN', timeZone: 'UTC' });
    expect(format.date('不是日期')).toBe('不是日期');
    expect(format.date('2026-02-31')).toBe('2026-02-31');
    expect(warn.mock.calls.map((call) => String(call[0])).join()).toContain('HILT006');
    warn.mockRestore();
  });

  test('日历和小时制', () => {
    const { format } = inside({ locale: 'th-TH', calendar: 'buddhist', timeZone: 'UTC' });
    expect(format.date(INSTANT)).toContain('2569');
    const h12 = inside({ locale: 'en-US', timeZone: 'UTC', hourCycle: 'h12' }).format;
    expect(h12.time(INSTANT)).toMatch(/4:30.PM/);
  });

  test('数字、金额、列表', () => {
    const { format } = inside({ locale: 'zh-CN', currency: 'CNY' });
    expect(format.number(1234.5)).toBe('1,234.5');
    expect(format.number(0.25, { style: 'percent' })).toBe('25%');
    expect(format.number('12345678901234567890.12')).toBe('12,345,678,901,234,567,890.12');
    expect(format.currency(1234.5)).toBe('¥1,234.50');
    expect(format.currency(5, 'USD')).toBe('US$5.00');
    expect(format.list(['甲', '乙', '丙'])).toBe('甲、乙和丙');
  });

  test('没有币种：显示数字并上报', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { format } = inside({ locale: 'zh-CN' });
    expect(format.currency(5)).toBe('5');
    expect(warn.mock.calls.map((call) => String(call[0])).join()).toContain('HILT007');
    warn.mockRestore();
  });

  test('相对时间：时刻看间隔，纯日期看当前时区的今天', () => {
    const now = Date.parse('2026-10-31T16:30:00Z');
    const { format } = inside({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' });
    expect(format.relative(now - 3 * 3_600_000, { now })).toBe('3小时前');
    expect(format.relative(now + 5 * 60_000, { now })).toBe('5分钟后');
    // 上海此刻已经是 11 月 1 日
    expect(format.relative('2026-10-31', { now })).toBe('昨天');
    const york = inside({ locale: 'zh-CN', timeZone: 'America/New_York' }).format;
    expect(york.relative('2026-10-31', { now })).toMatch(/今天|小时/);
  });

  test('绑定跟着语言和时区更新，只更新用到的', () => {
    const locale = sig('zh-CN');
    const timeZone = sig('Asia/Shanghai');
    let runs = 0;
    let other = 0;
    const Child = () => {
      const format = useFormat();
      return (
        <p>
          <b>
            {() => {
              runs++;
              return format.dateTime(INSTANT);
            }}
          </b>
          <i>
            {() => {
              other++;
              return format.number(1000);
            }}
          </i>
        </p>
      );
    };
    const host = render(() => (
      <Provider locale={locale} timeZone={timeZone} hourCycle="h23">
        <Child />
      </Provider>
    ));
    expect(host.querySelector('b')!.textContent).toBe('2026年11月1日 00:30');
    expect([runs, other]).toEqual([1, 1]);
    timeZone.set('Asia/Tokyo');
    flushSync();
    expect(host.querySelector('b')!.textContent).toBe('2026年11月1日 01:30');
    // 时区变了，数字不读时区，不用重算
    expect([runs, other]).toEqual([2, 1]);
    locale.set('en-US');
    flushSync();
    expect(host.querySelector('b')!.textContent).toBe('Nov 1, 2026, 01:30');
    expect([runs, other]).toEqual([3, 2]);
  });

  test('同样的设置不重复建格式器', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    const { format } = inside({ locale: 'de-DE', timeZone: 'Europe/Berlin' });
    format.date(INSTANT);
    const calls = spy.mock.calls.length;
    for (let i = 0; i < 100; i++) format.date(Date.parse(INSTANT) + i);
    expect(spy.mock.calls.length).toBe(calls);
    spy.mockRestore();
  });
});

describe('文案', () => {
  const dialog = defineMessages('dialog-test', {
    title: 'Edit',
    remove: (name: string) => `Remove ${name}?`,
  });
  const packs = (messages: unknown) => messages as never;

  test('默认是组件自带的英文', () => {
    let t!: ReturnType<typeof useMessages<typeof dialog.defaults>>;
    const Probe = () => ((t = useMessages(dialog)), null);
    render(() => <Probe />);
    expect(t().title).toBe('Edit');
    expect(t().remove('A')).toBe('Remove A?');
  });

  test('语言包覆盖，没翻的回退英文', () => {
    let t!: ReturnType<typeof useMessages<typeof dialog.defaults>>;
    const Probe = () => ((t = useMessages(dialog)), null);
    render(() => (
      <Provider messages={packs({ 'dialog-test': { title: '编辑' } })}>
        <Probe />
      </Provider>
    ));
    expect(t().title).toBe('编辑');
    expect(t().remove('A')).toBe('Remove A?');
  });

  test('内层语言包盖外层，其余继承', () => {
    let t!: ReturnType<typeof useMessages<typeof dialog.defaults>>;
    const Probe = () => ((t = useMessages(dialog)), null);
    render(() => (
      <Provider
        messages={packs({
          'dialog-test': { title: '编辑', remove: (name: string) => `删除${name}？` },
        })}
      >
        <Provider messages={packs({ 'dialog-test': { title: '修改' } })}>
          <Probe />
        </Provider>
      </Provider>
    ));
    expect(t().title).toBe('修改');
    expect(t().remove('甲')).toBe('删除甲？');
  });

  test('切语言包：文案跟着变', () => {
    const messages = sig.raw<typeof zhCN | undefined>(undefined);
    const Child = () => {
      const t = useMessages(commonMessages);
      return <button>{() => t().close}</button>;
    };
    const host = render(() => (
      <Provider messages={messages}>
        <Child />
      </Provider>
    ));
    expect(host.querySelector('button')!.textContent).toBe('Close');
    messages.set(zhCN);
    flushSync();
    expect(host.querySelector('button')!.textContent).toBe('关闭');
    messages.set(undefined);
    flushSync();
    expect(host.querySelector('button')!.textContent).toBe('Close');
  });
});
