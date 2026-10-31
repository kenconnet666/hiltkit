// 方案五的类型边界：下面标了“查不出”的几行都能通过 tsc，这是这条路线的代价；标了 @ts-expect-error 的仍然查得出
interface InputProps {
  value?: string;
  size?: 'sm' | 'md';
}
const Input = _component((_props: InputProps) => <i />);
interface NullableProps {
  value?: string | null;
}
const Clearable = _component((_props: NullableProps) => <i />);
interface WideProps {
  value?: unknown;
}
const Any = _component((_props: WideProps) => <i />);

let text = _state('');
let count = _state(0);
let size = _state<string>('sm');
const upper = _derived(text.toUpperCase());

// ---- 还查得出 ----
<Input value={text} />;
// @ts-expect-error 类型不对
<Input value={count} />;
// @ts-expect-error string 不能给 'sm' | 'md'
<Input size={size} />;
// @ts-expect-error 属性不存在
<Input nothing={text} />;

// ---- 查不出 ----
// 子组件能写进 null，父级的 text 类型是 string：方案一会报错（Ref 不变）
<Clearable value={text} />;
// 只读的派生传给 _model：写入没有去处，只能运行时处理；方案一会报错（computed 不是 Ref）
<Input value={upper} />;
// 子组件写入 unknown，能把任何东西写进父级的 string
<Any value={text} />;

// ---- 单向和双向在调用处长得一样，类型上也一样 ----
<Input value={text} />; // 双向还是单向，取决于 Input 有没有声明 _model，调用处看不出来
<Input value={`${text}`} />; // 单向
export {};
