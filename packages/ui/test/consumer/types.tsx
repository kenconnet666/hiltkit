// 使用方看到的类型：只走构建产物。自带文案的声明合并也要在这里生效
import { sig } from 'hiltkit';
import { create } from 'hiltkit/css';
import { Provider, defineMessages, useFormat, useMessages, type MessagePack } from '@hiltkit/ui';
import zhCN from '@hiltkit/ui/locale/zh-CN';

const orderMessages = defineMessages('orders', {
  title: 'Orders',
  total: (n: number) => `${n} orders`,
});
declare module '@hiltkit/ui' {
  interface MessageCatalog {
    orders: typeof orderMessages.defaults;
  }
}
export const pack: MessagePack = { common: { close: '关' }, orders: { title: '订单' } };
// @ts-expect-error 应用登记的命名空间同样检查文案名
export const wrong: MessagePack = { orders: { titles: '订单' } };

// token 直接写在样式里：只导入组件库就有补全和检查
export const styles = create({
  ok: {
    color: '_textSecondary',
    backgroundColor: '_surface',
    borderBottomColor: '_borderWeak',
    borderRadius: '_sm',
    paddingBlock: '_md',
    fontSize: '_lg',
    transitionDuration: '_fast',
    boxShadow: '_popup',
    '::backdrop': { backgroundColor: '_overlay' },
  },
  // @ts-expect-error 写错 token
  wrong: { color: '_nope' },
  // @ts-expect-error 用错组：颜色 token 写在 padding 上
  wrongGroup: { padding: '_accent' },
});

export function Orders() {
  const t = useMessages(orderMessages);
  const format = useFormat();
  const text: string = t().total(3);
  return (
    <p>
      {text}
      {() => format.currency(1, 'CNY')}
    </p>
  );
}
export const app = (
  <Provider locale={sig('zh-CN')} timeZone="Asia/Shanghai" messages={zhCN}>
    <Orders />
    {/* @ts-expect-error 属性类型来自构建产物，照样检查 */}
    <Provider weekStart={9} />
  </Provider>
);
