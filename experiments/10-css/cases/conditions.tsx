// 条件：别名跟着 DOM 属性走、自定义别名、容器查询、when.*、状态组合的规则数
import { flushSync, mount } from '@hilt/runtime';
import { create, defineConditions, defineMarker, when } from '@hilt/css';

defineConditions({ _loading: '[data-loading]', _md: '@media (min-width: 700px)', _wide: '@container (min-width: 400px)' });

const marker = defineMarker('hover-scope');

const styles = create({
  item: {
    color: { default: 'rgb(0, 0, 0)', _selected: 'rgb(255, 0, 0)', _disabled: 'rgb(128, 128, 128)', _hover: 'rgb(0, 0, 255)' },
    opacity: { default: 1, _loading: 0.5 },
    fontSize: { default: 10, _md: 20 },
  },
  open: { backgroundColor: { default: 'rgb(1, 1, 1)', _open: 'rgb(2, 2, 2)' } },
  entering: { opacity: { default: 1, '@starting-style': 0 } },
  box: { containerType: 'inline-size', width: 300 },
  inBox: { color: { default: 'rgb(0, 0, 0)', _wide: 'rgb(0, 128, 0)' } },
  scope: {},
  child: { color: { default: 'rgb(0, 0, 0)', [when.ancestor(':hover', marker)]: 'rgb(200, 0, 0)' } },
  // 对照：状态写成条件样式（cond && styles.x）
  base: { padding: 4, margin: 2, color: 'rgb(0, 0, 0)', fontSize: 12 },
  a: { color: 'rgb(1, 0, 0)' },
  b: { fontWeight: 700 },
  c: { opacity: 0.9 },
  d: { letterSpacing: 1 },
  baseAlias: {
    padding: 4,
    margin: 2,
    color: { default: 'rgb(0, 0, 0)', '[data-a]': 'rgb(1, 0, 0)' },
    fontWeight: { default: 400, '[data-b]': 700 },
    opacity: { default: 1, '[data-c]': 0.9 },
    letterSpacing: { default: 0, '[data-d]': 1 },
    fontSize: 12,
  },
});

const Item = _component(({ selected, disabled, children, ...rest }) => (
  <li aria-selected={selected ? 'true' : 'false'} aria-disabled={disabled ? 'true' : 'false'} sx={styles.item} {...rest}>
    {children}
  </li>
));

let selected = _state(false);
let flags = _state({ a: false, b: false, c: false, d: false });

(window as any).api = {
  badAlias: () => {
    const errors: string[] = [];
    for (const aliases of [{ loading: '[x]' }, { _selected: ':hover' }, { _x: 'color' }]) {
      try {
        defineConditions(aliases);
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    return errors;
  },
  setSelected: (v: boolean) => (selected = v),
  setFlag: (key: string, v: boolean) => ((flags as any)[key] = v),
  flushSync,
};

const App = _component(() => (
  <main>
    <Item id="item" selected={selected}>项</Item>
    <Item id="override" selected={selected} sx={{ color: { _selected: 'rgb(0, 255, 0)' } }}>覆盖选中色</Item>
    <Item id="disabled" disabled>禁用</Item>
    <div id="loading" data-loading sx={styles.item} />
    <div id="open" sx={styles.open} />
    <div id="entering" sx={styles.entering} />
    <div id="box" sx={styles.box}>
      <div id="inBox" sx={styles.inBox} />
    </div>
    <div id="scope" sx={[styles.scope, marker]}>
      <span id="child" sx={styles.child}>子</span>
    </div>
    <div id="classes" sx={[styles.base, flags.a && styles.a, flags.b && styles.b, flags.c && styles.c, flags.d && styles.d]} />
    <div id="alias" data-a={flags.a} data-b={flags.b} data-c={flags.c} data-d={flags.d} sx={styles.baseAlias} />
  </main>
));

mount(() => <App />, document.body);
