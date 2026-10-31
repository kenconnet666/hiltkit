// 迁移后的组件库类型正负例：每个 @ts-expect-error 都必须真的报错。
import { derived, merge, sig } from 'hiltkit';
import {
  Button,
  ButtonGroupContext,
  Field,
  Icon,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from './ui';
import { recipe, type SxStyles } from 'hiltkit/css';

const text = sig('');
const flag = sig(false);
const variant = sig<'solid' | 'outline'>('solid');
const tab = sig<string | undefined>(undefined);
const tabText = sig('a');
const readOnlyFlag = derived(() => flag());

// ---- Button：Prop（值或读取函数）、...rest 转发到原生元素 ----
<Button />;
<Button variant="outline" tone={() => 'danger'} size={undefined} loading={flag} icon="plus" />;
<Button
  variant={variant}
  disabled={readOnlyFlag}
  onClick={(event) => event.currentTarget.disabled}
/>;
<Button id="x" class={['a', () => flag() && 'b']} data-user="1" aria-label="保存" title={text} />;
<Button
  propsContent={{ class: 'c' }}
  propsIcon={() => ({ 'data-extra': 'y' })}
  propsSpinner={undefined}
/>;
<Button type="submit" />;
// @ts-expect-error 档位的取值范围
<Button variant="ghost" />;
// @ts-expect-error 读取函数返回的类型也要对
<Button tone={() => 'primary'} />;
// @ts-expect-error 壳的类型不对
<Button loading={text} />;
// @ts-expect-error button 没有 href
<Button href="x" />;
// @ts-expect-error type 的取值
<Button type="link" />;
// @ts-expect-error 事件参数是 MouseEvent 系，没有 key
<Button onClick={(event) => event.key} />;
// @ts-expect-error 部件属性按元素检查：i 没有 href
<Button propsIcon={{ href: 'x' }} />;

// ---- Icon：必填的 icon ----
<Icon icon="plus" class="x" />;
<Icon icon={text} />;
// @ts-expect-error 缺 icon
<Icon />;

// ---- Field + Switch：Model 双向 / 单向 ----
<Field id="f" description="说明" invalid={flag}>
  <Switch checked={flag} />
</Field>;
<Switch />;
<Switch checked={true} />;
<Switch
  checked={() => flag()}
  readonly={flag}
  loading={readOnlyFlag}
  checkedContent="开"
  uncheckedContent={text}
/>;
<Switch
  checked={flag}
  propsRoot={{ 'data-root': 'yes' }}
  propsLabel={() => undefined}
  name="n"
  data-input="yes"
  onChange={(event) => event.currentTarget.checked}
>
  通知
</Switch>;
// @ts-expect-error Field 的 id 必填
<Field />;
// @ts-expect-error 壳的类型不对
<Switch checked={text} />;
// @ts-expect-error input 的 type 由开关自己管
<Switch type="radio" />;
// @ts-expect-error 部件属性按元素检查：span 没有 href
<Switch propsThumb={{ href: 'x' }} />;
// @ts-expect-error 读取函数返回类型不对
<Switch invalid={() => 'yes'} />;

// ---- Tabs：Model<string | undefined>、context 保证的组合 ----
<Tabs value={tab} lazy orientation="vertical">
  <TabList aria-label="订单">
    <Tab value="a" onClick={(event) => event.preventDefault()}>
      全部
    </Tab>
  </TabList>
  <TabPanel value="a">内容</TabPanel>
</Tabs>;
<Tabs value="a" activation={() => 'manual'} />;
<Tabs />;
// @ts-expect-error 壳的类型：Sig<string> 不能收 undefined，子组件会写 undefined 进去的话就不对（不变）
<Tabs value={tabText} />;
// @ts-expect-error 取值范围
<Tabs orientation="diagonal" />;
// @ts-expect-error Tab 的 value 必填
<Tab />;
// @ts-expect-error Tab 的 value 是字符串（身份），不是读取函数
<Tab value={() => 'a'} />;
// @ts-expect-error TabPanel 的 value 必填
<TabPanel />;

// ---- ButtonGroup 的 context：类型来自 createContext<T> ----
ButtonGroupContext.fallback satisfies { variant?: unknown } | null;

// ---- recipe：档位取值收值或读取函数，键和取值都查得出来 ----
const demo = recipe({
  parts: ['root', 'icon'],
  variants: { size: { sm: { root: {} }, lg: { root: {} } }, wide: { true: { root: {} } } },
});
demo({ size: 'sm', wide: true });
demo({ size: () => 'lg', wide: flag });
demo().root.sx satisfies SxStyles;
// @ts-expect-error 档位取值范围
demo({ size: 'xl' });
// @ts-expect-error 没有这个档位
demo({ nothing: 'x' });
// @ts-expect-error 没有这个部件
demo().label;
// @ts-expect-error 布尔档位收 boolean
demo({ wide: 'yes' });

// ---- 元素属性（hilt/types）：class / style / sx / 事件后缀 / React 拼写，经 ...rest 转发到原生元素 ----
<Button
  class={['a', () => flag() && 'b']}
  style={{ color: () => (flag() ? 'red' : 'blue'), opacity: 0.5 }}
  sx={[() => flag() && { margin: 0 }]}
/>;
// Omit 之后后缀事件退回通用 Event（联合里的字面量键被模式键吞掉，见 hilt/types/elements.ts 的 HtmlProps 第二个参数）
<Button
  onClickCapture={(event) => event.currentTarget.disabled}
  onKeyDownOnce={(event) => event.type}
  on:my-event={(event) => event.type}
  onClick={(event) => event.clientX}
/>;
<Switch checked={flag} aria-label={text} aria-busy={flag} data-n={() => 1} style="color: red" />;
<TabList role="tablist" ref={(el) => el?.focus()} hidden={flag} />;
// @ts-expect-error React 拼写 className → class
<Button className="x" />;
// @ts-expect-error React 拼写 tabIndex → tabindex
<Tab value="a" tabIndex={0} />;
// @ts-expect-error style 长度数字不补 px
<Button style={{ width: 10 }} />;
// @ts-expect-error 字符串属性不收 cond && 'x' 的 false
<Button id={flag() && 'x'} />;
// @ts-expect-error 事件的 currentTarget 是 button，没有 checked
<Button onClick={(event) => event.currentTarget.checked} />;
// @ts-expect-error ref 的元素类型：Tab 是 button，不是 div
<Tab value="a" ref={(el: HTMLDivElement | null) => el} />;
// @ts-expect-error sx 拼错属性名
<Button sx={{ pading: 0 }} />;

// ---- recipe 的部件展开到元素、merge(部件, rest) ----
const parts = demo({ size: variant as never });
<i {...parts.root} />;
<i {...merge(parts.root, { class: 'x', 'data-extra': 'y' })} />;
// @ts-expect-error 合并进来的属性类型要对：class 不收数字
<i {...merge(parts.root, { class: 1 })} />;
