/**
 * 组件库的公开入口。每个组件一个目录：实现、文案、类型放在一起，从这里统一导出。
 * 语言包是单独的子路径（`@hiltkit/ui/locale/zh-CN`），不用的语言不进包。
 */
// 短写是字符串，打包器看不出依赖。只导入 Provider 时也要登记 token，这个文件和 tokens 都列在 sideEffects 里
import './theme/tokens';

export * from './provider';
export * from './theme';
export { commonMessages } from './locale/common';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './button';
