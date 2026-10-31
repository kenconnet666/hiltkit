/**
 * 组件库的公开入口。每个组件一个目录：实现、文案、类型放在一起，从这里统一导出。
 * 语言包是单独的子路径（`@hiltkit/ui/locale/zh-CN`），不用的语言不进包。
 */
export * from './provider';
export { commonMessages } from './locale/common';
export { Button, type ButtonProps } from './button';
