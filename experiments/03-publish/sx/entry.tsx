// 三项需求串起来：符文 + 属性合并 + 运行时样式。Box 相当于组件库里的组件，App 相当于使用方。
import { flushSync, mount } from '@hilt/runtime';
import * as css from '@hilt/css';


const styles = css.create({
  base: { padding: '4px', margin: '2px', color: { default: 'rgb(255, 0, 0)', ':hover': 'rgb(0, 0, 255)' } },
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

let width = _state('10px');
let hot = _state(false);
let userClass = _state('u');

(window as any).api = {
  setWidth: (next: string) => (width = next),
  setHot: (next: boolean) => (hot = next),
  setClass: (next: string) => (userClass = next),
  flushSync,
  sheetRules: () => [...document.styleSheets].reduce((total, sheet) => total + sheet.cssRules.length, 0),
};

const App = _component(() => (
  <main>
    <Box id="plain" width={width}>
      默认
    </Box>
    <Box id="over" width="20px" class={userClass} sx={{ padding: '9px' }}>
      覆盖 padding
    </Box>
    <Box id="cond" width="20px" sx={hot ? { color: 'rgb(255, 165, 0)' } : null}>
      条件覆盖
    </Box>
  </main>
));

mount(() => <App />, document.body);
