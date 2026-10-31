import { Button, ButtonGroupContext, Field, ported, Switch, Tab, TabList, TabPanel, Tabs } from './ui';
import { provide } from '@hilt/runtime';

const log: Record<string, any> = { userClicks: 0, panelBuilt: 0, helperRuns: 0, helperKept: 0 };
if (typeof window !== 'undefined') {
  (window as any).log = log;
  (window as any).ported = ported;
}

const Heavy = _component(() => {
  log.panelBuilt++;
  return <em id="heavy">重内容</em>;
});

const Group = _component(({ variant, tone, children }: any) => {
  provide(ButtonGroupContext, { variant, tone });
  return <div class="group">{children}</div>;
});

// 返回 JSX 的辅助函数：顶层读状态 vs 内容里读状态
function topLevelRead(options: any) {
  log.helperRuns++;
  const label = options.label; // 顶层读：外层 insert 把它当依赖，变了整段重建
  return <span id="helper-top">{label}</span>;
}
function lazyRead(options: any) {
  log.helperKept++;
  return <span id="helper-lazy">{options.label}</span>; // 内容里读：只更新文本
}

export const App = _component(() => {
  let variant = _state('solid');
  let tone = _state('accent');
  let size = _state<string | undefined>(undefined);
  let loading = _state(false);
  let disabled = _state(false);
  let soft = _state(false);
  let fullWidth = _state(false);
  let propsIcon = _state<any>(undefined);
  let on = _state(false);
  let readonly = _state(false);
  let switchLoading = _state(false);
  let invalid = _state(false);
  let tab = _state<string | undefined>(undefined);
  let groupTone = _state('danger');
  let helperLabel = _state('一');
  let hint = _state<string | undefined>(undefined);
  let wide = _state<string | undefined>(undefined);

  if (typeof window !== 'undefined') {
    (window as any).api = {
      set: (name: string, next: any) => {
        if (name === 'variant') variant = next;
        if (name === 'tone') tone = next;
        if (name === 'size') size = next;
        if (name === 'loading') loading = next;
        if (name === 'disabled') disabled = next;
        if (name === 'soft') soft = next;
        if (name === 'fullWidth') fullWidth = next;
        if (name === 'propsIcon') propsIcon = next;
        if (name === 'on') on = next;
        if (name === 'readonly') readonly = next;
        if (name === 'switchLoading') switchLoading = next;
        if (name === 'invalid') invalid = next;
        if (name === 'tab') tab = next;
        if (name === 'groupTone') groupTone = next;
        if (name === 'helperLabel') helperLabel = next;
        if (name === 'hint') hint = next;
        if (name === 'wide') wide = next;
      },
      read: () => ({ on, tab }),
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
        <Switch _unused={0} checked={_bind(on)} readonly={readonly} loading={switchLoading} checkedContent={wide} uncheckedContent={wide} propsRoot={{ 'data-root': 'yes' }} data-input="yes">
          通知
        </Switch>
      </Field>
      <p id="on-state">{on ? '开' : '关'}</p>

      <Tabs id="tabs" value={_bind(tab)} lazy>
        <TabList aria-label="订单">
          <Tab id="tab-a" value="a">全部</Tab>
          <Tab id="tab-b" value="b">已付款</Tab>
          <Tab id="tab-c" value="c" onClick={(event: Event) => event.preventDefault()}>拦截</Tab>
        </TabList>
        <TabPanel value="a"><p id="panel-a">面板 A</p></TabPanel>
        <TabPanel value="b"><Heavy /></TabPanel>
        <TabPanel value="c"><p id="panel-c">面板 C</p></TabPanel>
      </Tabs>

      <div id="helpers">
        {topLevelRead({ label: helperLabel })}
        {lazyRead({ label: helperLabel })}
      </div>
    </main>
  );
});
