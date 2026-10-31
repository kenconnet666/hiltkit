// 预编译组件库里的一个原语：只转交 ...rest，自己不创建任何样式，所以编译产物里没有对引擎的依赖
export const Box = _component(({ children, ...rest }) => (
  <div class="lib-box" {...rest}>
    {children}
  </div>
));
