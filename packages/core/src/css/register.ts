/**
 * 引擎接入运行时：谁创建了样式（create、recipe、createTheme、defineMarker），谁就引入这个模块，
 * 它把 attrs 登记给运行时（registerStyleEngine）。运行时本身不依赖引擎：
 * 不用 sx 的应用没有任何样式值，不会引入这个模块，引擎不进包；
 * 预编译的组件库经 `...rest` 转交 sx 时，运行时用的也是应用里这份登记的引擎。
 */
import { registerStyleEngine } from '../attrs/rules';
import { attrs } from './attrs';

registerStyleEngine(attrs as never);
