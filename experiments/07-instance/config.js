// 实验开关与计数：每个页面只跑一个组合，运行时在热路径里读这些字段。
// 每个字段对应任务书里的一项优化（编号见 run.mjs 顶部）。
export const cfg = {
  release: 'off', // 1  'off' | 'defer'（先跑后挂）| 'unlink'（先挂后断）
  noDisposer: false, // 1b 渲染 effect 不返回清理函数（少一个闭包）
  scope: true, // 2  组件是否建自己的作用域节点
  hoistSet: false, // 3  omit 的键集合在模块级建一次，hidden 并集带缓存
  light: false, // 4  rest / merge 结果不建 Proxy，只带层信息；被调用方需要读键时才懒建
  flat: false, // 5  层用 [来源, 隐藏集, 来源, 隐藏集…] 平铺数组，不为每层建对象
  delegate: false, // 6  事件委托
  lean: false, // 7a spread 一趟解析：不建 keys Set、不建 active Map，静态值先算好再写
  hoist: false, // 7b 组件内部的静态层提升进模板
  ownerArray: false, // X1 作用域的子 effect 放数组，不为每个子节点建 Link
  bindingNode: false, // X2 属性绑定用专门的节点类，不为每个 effect 建闭包
  shape: false, // 8  props 对象用原型 getter 的同形状类，键清单与 getter 清单挂在原型上
  noise: 0, // 形状实验：0 = 普通字面量；n >= 1 = 用 defineProperties 构造，键顺序有 min(n,3) 种
  ablate: '', // 分解用：'effects' 响应式键只写一次不起 effect | 'events' 不挂监听 | 'attrs' 不写 DOM | 'spread' 完全不 spread
};

export const counters = {
  proxies: 0,
  sets: 0,
  layerObjs: 0, // 层对象 + 层数组
  listeners: 0,
  setAttrs: 0,
  closures: 0, // 运行时和编译产物里“每实例新建”的闭包（getter、effect 函数、监听、dispose 等）
  getterObjs: 0,
};
