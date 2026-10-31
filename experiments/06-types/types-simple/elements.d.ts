/** 性能对照用的“简单版”元素类型：不区分标签、不生成事件、不列 ARIA，只保留 sx / ref / children / key */
import type { Children, Ref } from 'exp06/core';
import type { SxStyles } from 'exp06/styles';

export type HtmlTag = string;
export type SvgTag = string;
export type IntrinsicTag = string;
export type ElementOf<Tag> = Element;

export interface IntrinsicProps<Tag extends IntrinsicTag = string> {
  sx?: SxStyles;
  ref?: Ref<any>;
  key?: string | number | symbol;
  children?: Children;
  [event: `on${string}`]: (event: any) => void;
  [attr: string]: any;
}
