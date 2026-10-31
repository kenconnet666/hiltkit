/**
 * 简体中文语言包：`<Provider locale="zh-CN" messages={zhCN}>`。
 * 英文是组件自带的，不需要语言包。Required 让新增文案时这里漏翻会报错。
 */
import type {} from './common';
import type { MessageCatalog } from '../provider/messages';

export const zhCN = {
  common: {
    confirm: '确定',
    cancel: '取消',
    close: '关闭',
    loading: '加载中',
  },
} satisfies Required<MessageCatalog>;

export default zhCN;
