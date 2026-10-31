// 使用方的类型：只看组件库发布的 .d.ts，源码不在这个工程里
import { derived, sig, type Sig } from 'hilt';
import { Button, Select, Switch, useCounter } from '@lib/ui';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expect<T extends true>(): T | void {}

const on = sig(false);
const text = sig('');
const ro = derived(() => true);

<Switch />;
<Switch checked={on} />;
<Switch checked={true} />;
<Switch checked={ro} />;
<Switch label={text} id="a" />;
// @ts-expect-error 壳的类型不对
<Switch checked={text} />;
// @ts-expect-error 原生属性也查
<Switch id={1} />;

<Button loading={on} onClick={(event) => event.clientX}>保存</Button>;
// @ts-expect-error loading 的类型不对
<Button loading={text} />;

// 泛型穿过 .d.ts
interface Fruit {
  id: number;
  name: string;
}
const fruits: Fruit[] = [];
const picked = sig<Fruit | undefined>(undefined);
<Select options={fruits} value={picked} text={(item) => item.name} />;
// @ts-expect-error item 是 Fruit，没有 title
<Select options={fruits} text={(item) => item.title} />;
const wrong = sig<string | undefined>(undefined);
// @ts-expect-error 值和选项类型对不上
<Select options={fruits} value={wrong} text={(item) => item.name} />;

const counter = useCounter(1);
expect<Equal<typeof counter.count, Sig<number>>>();
counter.count.inc();
// @ts-expect-error 数字没有 toggle
counter.count.toggle();
export {};

// 元素属性与样式经 .d.ts 转发
<Button class={['a', () => on() && 'b']} style={{ color: text }} sx={[() => on() && { margin: 0 }]} aria-busy={on} data-x={() => 1} />;
// @ts-expect-error React 拼写
<Button className="x" />;
// @ts-expect-error style 长度数字
<Button style={{ width: 10 }} />;
// @ts-expect-error cond && 'x' 的 false
<Button title={on() && 'x'} />;
// @ts-expect-error 事件 currentTarget 是 button
<Button onClick={(event) => event.currentTarget.checked} />;
