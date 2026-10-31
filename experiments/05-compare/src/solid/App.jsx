import { Counter } from './Counter.jsx';

// 调用方：传 class / style / 事件 / ref / children
export function App() {
  let el;
  return (
    <Counter label="n" class="outer" style={{ color: 'red' }} onClick={() => console.log('outer click')} ref={el}>
      <b>child</b>
    </Counter>
  );
}
