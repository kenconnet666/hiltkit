/**
 * 各组件共用的文案：确定、取消、关闭这些。
 * 组件自己特有的文案放在组件目录里，用 defineMessages 声明，并在下面的登记处加一行。
 */
import { defineMessages } from '../provider/messages';

export const commonMessages = defineMessages('common', {
  confirm: 'OK',
  cancel: 'Cancel',
  close: 'Close',
  loading: 'Loading',
});

// 登记：语言包按这张表检查，少翻一条、写错名字都报错
declare module '../provider/messages' {
  interface MessageCatalog {
    common: typeof commonMessages.defaults;
  }
}
