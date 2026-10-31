import { render } from 'solid-js/web';
import { collect, log, ownRef, parentRef } from '../harness.js';

const own = () => log.push('own');
// 变体 A：{...props} 在前，自带属性在后；变体 B：自带属性在前，{...props} 在后
const A = (props) => (
  <button {...props} class="own" style={{ 'font-weight': 'bold' }} onClick={own} ref={ownRef}>
    x
  </button>
);
const B = (props) => (
  <button class="own" style={{ 'font-weight': 'bold' }} onClick={own} ref={ownRef} {...props}>
    x
  </button>
);

const root = document.body.appendChild(document.createElement('div'));
render(
  () => (
    <>
      <A class="parent" style={{ color: 'red' }} onClick={() => log.push('parent')} ref={parentRef} />
      <B class="parent" style={{ color: 'red' }} onClick={() => log.push('parent')} ref={parentRef} />
    </>
  ),
  root,
);
window.semantics = () => collect(root);
