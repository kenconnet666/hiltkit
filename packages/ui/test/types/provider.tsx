// Provider 的类型用例：正例要通过，@ts-expect-error 必须真的报错。纳入 pnpm typecheck
import { sig } from 'hiltkit';
import {
  Provider,
  defineMessages,
  useFormat,
  useLocale,
  useMessages,
  type MessagePack,
} from '@hiltkit/ui';
import zhCN from '@hiltkit/ui/locale/zh-CN';

const locale = sig('zh-CN');
const maybe = sig<string | undefined>(undefined);

export const good = (
  <>
    <Provider />
    <Provider locale="zh-CN" timeZone="Asia/Shanghai" messages={zhCN} />
    <Provider
      locale={locale}
      timeZone={maybe}
      messages={() => (locale() === 'zh-CN' ? zhCN : undefined)}
    />
    <Provider dir="rtl" hourCycle="h23" weekStart={1} calendar="buddhist" currency="CNY">
      <p>内容</p>
    </Provider>
  </>
);

export const bad = (
  <>
    {/* @ts-expect-error 语言不是数字 */}
    <Provider locale={1} />
    {/* @ts-expect-error 方向只有 ltr、rtl */}
    <Provider dir="up" />
    {/* @ts-expect-error 小时制只有 h12、h23 */}
    <Provider hourCycle="h24" />
    {/* @ts-expect-error 周起始是 1 到 7 */}
    <Provider weekStart={0} />
    {/* @ts-expect-error 没有这个属性 */}
    <Provider language="zh-CN" />
  </>
);

// 语言包：可以只翻一部分，名字写错要报错
export const partial: MessagePack = { common: { close: '关' } };
// @ts-expect-error 没有这个命名空间
export const wrongNamespace: MessagePack = { nope: { close: '关' } };
// @ts-expect-error common 里没有这条
export const wrongKey: MessagePack = { common: { closed: '关' } };
// @ts-expect-error 文案是字符串
export const wrongValue: MessagePack = { common: { close: 1 } };

// 文案的类型来自默认值：函数的参数也保留
const messages = defineMessages('types', {
  title: 'Edit',
  remove: (name: string) => `Remove ${name}`,
});
export function Component() {
  const t = useMessages(messages);
  const title: string = t().title;
  const text: string = t().remove('x');
  // @ts-expect-error 参数是字符串
  t().remove(1);
  // @ts-expect-error 没有这条文案
  void t().missing;
  const format = useFormat();
  const { locale: current, dir } = useLocale();
  const direction: 'ltr' | 'rtl' = dir();
  // @ts-expect-error 布尔值不是日期
  format.date(true);
  // @ts-expect-error 数字格式的选项不收任意键
  format.number(1, { nope: true });
  return (
    <p lang={current} dir={dir} title={title}>
      {text}
      {direction}
      {() => format.date('2026-10-31')}
    </p>
  );
}
