/**
 * 三套内置主题的取值：亮色（默认）、暗色、深蓝。
 *
 * 只放数据，不依赖样式引擎：`contrast.test.ts` 在这里逐项算对比度，改色值时测试会把关。
 * 风格：交互状态和浮层层级借鉴 MUI，略带暖意的中性色和细线分层借鉴 Claude Desktop，其余按“专业、克制”取舍：
 * 主色和危险色比 MUI 深、饱和度低；暗色的实底按钮用中等明度配白字，不用 MUI 那种大块的浅色。
 * 边框和悬停是半透明的，同一个 ink 在不同底色上都合适。
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
  /** 按钮的描边：按钮靠文字识别，边框可以淡一些 */
  borderSubtle: string;
  /** 输入框等控件的边框：要看得清边界，对比度不低于 3 */
  border: string;
  /** 控件悬停时的边框 */
  borderStrong: string;
  /** 幽灵按钮、列表行悬停时叠的淡色 */
  fillHover: string;
  /** 选中行、按下时叠的淡色 */
  fillSelected: string;
  /** 禁用的实底按钮的底色、禁用的描边 */
  fillDisabled: string;
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
  /** 状态：错误，用在文字和图标上 */
  bad: string;
  /** 危险按钮的底色 */
  badFill: string;
  /** 危险按钮悬停 */
  badFillHover: string;
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
  /** 菜单、下拉（MUI 的 elevation 8） */
  popup: string;
  /** 弹框、抽屉（MUI 的 elevation 24） */
  modal: string;
}

export interface Palette {
  readonly colorScheme: 'light' | 'dark';
  readonly colors: ThemeColors;
  readonly shadows: ThemeShadows;
}

/** 同一种墨色的各档透明度 */
const ink = (
  rgb: string,
  alpha: {
    borderWeak: number;
    borderSubtle: number;
    border: number;
    borderStrong: number;
    fillHover: number;
    fillSelected: number;
    fillDisabled: number;
  },
) =>
  Object.fromEntries(
    Object.entries(alpha).map(([name, value]) => [name, `rgba(${rgb}, ${value})`]),
  ) as Record<keyof typeof alpha, string>;

/**
 * 投影的几何沿用 MUI 的三层（本影、半影、环境光）。strength 是透明度的倍数：
 * 亮底上原值太脏，减轻；暗底上投影本来就不明显，保持原值。
 */
const elevation = (rgb: string, strength = 1) => {
  const shade = (alpha: number) => `rgba(${rgb}, ${Math.round(alpha * strength * 100) / 100})`;
  const layers = (umbra: string, penumbra: string, ambient: string) =>
    `${umbra} ${shade(0.2)}, ${penumbra} ${shade(0.14)}, ${ambient} ${shade(0.12)}`;
  return {
    popup: layers('0 5px 5px -3px', '0 8px 10px 1px', '0 3px 14px 2px'),
    modal: layers('0 11px 15px -7px', '0 24px 38px 3px', '0 9px 46px 8px'),
  };
};

export const lightPalette: Palette = {
  colorScheme: 'light',
  colors: {
    canvas: '#F7F6F3',
    surface: '#FFFFFF',
    elevated: '#FFFFFF',
    text: '#1F1E1C',
    textSecondary: '#63615C',
    textDisabled: '#9C9A94',
    // 输入框边框比 MUI 的 0.23 深：要满足 3:1
    ...ink('31, 30, 28', {
      borderWeak: 0.12,
      borderSubtle: 0.24,
      border: 0.48,
      borderStrong: 0.87,
      fillHover: 0.04,
      fillSelected: 0.08,
      fillDisabled: 0.12,
    }),
    accent: '#1A5CAD',
    accentHover: '#144A8E',
    onAccent: '#FFFFFF',
    accentText: '#1A5CAD',
    focus: '#1A5CAD',
    ok: '#2E7D32',
    warn: '#A35A00',
    bad: '#B3261E',
    badFill: '#B3261E',
    badFillHover: '#8C1D18',
    onBad: '#FFFFFF',
    overlay: 'rgba(31, 30, 28, 0.24)',
    chart1: '#1A5CAD',
    chart2: '#00838F',
    chart3: '#C26A1B',
    chart4: '#7A4FB5',
    chart5: '#2E7D32',
  },
  shadows: elevation('31, 30, 28', 0.6),
};

export const darkPalette: Palette = {
  colorScheme: 'dark',
  colors: {
    canvas: '#1C1B1A',
    surface: '#242321',
    elevated: '#2C2B29',
    text: '#ECEAE5',
    textSecondary: '#B0ADA6',
    textDisabled: '#807D77',
    ...ink('236, 234, 229', {
      borderWeak: 0.12,
      borderSubtle: 0.26,
      border: 0.46,
      borderStrong: 0.87,
      fillHover: 0.08,
      fillSelected: 0.16,
      fillDisabled: 0.12,
    }),
    accent: '#2F72C9',
    // 白字要够对比度，悬停只能往深走
    accentHover: '#2A69BC',
    onAccent: '#FFFFFF',
    accentText: '#8DBBF0',
    focus: '#8DBBF0',
    ok: '#66BB6A',
    warn: '#FFA726',
    bad: '#E57373',
    badFill: '#BF3F3A',
    badFillHover: '#A93531',
    onBad: '#FFFFFF',
    overlay: 'rgba(0, 0, 0, 0.56)',
    chart1: '#64B5F6',
    chart2: '#5CC3DC',
    chart3: '#E8A552',
    chart4: '#B79AF0',
    chart5: '#81C784',
  },
  shadows: elevation('0, 0, 0'),
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
    ...ink('122, 170, 230', {
      borderWeak: 0.24,
      borderSubtle: 0.4,
      border: 0.56,
      borderStrong: 0.87,
      fillHover: 0.1,
      fillSelected: 0.18,
      fillDisabled: 0.14,
    }),
    accent: '#3E9BFF',
    accentHover: '#65B0FF',
    onAccent: '#04162C',
    accentText: '#6DB3FF',
    focus: '#6DB3FF',
    ok: '#4CC9A0',
    warn: '#F0B44C',
    bad: '#F47C7C',
    badFill: '#C8443F',
    badFillHover: '#B53A36',
    onBad: '#FFFFFF',
    overlay: 'rgba(3, 8, 18, 0.55)',
    chart1: '#4A93EE',
    chart2: '#6FD3E8',
    chart3: '#F0B44C',
    chart4: '#A9A0F5',
    chart5: '#4CC9A0',
  },
  shadows: elevation('2, 8, 20'),
};
