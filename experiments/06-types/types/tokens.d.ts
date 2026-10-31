/**
 * 主题 token 的登记处：样式里的 '_md' 按属性所在的组补全与校验。
 * 每个 token 是一个接口成员（值类型不参与），应用用模块扩展追加：
 *   declare module 'exp06/tokens' { interface SpaceTokens { _xl: unknown } }
 * 同名成员可以重复声明，所以多处扩展不冲突（组写成联合类型就做不到）。
 */
export interface SpaceTokens {
  /** 0 */ _none: unknown;
  /** 4px */ _xs: unknown;
  /** 8px */ _sm: unknown;
  /** 16px */ _md: unknown;
  /** 24px */ _lg: unknown;
}
export interface ColorTokens {
  /** 正文色 */ _text: unknown;
  /** 不可用的文字色 */ _textDisabled: unknown;
  /** 主题强调色 */ _accent: unknown;
  /** 背景色 */ _bg: unknown;
  /** 边框色 */ _border: unknown;
}
export interface FontSizeTokens {
  _sm: unknown;
  _md: unknown;
  _lg: unknown;
}
export interface RadiusTokens {
  _sm: unknown;
  _md: unknown;
  _full: unknown;
}

/** 组名 → 该组的 token 联合 */
export interface TokenGroups {
  space: keyof SpaceTokens;
  colors: keyof ColorTokens;
  fontSizes: keyof FontSizeTokens;
  radii: keyof RadiusTokens;
}
