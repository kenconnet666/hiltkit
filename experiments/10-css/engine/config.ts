/**
 * 引擎的全局配置：必须在第一条规则插入之前设好（应用入口第一行），规则的文本、类名哈希都随它变，
 * 所以服务端与客户端要用同一份配置（SSR 的 data-names 才对得上）。
 */
export interface EngineConfig {
  /**
   * 组合类的选择器写法（实验 10-css/priority 对比过三种，见 API.md §6）：
   *   'plain'：`.c`，条件块靠重复类名抬特异性（.c.c），默认，同 StyleX 的块内优先级
   *   'where'：`:where(.c)`，特异性为 0，使用方任何选择器都能盖过组件
   */
  specificity: 'plain' | 'where';
  /** 所有规则放进的 @layer 名字；false 不用。名字要和宿主的层顺序协调（API.md §6） */
  layer: string | false;
  /** 引擎的样式表最前面声明的层顺序（如 'theme, base, components, utilities'）：引擎的表在 head 最前，不声明的话它的层排在宿主所有层之前 */
  layerOrder: string | false;
  /** 开发模式：类名带上文件、组件名（`Button-root-x1abc`），热更新登记片段与组合类的对应 */
  dev: boolean;
}

export const config: EngineConfig = { specificity: 'plain', layer: false, layerOrder: false, dev: false };

/** 改配置（只能在引擎插入第一条规则之前调用） */
export function configure(options: Partial<EngineConfig>) {
  Object.assign(config, options);
}
