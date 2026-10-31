// sx / class / style 合到同一个元素：Inner、Box 相当于组件库里的组件，下面的 App 相当于使用方。
import { flushSync, mount, stats as runtimeStats } from '@hilt/runtime';
import { create, stats as cssStats } from '@hilt/css';

const styles = create({
  base: { padding: 4, margin: 2, color: { default: 'rgb(255, 0, 0)', ':hover': 'rgb(0, 0, 255)' } },
  hot: { color: 'rgb(255, 165, 0)' },
  wide: { margin: 9 },
  width: (width: string) => ({ width }),
});

const Inner = _component(({ children, ...rest }) => (
  <div class="inner" sx={styles.base} {...rest}>
    {children}
  </div>
));
const Box = _component(({ width, children, ...rest }) => (
  <Inner class="box" sx={styles.width(width)} {...rest}>
    {children}
  </Inner>
));

/** 组件自己的 sx 与使用方转来的 sx 写在同一个数组里：转来的是 props.sx（里面带着使用方的动态项） */
const Fwd = _component(({ sx, ...rest }) => <div sx={[styles.base, sx]} {...rest} />);

let hot = _state(false);
let userClass = _state('u');
let width = _state('10px');
let userStyle = _state({ color: 'rgb(1, 2, 3)' });
let styleText = _state('outline-offset: 3px');

const count = (fn: () => void) => {
  const before = runtimeStats.effects;
  const watchers = cssStats.watchers;
  fn();
  return { effects: runtimeStats.effects - before, watchers: cssStats.watchers - watchers };
};

const App = _component(() => (
  <main>
    <Box id="plain" width={width}>
      默认
    </Box>
    <Box id="over" width="20px" class={userClass} sx={[styles.wide, hot && styles.hot]}>
      使用方
    </Box>
    <Box id="styled" width="20px" style={userStyle}>
      style
    </Box>
    <Box id="stringStyle" width="20px" style={styleText}>
      string
    </Box>
    <Fwd id="fwd" sx={[styles.wide, hot && styles.hot]} />
    <div id="static" sx={styles.base} />
    <div id="mixed" sx={[styles.base, hot && styles.hot]} />
    <div id="literal" sx={{ marginTop: 8 }} />
    <div id="plainClass" class={userClass} />
  </main>
));

const effectCounts: Record<string, unknown> = {};
// 单独量几种写法各起几个 effect（挂在 detached 的 host 上，不影响上面的页面）
{
  const host = document.createElement('div');
  effectCounts.static = count(() => mount(() => <div sx={styles.base} />, host));
  effectCounts.staticArray = count(() => mount(() => <div sx={[styles.base, styles.wide, { marginTop: 8 }]} />, host));
  effectCounts.staticCall = count(() => mount(() => <div sx={[styles.base, styles.width('3px')]} />, host));
  effectCounts.mixed = count(() => mount(() => <div sx={[styles.base, hot && styles.hot]} />, host));
  effectCounts.dynamicCall = count(() => mount(() => <div sx={[styles.base, styles.width(width)]} />, host));
  effectCounts.mixedTwo = count(() => mount(() => <div sx={[styles.base, hot && styles.hot, styles.width(width)]} />, host));
  effectCounts.classOnly = count(() => mount(() => <div class={userClass} />, host));
  effectCounts.classAndSx = count(() => mount(() => <div class={userClass} sx={[styles.base, hot && styles.hot]} />, host));
}

(window as any).api = {
  setHot: (v: boolean) => (hot = v),
  setClass: (v: string) => (userClass = v),
  setWidth: (v: string) => (width = v),
  setUserStyle: (v: object) => (userStyle = v),
  setStyleText: (v: string) => (styleText = v),
  flushSync,
  effectCounts,
  stats: () => ({ ...cssStats }),
};

mount(() => <App />, document.body);
