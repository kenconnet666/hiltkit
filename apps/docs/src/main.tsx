import { mount, sig } from 'hiltkit';
import { Provider, commonMessages, useFormat, useLocale, useMessages } from '@hiltkit/ui';
import zhCN from '@hiltkit/ui/locale/zh-CN';

const NOW = '2026-10-31T16:30:00Z';
const LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'ar-EG'];
const ZONES = ['Asia/Shanghai', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];

/** 骨架演示，外观等主题定了再做 */
function Readout() {
  const format = useFormat();
  const t = useMessages(commonMessages);
  const { dir, hourCycle, timeZone, weekStart } = useLocale();
  return (
    <dl>
      <dt>时刻（换算到时区）</dt>
      <dd id="instant">{() => format.dateTime(NOW)}</dd>
      <dt>纯日期（不换算）</dt>
      <dd id="plain">{() => format.date('2026-10-31')}</dd>
      <dt>相对时间</dt>
      <dd>{() => format.relative('2026-10-31', { now: NOW })}</dd>
      <dt>数字和金额</dt>
      <dd>{() => `${format.number(1234.5)} / ${format.currency(1234.5)}`}</dd>
      <dt>列表</dt>
      <dd>{() => format.list(['A', 'B', 'C'])}</dd>
      <dt>组件文案</dt>
      <dd id="close">{() => t().close}</dd>
      <dt>时区、方向、小时制、周起始</dt>
      <dd>{() => `${timeZone()} · ${dir()} · ${hourCycle()} · ${weekStart()}`}</dd>
    </dl>
  );
}

function App() {
  const locale = sig('zh-CN');
  const timeZone = sig('Asia/Shanghai');
  const chooseLocale = (event: Event) => locale.set((event.target as HTMLSelectElement).value);
  const chooseZone = (event: Event) => timeZone.set((event.target as HTMLSelectElement).value);
  return (
    <Provider
      locale={locale}
      timeZone={timeZone}
      currency="CNY"
      messages={() => (locale() === 'zh-CN' ? zhCN : undefined)}
    >
      <main>
        <h1>hiltkit</h1>
        <label>
          语言
          <select id="locale" onChange={chooseLocale}>
            {LOCALES.map((item) => (
              <option value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          时区
          <select id="zone" onChange={chooseZone}>
            {ZONES.map((item) => (
              <option value={item}>{item}</option>
            ))}
          </select>
        </label>
        <Readout />
      </main>
    </Provider>
  );
}

mount(() => <App />, document.getElementById('app')!);
