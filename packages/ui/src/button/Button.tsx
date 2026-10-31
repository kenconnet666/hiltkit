// 骨架占位：验证组件库能依赖框架、被文档站使用。组件的 API 和外观之后单独设计。

import type { Child } from 'hiltkit';

export interface ButtonProps {
  children?: Child;
}

export function Button({ children }: ButtonProps) {
  return <button type="button">{children}</button>;
}
