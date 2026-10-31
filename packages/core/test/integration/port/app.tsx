import { provide, sig, type Child, type Prop, type Sig } from 'hiltkit';
import {
  Button,
  ButtonGroupContext,
  Field,
  ported,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  type ButtonSize,
  type ButtonTone,
  type ButtonVariant,
  type IconProps,
} from './ui';

interface Log {
  userClicks: number;
  panelBuilt: number;
  helperRuns: number;
  helperKept: number;
}
/** 测试从页面里驱动 App 的入口：set 按名字写一个状态，read 读回需要断言的两个 */
interface Controls {
  variant: ButtonVariant;
  tone: ButtonTone;
  size: ButtonSize | undefined;
  loading: boolean;
  disabled: boolean;
  soft: boolean;
  fullWidth: boolean;
  propsIcon: Omit<IconProps, 'icon'> | undefined;
  on: boolean;
  readonly: boolean;
  switchLoading: boolean;
  invalid: boolean;
  tab: string | undefined;
  groupTone: ButtonTone;
  helperLabel: string;
  hint: string | undefined;
  wide: string | undefined;
}
declare global {
  interface Window {
    log: Log;
    ported: typeof ported;
    api: {
      set<K extends keyof Controls>(name: K, value: Controls[K]): void;
      read(): { on: boolean; tab: string | undefined };
    };
  }
}

const log: Log = { userClicks: 0, panelBuilt: 0, helperRuns: 0, helperKept: 0 };

function Heavy() {
  log.panelBuilt++;
  return <em id="heavy">重内容</em>;
}

function Group({
  variant,
  tone,
  children,
}: {
  variant?: Prop<ButtonVariant>;
  tone?: Prop<ButtonTone>;
  children?: Child;
}) {
  provide(ButtonGroupContext, { variant, tone });
  return <div class="group">{children}</div>;
}

// 返回 JSX 的辅助函数：顶层读状态 vs 内容里读状态
function topLevelRead(options: { label: Prop<string> }) {
  log.helperRuns++;
  const label = typeof options.label === 'function' ? options.label() : options.label; // 顶层读：只取这一次，要靠调用方包一层函数才会重建
  return <span id="helper-top">{label}</span>;
}
function lazyRead(options: { label: Prop<string> }) {
  log.helperKept++;
  return <span id="helper-lazy">{options.label}</span>; // 内容里读：只更新文本
}

export function App() {
  const controls: { [K in keyof Controls]: Sig<Controls[K]> } = {
    variant: sig<ButtonVariant>('solid'),
    tone: sig<ButtonTone>('accent'),
    size: sig<ButtonSize | undefined>(undefined),
    loading: sig(false),
    disabled: sig(false),
    soft: sig(false),
    fullWidth: sig(false),
    propsIcon: sig<Omit<IconProps, 'icon'> | undefined>(undefined),
    on: sig(false),
    readonly: sig(false),
    switchLoading: sig(false),
    invalid: sig(false),
    tab: sig<string | undefined>(undefined),
    groupTone: sig<ButtonTone>('danger'),
    helperLabel: sig('一'),
    hint: sig<string | undefined>(undefined),
    wide: sig<string | undefined>(undefined),
  };
  const {
    variant,
    tone,
    size,
    loading,
    disabled,
    soft,
    fullWidth,
    propsIcon,
    on,
    readonly,
    switchLoading,
    invalid,
    tab,
    groupTone,
    helperLabel,
    wide,
  } = controls;

  if (typeof window !== 'undefined') {
    window.api = {
      set: (name, value) => controls[name].set(value),
      read: () => ({ on: on.peek(), tab: tab.peek() }),
    };
  }

  return (
    <main>
      <Button
        id="btn"
        class="user-class"
        data-user="1"
        variant={variant}
        tone={tone}
        size={size}
        loading={loading}
        disabled={disabled}
        focusableWhenDisabled={soft}
        fullWidth={fullWidth}
        icon="plus"
        iconEnd="arrow"
        propsIcon={propsIcon}
        propsContent={{ class: 'content-class' }}
        onClick={() => log.userClicks++}
      >
        保存
      </Button>
      <Group variant="outline" tone={groupTone}>
        <Button id="grouped">组里</Button>
        <Button id="grouped-own" tone="accent">
          自己的色调
        </Button>
      </Group>

      <Field id="f1" description="说明文字" invalid={invalid}>
        <Switch
          checked={on}
          readonly={readonly}
          loading={switchLoading}
          checkedContent={wide}
          uncheckedContent={wide}
          propsRoot={{ 'data-root': 'yes' }}
          data-input="yes"
        >
          通知
        </Switch>
      </Field>
      <p id="on-state">{() => (on() ? '开' : '关')}</p>

      <Tabs id="tabs" value={tab} lazy>
        <TabList aria-label="订单">
          <Tab id="tab-a" value="a">
            全部
          </Tab>
          <Tab id="tab-b" value="b">
            已付款
          </Tab>
          <Tab id="tab-c" value="c" onClick={(event) => event.preventDefault()}>
            拦截
          </Tab>
        </TabList>
        <TabPanel value="a">
          <p id="panel-a">面板 A</p>
        </TabPanel>
        <TabPanel value="b">
          <Heavy />
        </TabPanel>
        <TabPanel value="c">
          <p id="panel-c">面板 C</p>
        </TabPanel>
      </Tabs>

      <div id="helpers">
        {/* 顶层读状态的辅助函数：直接调用只取一次，要包一层函数 */}
        {() => topLevelRead({ label: helperLabel })}
        {lazyRead({ label: helperLabel })}
      </div>
    </main>
  );
}

if (typeof window !== 'undefined') {
  window.log = log;
  window.ported = ported;
}
