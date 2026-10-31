// 主题：全局切换不重新渲染、嵌套与局部主题、运行时自定义主题、token 短写
import { effect, flushSync, mount } from '@hilt/runtime';
import { create, createTheme, defineTokens, themeStyle } from '@hilt/css';

const t = defineTokens('th', {
  colors: { text: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)', accent: 'rgb(0, 0, 255)' },
  space: { md: '8px', lg: '16px' },
});

const dark = createTheme(t, { colors: { text: 'rgb(255, 255, 255)', bg: 'rgb(0, 0, 0)' }, space: { md: '10px' } });
const light = createTheme(t, { colors: { text: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)' } });
const brand = createTheme(t.colors, { accent: 'rgb(255, 0, 128)' });

const styles = create({
  row: { color: '_text', backgroundColor: '_bg', paddingLeft: '_md' },
  accent: { color: '_accent' },
  bad: { color: '_nope' },
});

let renders = 0;
let rowEffects = 0;
const Row = _component(({ n }) => {
  renders++;
  rowEffects++;
  return <li sx={styles.row}>行 {n}</li>;
});

let isDark = _state(false);
let userColor = _state('rgb(1, 2, 3)');
let customCount = _state(0);

const App = _component(() => (
  <main id="app" sx={[isDark ? dark : light]}>
    <ul id="rows">{Array.from({ length: 200 }, (_, n) => n).map((n) => <Row n={n} />)}</ul>
    <section id="inner" sx={[dark]}>
      <span id="innerText" sx={styles.row}>内部深色</span>
      <div id="innerInner" sx={[light]}>
        <span id="innerInnerText" sx={styles.row}>再嵌套浅色</span>
      </div>
    </section>
    <button id="local" sx={[styles.accent, brand]}>局部品牌色（theme 与样式在同一个 sx）</button>
    <span id="local2" sx={styles.accent}>不在品牌色里</span>
    <p id="runtime" sx={[styles.accent, themeStyle(t.colors, { accent: userColor })]}>运行时取色</p>
    <p id="stacked" sx={[styles.row, light, dark]}>两个主题叠在一起，后者赢</p>
  </main>
));

const cssRules = () => [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0);

(window as any).api = {
  setDark: (v: boolean) => (isDark = v),
  setUserColor: (v: string) => (userColor = v),
  /** 每次生成一个新的主题类（对照：运行时随便给颜色走 createTheme 会长规则表） */
  makeThemes(n: number) {
    const before = cssRules();
    for (let i = 0; i < n; i++) {
      const theme = createTheme(t.colors, { accent: `rgb(${i % 256}, ${(i * 7) % 256}, ${(i * 13) % 256})` });
      const el = document.createElement('div');
      mount(() => <div sx={[theme]} />, el);
    }
    return cssRules() - before;
  },
  rules: cssRules,
  renders: () => renders,
  badToken() {
    try {
      mount(() => <div sx={styles.bad} />, document.createElement('div'));
      return null;
    } catch (error) {
      return String((error as Error).message);
    }
  },
  flushSync,
};

mount(() => <App />, document.body);
void effect;
