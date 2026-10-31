// 同一份组件：服务端渲染成字符串，客户端接管。样式相关的写法：静态 sx、动态参数、条件项、配方、使用方 class / style、
// 字面量 sx、关键帧、主题（主题类放 <html>，由防闪烁脚本选）。
import { createContext, inject, provide } from '@hilt/runtime';
import { create, createTheme, defineTokens, keyframes, recipe } from '@hilt/css';

export const t = defineTokens('s', {
  colors: { text: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)', accent: 'rgb(0, 0, 255)' },
  space: { md: '8px' },
});
export const themes = {
  light: createTheme(t, { colors: { text: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)' } }),
  dark: createTheme(t, { colors: { text: 'rgb(250, 250, 250)', bg: 'rgb(10, 10, 10)' } }),
};

const spin = keyframes({ from: { opacity: 0.2 }, to: { opacity: 1 } });

const styles = create({
  page: { color: '_text', backgroundColor: '_bg', padding: '_md' },
  base: { padding: 4, color: { default: 'rgb(255, 0, 0)', ':hover': 'rgb(0, 0, 255)' } },
  hot: { color: 'rgb(255, 165, 0)', fontWeight: 700 },
  width: (width: string) => ({ width, height: 10 }),
  spinner: { animationName: spin, animationDuration: '1s' },
});

const chip = recipe({
  name: 'Chip',
  parts: ['root', 'dot'],
  base: { root: { display: 'inline-flex', gap: 4 }, dot: { width: 6, height: 6, borderRadius: 3 } },
  variants: { size: { sm: { root: { fontSize: 11 } }, lg: { root: { fontSize: 15 }, dot: { width: 10 } } } },
  defaults: { size: 'sm' },
});

const Chip = _component(({ size, children, ...rest }) => {
  const s = chip({ size });
  return (
    <span {...s.root} {...rest}>
      <i {...s.dot} />
      {children}
    </span>
  );
});

const Box = _component(({ width, hot, children, ...rest }) => (
  <div class="box" sx={[styles.base, hot && styles.hot, styles.width(width)]} {...rest}>
    {children}
  </div>
));

const Tone = createContext('x');
const Provider = _component(({ value, children }) => {
  provide(Tone, value);
  return <div class="provider">{children}</div>;
});
const Consumer = _component(({ id }) => <em id={id}>{inject(Tone)}</em>);

export const App = _component(({ initial, literalWidth }) => {
  let width = _state(initial.width);
  let hot = _state(false);
  let size = _state('sm');
  let userClass = _state('user');
  let extra = _state(false);
  (globalThis as any).window && Object.assign((globalThis as any).window, {
    api: {
      setWidth: (v: string) => (width = v),
      setHot: (v: boolean) => (hot = v),
      setSize: (v: string) => (size = v),
      setClass: (v: string) => (userClass = v),
      setExtra: (v: boolean) => (extra = v),
    },
  });
  return (
    <div id="page" sx={styles.page}>
      <Box id="box" width={width} hot={hot} class={userClass} style="outline-offset: 2px">
        盒子
      </Box>
      <Chip id="chip" size={size}>
        配方
      </Chip>
      <p id="literal" sx={{ marginTop: literalWidth ?? 3 }}>字面量</p>
      <i id="spin" sx={styles.spinner} />
      <Provider value="dark">
        <Consumer id="ctx" />
      </Provider>
      {extra ? <b id="extra" sx={{ letterSpacing: 3, fontStyle: 'italic' }}>水合之后才出现</b> : null}
    </div>
  );
});

export const initial = { width: '40px' };
