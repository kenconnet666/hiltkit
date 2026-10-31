import { mount, sig } from 'hiltkit';
import { create } from 'hiltkit/css';
import {
  Button,
  Provider,
  commonMessages,
  darkTheme,
  lightTheme,
  navyTheme,
  transitions,
  useFormat,
  useLocale,
  useMessages,
  type Theme,
} from '@hiltkit/ui';
import zhCN from '@hiltkit/ui/locale/zh-CN';

const NOW = '2026-10-31T16:30:00Z';
const LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'ar-EG'];
const ZONES = ['Asia/Shanghai', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
const THEMES: Record<string, Theme> = { light: lightTheme, dark: darkTheme, navy: navyTheme };

// token 直接写在样式里：有补全，写错类型报错
const styles = create({
  page: {
    maxWidth: '720px',
    marginInline: 'auto',
    padding: '_xxl',
    display: 'grid',
    rowGap: '_xl',
  },
  title: { fontSize: '_xl', fontWeight: '_medium', lineHeight: '_tight', margin: '_none' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '_sm', rowGap: '_sm' },
  label: { display: 'grid', rowGap: '_xs', fontSize: '_xs', color: '_textSecondary' },
  select: {
    height: '_controlMd',
    paddingInline: '_sm',
    borderWidth: '_thin',
    borderStyle: 'solid',
    borderColor: '_border',
    borderRadius: '_sm',
    backgroundColor: 'transparent',
    color: '_text',
    fontSize: '_sm',
  },
  table: {
    margin: '_none',
    display: 'grid',
    gridTemplateColumns: '200px 1fr',
    borderTopWidth: '_hairline',
    borderTopStyle: 'solid',
    borderTopColor: '_borderWeak',
    fontSize: '_sm',
  },
  term: { color: '_textSecondary' },
  cell: {
    margin: '_none',
    paddingBlock: '_sm',
    borderBottomWidth: '_hairline',
    borderBottomStyle: 'solid',
    borderBottomColor: '_borderWeak',
  },
  dialog: {
    width: '340px',
    padding: '_xl',
    color: '_text',
    backgroundColor: '_elevated',
    borderWidth: '_hairline',
    borderStyle: 'solid',
    borderColor: '_borderWeak',
    borderRadius: '_md',
    boxShadow: '_modal',
  },
  drawer: {
    width: '320px',
    maxWidth: 'none',
    height: '100dvh',
    maxHeight: 'none',
    marginBlock: '_none',
    marginInlineStart: 'auto',
    marginInlineEnd: '_none',
    padding: '_xl',
    color: '_text',
    backgroundColor: '_elevated',
    borderWidth: '_none',
    borderInlineStartWidth: '_hairline',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: '_borderWeak',
    boxShadow: '_modal',
  },
});

/** 骨架演示：外观定稿前只用来验证 token、动效和 Provider */
function Readout() {
  const format = useFormat();
  const t = useMessages(commonMessages);
  const { dir, hourCycle, timeZone, weekStart } = useLocale();
  const rows: [string, string, () => string][] = [
    ['instant', '时刻（换算到时区）', () => format.dateTime(NOW)],
    ['plain', '纯日期（不换算）', () => format.date('2026-10-31')],
    ['relative', '相对时间', () => format.relative('2026-10-31', { now: NOW })],
    ['money', '数字和金额', () => `${format.number(1234.5)} / ${format.currency(1234.5)}`],
    ['list', '列表', () => format.list(['A', 'B', 'C'])],
    ['close', '组件文案', () => t().close],
    [
      'settings',
      '时区、方向、小时制、周起始',
      () => `${timeZone()} · ${dir()} · ${hourCycle()} · ${weekStart()}`,
    ],
  ];
  return (
    <dl sx={styles.table}>
      {rows.map(([id, label, value]) => (
        <>
          <dt sx={[styles.cell, styles.term]}>{label}</dt>
          <dd id={id} sx={styles.cell}>
            {value}
          </dd>
        </>
      ))}
    </dl>
  );
}

function App() {
  const locale = sig('zh-CN');
  const timeZone = sig('Asia/Shanghai');
  const themeName = sig('light');
  let dialog: HTMLDialogElement | null = null;
  let drawer: HTMLDialogElement | null = null;
  const value = (event: Event) => (event.target as HTMLSelectElement).value;
  return (
    <Provider
      locale={locale}
      timeZone={timeZone}
      currency="CNY"
      messages={() => (locale() === 'zh-CN' ? zhCN : undefined)}
      theme={() => THEMES[themeName()]}
    >
      <main sx={styles.page}>
        <h1 sx={styles.title}>hiltkit</h1>
        <div sx={styles.row}>
          <label sx={styles.label}>
            主题
            <select id="theme" sx={styles.select} onChange={(event) => themeName.set(value(event))}>
              {Object.keys(THEMES).map((item) => (
                <option value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label sx={styles.label}>
            语言
            <select id="locale" sx={styles.select} onChange={(event) => locale.set(value(event))}>
              {LOCALES.map((item) => (
                <option value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label sx={styles.label}>
            时区
            <select id="zone" sx={styles.select} onChange={(event) => timeZone.set(value(event))}>
              {ZONES.map((item) => (
                <option value={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <Readout />
        <div sx={styles.row}>
          <Button id="open-dialog" variant="primary" onClick={() => dialog?.showModal()}>
            打开弹框
          </Button>
          <Button id="open-drawer" onClick={() => drawer?.showModal()}>
            打开抽屉
          </Button>
          <Button variant="ghost">幽灵</Button>
          <Button disabled>禁用</Button>
          <Button variant="danger">删除</Button>
        </div>
        <dialog
          ref={(el: HTMLDialogElement | null) => (dialog = el)}
          sx={[styles.dialog, transitions.fade, transitions.backdrop]}
        >
          <p>按住按钮看波纹，松开才淡出。</p>
          <Button onClick={() => dialog?.close()}>关闭</Button>
        </dialog>
        <dialog
          ref={(el: HTMLDialogElement | null) => (drawer = el)}
          sx={[styles.drawer, transitions.slide, transitions.backdrop]}
        >
          <p>抽屉从行尾滑入。</p>
          <Button onClick={() => drawer?.close()}>关闭</Button>
        </dialog>
      </main>
    </Provider>
  );
}

mount(() => <App />, document.getElementById('app')!);
