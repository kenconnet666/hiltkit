/**
 * 三套内置主题的取值：亮色（默认）、暗色、深蓝。
 *
 * 只放数据，不依赖样式引擎：`contrast.test.ts` 在这里逐项算对比度，改色值时测试会把关。
 * 风格：克制。颜色只留给要紧的操作；层次靠极细的线和留白，投影只给浮层。
 * 边框和悬停是半透明的，同一个 ink 在不同底色上都合适（Grafana 也这么做）。
 */

/** 所有主题都有的颜色 token。名字不变，只换值：组件不需要知道当前是哪个主题 */
export interface ThemeColors {
  /** 页面底 */
  canvas: string;
  /** 面板 */
  surface: string;
  /** 弹框、抽屉、菜单 */
  elevated: string;
  /** 正文 */
  text: string;
  /** 次要文字、说明 */
  textSecondary: string;
  /** 禁用文字 */
  textDisabled: string;
  /** 分隔线 */
  borderWeak: string;
  /** 输入框等控件的边框：要看得清边界，对比度不低于 3 */
  border: string;
  /** 控件悬停时的边框 */
  borderStrong: string;
  /** 幽灵按钮、列表行悬停时叠的淡色 */
  fillHover: string;
  /** 选中行、按下时叠的淡色 */
  fillSelected: string;
  /** 品牌色：主按钮、当前项。一屏尽量只有一处大面积使用 */
  accent: string;
  /** 主按钮悬停 */
  accentHover: string;
  /** 主按钮上的文字 */
  onAccent: string;
  /** 链接、强调文字 */
  accentText: string;
  /** 焦点框 */
  focus: string;
  /** 状态：正常 */
  ok: string;
  /** 状态：警告 */
  warn: string;
  /** 状态：错误、危险操作 */
  bad: string;
  /** 危险按钮上的文字 */
  onBad: string;
  /** 模态遮罩 */
  overlay: string;
  /** 图表的五个系列：和界面配色分开，每个主题单独配，保证对比度一致 */
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

export interface ThemeShadows {
  /** 浮层投影 */
  popup: string;
}

export interface Palette {
  readonly colorScheme: 'light' | 'dark';
  readonly colors: ThemeColors;
  readonly shadows: ThemeShadows;
}

const ink = (
  rgb: string,
  weak: number,
  medium: number,
  strong: number,
  hover: number,
  selected: number,
) => ({
  borderWeak: `rgba(${rgb}, ${weak})`,
  border: `rgba(${rgb}, ${medium})`,
  borderStrong: `rgba(${rgb}, ${strong})`,
  fillHover: `rgba(${rgb}, ${hover})`,
  fillSelected: `rgba(${rgb}, ${selected})`,
});

export const lightPalette: Palette = {
  colorScheme: 'light',
  colors: {
    canvas: '#F4F5F6',
    surface: '#FFFFFF',
    elevated: '#FFFFFF',
    text: '#17181C',
    textSecondary: '#5C5F68',
    textDisabled: '#8B8E96',
    ...ink('23, 24, 28', 0.12, 0.46, 0.62, 0.04, 0.08),
    accent: '#2F3AA8',
    accentHover: '#262F8C',
    onAccent: '#FFFFFF',
    accentText: '#2F3AA8',
    focus: '#2F3AA8',
    ok: '#0A7350',
    warn: '#A35A00',
    bad: '#C4203A',
    onBad: '#FFFFFF',
    overlay: 'rgba(23, 24, 28, 0.28)',
    chart1: '#2F3AA8',
    chart2: '#1E7F9E',
    chart3: '#C26A1B',
    chart4: '#7A4FB5',
    chart5: '#2B8A5B',
  },
  shadows: { popup: '0 6px 20px rgba(23, 24, 28, 0.08)' },
};

export const darkPalette: Palette = {
  colorScheme: 'dark',
  colors: {
    canvas: '#111215',
    surface: '#18191D',
    elevated: '#212226',
    text: '#E6E7EA',
    textSecondary: '#A0A2AA',
    textDisabled: '#74767E',
    ...ink('230, 231, 234', 0.12, 0.42, 0.56, 0.06, 0.11),
    accent: '#9AA3F2',
    accentHover: '#B2B9F6',
    onAccent: '#14163A',
    accentText: '#9AA3F2',
    focus: '#9AA3F2',
    ok: '#5CC79A',
    warn: '#E8AE4A',
    bad: '#F0808A',
    onBad: '#2A0A0E',
    overlay: 'rgba(0, 0, 0, 0.5)',
    chart1: '#8E9AF0',
    chart2: '#5CC3DC',
    chart3: '#E8A552',
    chart4: '#B79AF0',
    chart5: '#6BCF9C',
  },
  shadows: { popup: '0 6px 20px rgba(0, 0, 0, 0.4)' },
};

export const navyPalette: Palette = {
  colorScheme: 'dark',
  colors: {
    canvas: '#071A33',
    surface: '#0C2444',
    elevated: '#123057',
    text: '#E8F1FC',
    textSecondary: '#8FA9C9',
    textDisabled: '#6C86A6',
    // 线也带蓝：用白色半透明的话，深蓝底上会发灰
    ...ink('122, 170, 230', 0.24, 0.56, 0.72, 0.1, 0.18),
    accent: '#3E9BFF',
    accentHover: '#65B0FF',
    onAccent: '#04162C',
    accentText: '#6DB3FF',
    focus: '#6DB3FF',
    ok: '#4CC9A0',
    warn: '#F0B44C',
    bad: '#F47C7C',
    onBad: '#2A0A0E',
    overlay: 'rgba(3, 8, 18, 0.55)',
    chart1: '#4A93EE',
    chart2: '#6FD3E8',
    chart3: '#F0B44C',
    chart4: '#A9A0F5',
    chart5: '#4CC9A0',
  },
  shadows: { popup: '0 6px 20px rgba(2, 8, 20, 0.48)' },
};
