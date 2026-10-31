/** 应用登记自己的 token：模块扩展 + 接口成员合并（同名接口可以多处声明） */
export {};
declare module 'exp06/tokens' {
  interface SpaceTokens {
    /** 32px */
    _xl: unknown;
  }
  interface ColorTokens {
    _danger: unknown;
  }
}
