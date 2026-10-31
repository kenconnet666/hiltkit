// 配方：Button 相当于组件库里的组件，Ui 是主题层（createUi 的 styles），App 是使用方。
import { flushSync, mount, stats as runtimeStats } from '@hilt/runtime';
import { defineConditions, defineTokens, provideStyles, recipe, stats, useRecipe } from '@hilt/css';

defineConditions({ _md: '@media (min-width: 700px)' });

defineTokens('r', { space: { sm: '4px', md: '8px', lg: '16px' }, colors: { accent: '#0000ff', soft: '#eeeeee' } });

const button = recipe({
  name: 'Button',
  parts: ['root', 'icon', 'label'],
  base: {
    root: { display: 'inline-flex', paddingBlock: '_sm', borderRadius: 4, color: { default: 'rgb(10, 10, 10)', ':hover': 'rgb(0, 0, 255)' } },
    icon: { flexShrink: 0 },
    label: { fontWeight: 500 },
  },
  variants: {
    variant: {
      solid: { root: { backgroundColor: 'rgb(0, 0, 255)' } },
      soft: { root: { backgroundColor: 'rgb(238, 238, 238)' } },
    },
    size: {
      sm: { root: { fontSize: 12 }, icon: { width: 12 } },
      md: { root: { fontSize: 14 }, icon: { width: 16 } },
      lg: { root: { fontSize: 16 }, icon: { width: 20 } },
    },
    block: { true: { root: { width: '100%' } } },
  },
  compound: [{ when: { variant: 'solid', size: 'lg' }, root: { paddingInline: 24 } }],
  defaults: { variant: 'solid', size: 'md' },
});

const Button = _component(({ variant, size, block, children, ...rest }) => {
  const s = useRecipe(button, { variant, size, block });
  return (
    <button {...s.root} {...rest}>
      <i {...s.icon} />
      <span {...s.label}>{children}</span>
    </button>
  );
});

/** 不是活的档位：写死的值，部件在创建时算一次，不起 effect */
const FixedButton = _component(() => {
  const s = button({ variant: 'soft', size: 'sm' });
  return (
    <button {...s.root}>
      <i {...s.icon} />
    </button>
  );
});

/** 响应式档位：size={{ base: 'sm', md: 'lg' }} */
const Responsive = _component(() => {
  const s = button({ size: { base: 'sm', md: 'lg' } });
  return <button id="responsive" {...s.root} />;
});

const themeLayer = {
  Button: {
    base: { root: { borderRadius: 99 } },
    variants: { size: { xl: { root: { fontSize: 30 }, icon: { width: 40 } } } },
  },
};
const Ui = _component(({ children }) => {
  provideStyles(themeLayer);
  // 子节点要放进元素里：provide 的 context 只对这个元素内部之后才创建的内容可见（返回裸 children 会丢掉）
  return <div>{children}</div>;
});

let size = _state('md');
let variant = _state('solid');

(window as any).api = {
  setSize: (v: string) => (size = v),
  setVariant: (v: string) => (variant = v),
  flushSync,
  stats: () => ({ ...stats }),
  /** 写死档位的按钮：挂载它新建了几个 effect（{...s.root} 展开不该起任何 effect） */
  fixedEffects() {
    const before = runtimeStats.effects;
    mount(() => <FixedButton />, document.createElement('div'));
    return runtimeStats.effects - before;
  },
};

const App = _component(() => (
  <main>
    <Button id="default">默认</Button>
    <Button id="live" size={size} variant={variant}>活的</Button>
    <Button id="lg" variant="solid" size="lg">lg</Button>
    <Button id="block" block>块</Button>
    <Button id="user" size="lg" sx={{ fontSize: 5 }}>使用方 sx</Button>
    <FixedButton />
    <Responsive />
    <Ui>
      <Button id="themed" size="xl">主题层</Button>
      <Button id="themedUser" size="xl" sx={{ fontSize: 7 }}>主题层 + 使用方</Button>
    </Ui>
  </main>
));

mount(() => <App />, document.body);
