// 服务端入口：hilt.ts 里只在客户端才调用的函数给空实现，其余就是 server.js
export * from '../03-publish/packages/runtime/server.js';
export const bindInput = () => {};
export const spread = () => {};
export const attrValue = () => {};
export const attrState = () => {};
export const attrBool = () => {};
