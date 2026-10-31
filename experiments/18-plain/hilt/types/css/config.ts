/** 引擎的配置与服务端输出（对应 10-css/engine 的 config.ts、sheet.ts）。 */

/** 引擎的全局配置：必须在第一条规则插入之前设好（应用入口第一行），服务端与客户端用同一份 */
export interface EngineConfig {
  /** 组合类的选择器写法：'plain' 是 `.c`（条件块靠重复类名抬特异性），'where' 是 `:where(.c)`（特异性为 0，使用方任何选择器都能盖过） */
  specificity: 'plain' | 'where';
  /** 所有规则放进的 @layer 名字；false 不用。名字要和宿主的层顺序协调 */
  layer: string | false;
  /** 引擎的样式表最前面声明的层顺序（如 'theme, base, components, utilities'） */
  layerOrder: string | false;
  /** 开发模式：类名带上文件、组件名，热更新登记片段与组合类的对应 */
  dev: boolean;
}
export declare function configure(options: Partial<EngineConfig>): void;

export interface StyleTagOptions {
  /** 就算 HTML 里没出现也要带上的类名（防闪烁脚本会往 <html> 上加的主题类） */
  include?: readonly string[];
}
/** 服务端渲染：一段 HTML 用到的规则写成一个 `<style data-hilt-css data-names="…">`，放进 head 的最前面 */
export declare function renderStyleTag(html: string, options?: StyleTagOptions): string;
