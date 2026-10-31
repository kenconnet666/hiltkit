/**
 * SVG 元素的属性（自写子集）：属性名是 SVG 的原名（stroke-width 连字符、viewBox 驼峰），
 * 展示属性所有元素共有，几何属性（d、cx、points…）按元素分开。
 * SVG 里常用的 React 驼峰写法（strokeWidth、fillRule…）同样给出拼写提示。
 */
import type { Live, WriteAs } from './value';

type Length = number | string;
type Paint = string;

/** 展示属性：所有 SVG 元素都能写 */
export interface SvgPresentation {
  fill?: Paint;
  'fill-opacity'?: number | string;
  'fill-rule'?: 'nonzero' | 'evenodd' | 'inherit';
  stroke?: Paint;
  'stroke-width'?: Length;
  'stroke-opacity'?: number | string;
  'stroke-linecap'?: 'butt' | 'round' | 'square' | 'inherit';
  'stroke-linejoin'?: 'miter' | 'round' | 'bevel' | 'miter-clip' | 'arcs' | 'inherit';
  'stroke-miterlimit'?: number | string;
  'stroke-dasharray'?: Length;
  'stroke-dashoffset'?: Length;
  opacity?: number | string;
  transform?: string;
  'transform-origin'?: string;
  'clip-path'?: string;
  'clip-rule'?: 'nonzero' | 'evenodd' | 'inherit';
  mask?: string;
  filter?: string;
  color?: string;
  display?: string;
  visibility?: 'visible' | 'hidden' | 'collapse' | 'inherit';
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto' | 'inherit';
  cursor?: string;
  'pointer-events'?: string;
  'vector-effect'?: 'none' | 'non-scaling-stroke' | 'non-scaling-size' | 'non-rotation' | 'fixed-position';
  'shape-rendering'?: 'auto' | 'optimizeSpeed' | 'crispEdges' | 'geometricPrecision';
  'paint-order'?: string;
  'mix-blend-mode'?: string;
  'marker-start'?: string;
  'marker-mid'?: string;
  'marker-end'?: string;
  'font-family'?: string;
  'font-size'?: Length;
  'font-weight'?: number | string;
  'font-style'?: 'normal' | 'italic' | 'oblique';
  'letter-spacing'?: Length;
  'text-anchor'?: 'start' | 'middle' | 'end';
  'dominant-baseline'?: string;
  'text-rendering'?: string;
  'stop-color'?: string;
  'stop-opacity'?: number | string;
  'flood-color'?: string;
  'flood-opacity'?: number | string;
  'lighting-color'?: string;
  xmlns?: string;
  'xmlns:xlink'?: string;
  /** 旧写法，请用 href */
  'xlink:href'?: string;
}

/** SVG 的 React 驼峰拼写 */
export interface SvgReactSpellings {
  /** @deprecated 请写成 stroke-width */ strokeWidth?: WriteAs<'stroke-width'>;
  /** @deprecated 请写成 stroke-linecap */ strokeLinecap?: WriteAs<'stroke-linecap'>;
  /** @deprecated 请写成 stroke-linejoin */ strokeLinejoin?: WriteAs<'stroke-linejoin'>;
  /** @deprecated 请写成 stroke-dasharray */ strokeDasharray?: WriteAs<'stroke-dasharray'>;
  /** @deprecated 请写成 stroke-dashoffset */ strokeDashoffset?: WriteAs<'stroke-dashoffset'>;
  /** @deprecated 请写成 stroke-opacity */ strokeOpacity?: WriteAs<'stroke-opacity'>;
  /** @deprecated 请写成 stroke-miterlimit */ strokeMiterlimit?: WriteAs<'stroke-miterlimit'>;
  /** @deprecated 请写成 fill-opacity */ fillOpacity?: WriteAs<'fill-opacity'>;
  /** @deprecated 请写成 fill-rule */ fillRule?: WriteAs<'fill-rule'>;
  /** @deprecated 请写成 clip-path */ clipPath?: WriteAs<'clip-path'>;
  /** @deprecated 请写成 clip-rule */ clipRule?: WriteAs<'clip-rule'>;
  /** @deprecated 请写成 stop-color */ stopColor?: WriteAs<'stop-color'>;
  /** @deprecated 请写成 stop-opacity */ stopOpacity?: WriteAs<'stop-opacity'>;
  /** @deprecated 请写成 text-anchor */ textAnchor?: WriteAs<'text-anchor'>;
  /** @deprecated 请写成 font-size */ fontSize?: WriteAs<'font-size'>;
  /** @deprecated 请写成 font-family */ fontFamily?: WriteAs<'font-family'>;
  /** @deprecated 请写成 font-weight */ fontWeight?: WriteAs<'font-weight'>;
  /** @deprecated 请写成 pointer-events */ pointerEvents?: WriteAs<'pointer-events'>;
  /** @deprecated 请写成 marker-start */ markerStart?: WriteAs<'marker-start'>;
  /** @deprecated 请写成 marker-mid */ markerMid?: WriteAs<'marker-mid'>;
  /** @deprecated 请写成 marker-end */ markerEnd?: WriteAs<'marker-end'>;
  /** @deprecated 请写成 href */ xlinkHref?: WriteAs<'href'>;
  /** @deprecated 请写成 xmlns:xlink */ xmlnsXlink?: WriteAs<'xmlns:xlink'>;
}

interface Box {
  x?: Length;
  y?: Length;
  width?: Length;
  height?: Length;
}
interface ViewBoxed {
  viewBox?: string;
  preserveAspectRatio?: string;
}

interface SvgRootAttrs extends Box, ViewBoxed {
  version?: string;
  role?: string;
}
interface PathAttrs {
  d?: string;
  pathLength?: number;
}
interface CircleAttrs {
  cx?: Length;
  cy?: Length;
  r?: Length;
  pathLength?: number;
}
interface EllipseAttrs {
  cx?: Length;
  cy?: Length;
  rx?: Length;
  ry?: Length;
  pathLength?: number;
}
interface RectAttrs extends Box {
  rx?: Length;
  ry?: Length;
  pathLength?: number;
}
interface LineAttrs {
  x1?: Length;
  y1?: Length;
  x2?: Length;
  y2?: Length;
  pathLength?: number;
}
interface PointsAttrs {
  points?: string;
  pathLength?: number;
}
interface UseAttrs extends Box {
  href?: string;
}
interface ImageAttrs extends Box {
  href?: string;
  preserveAspectRatio?: string;
  crossorigin?: '' | 'anonymous' | 'use-credentials';
}
interface TextAttrs {
  x?: Length;
  y?: Length;
  dx?: Length;
  dy?: Length;
  rotate?: string;
  textLength?: Length;
  lengthAdjust?: 'spacing' | 'spacingAndGlyphs';
}
interface TextPathAttrs {
  href?: string;
  startOffset?: Length;
  method?: 'align' | 'stretch';
  spacing?: 'auto' | 'exact';
}
interface GradientAttrs {
  gradientUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  gradientTransform?: string;
  spreadMethod?: 'pad' | 'reflect' | 'repeat';
  href?: string;
}
interface LinearGradientAttrs extends GradientAttrs {
  x1?: Length;
  y1?: Length;
  x2?: Length;
  y2?: Length;
}
interface RadialGradientAttrs extends GradientAttrs {
  cx?: Length;
  cy?: Length;
  r?: Length;
  fx?: Length;
  fy?: Length;
  fr?: Length;
}
interface StopAttrs {
  offset?: number | string;
}
interface ClipPathAttrs {
  clipPathUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
}
interface MaskAttrs extends Box {
  maskUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  maskContentUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
}
interface PatternAttrs extends Box, ViewBoxed {
  patternUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  patternContentUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  patternTransform?: string;
}
interface MarkerAttrs extends ViewBoxed {
  markerWidth?: Length;
  markerHeight?: Length;
  markerUnits?: 'strokeWidth' | 'userSpaceOnUse';
  refX?: Length;
  refY?: Length;
  orient?: 'auto' | 'auto-start-reverse' | number | string;
}
interface SymbolAttrs extends Box, ViewBoxed {
  refX?: Length;
  refY?: Length;
}
interface FilterAttrs extends Box {
  filterUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  primitiveUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
}
interface FilterPrimitive extends Box {
  in?: string;
  result?: string;
}
interface FeGaussianBlurAttrs extends FilterPrimitive {
  stdDeviation?: number | string;
}
interface FeOffsetAttrs extends FilterPrimitive {
  dx?: number | string;
  dy?: number | string;
}
interface FeColorMatrixAttrs extends FilterPrimitive {
  type?: 'matrix' | 'saturate' | 'hueRotate' | 'luminanceToAlpha';
  values?: string;
}
interface FeBlendAttrs extends FilterPrimitive {
  in2?: string;
  mode?: string;
}
interface FeCompositeAttrs extends FilterPrimitive {
  in2?: string;
  operator?: 'over' | 'in' | 'out' | 'atop' | 'xor' | 'lighter' | 'arithmetic';
  k1?: number | string;
  k2?: number | string;
  k3?: number | string;
  k4?: number | string;
}
interface FeMergeNodeAttrs {
  in?: string;
}
interface AnimateAttrs {
  attributeName?: string;
  from?: string | number;
  to?: string | number;
  by?: string | number;
  values?: string;
  keyTimes?: string;
  calcMode?: 'discrete' | 'linear' | 'paced' | 'spline';
  dur?: string;
  begin?: string;
  end?: string;
  repeatCount?: number | 'indefinite';
  repeatDur?: string;
  fill?: 'freeze' | 'remove';
  href?: string;
}
interface AnimateTransformAttrs extends AnimateAttrs {
  type?: 'translate' | 'scale' | 'rotate' | 'skewX' | 'skewY';
}

/** 有专属属性的 SVG 标签；没有列出的标签只有展示属性 */
export interface SvgSpecific {
  svg: Live<SvgRootAttrs>;
  path: Live<PathAttrs>;
  circle: Live<CircleAttrs>;
  ellipse: Live<EllipseAttrs>;
  rect: Live<RectAttrs>;
  line: Live<LineAttrs>;
  polyline: Live<PointsAttrs>;
  polygon: Live<PointsAttrs>;
  use: Live<UseAttrs>;
  image: Live<ImageAttrs>;
  text: Live<TextAttrs>;
  tspan: Live<TextAttrs>;
  textPath: Live<TextPathAttrs>;
  linearGradient: Live<LinearGradientAttrs>;
  radialGradient: Live<RadialGradientAttrs>;
  stop: Live<StopAttrs>;
  clipPath: Live<ClipPathAttrs>;
  mask: Live<MaskAttrs>;
  pattern: Live<PatternAttrs>;
  marker: Live<MarkerAttrs>;
  symbol: Live<SymbolAttrs>;
  foreignObject: Live<Box>;
  filter: Live<FilterAttrs>;
  feGaussianBlur: Live<FeGaussianBlurAttrs>;
  feOffset: Live<FeOffsetAttrs>;
  feColorMatrix: Live<FeColorMatrixAttrs>;
  feBlend: Live<FeBlendAttrs>;
  feComposite: Live<FeCompositeAttrs>;
  feMergeNode: Live<FeMergeNodeAttrs>;
  animate: Live<AnimateAttrs>;
  animateTransform: Live<AnimateTransformAttrs>;
  set: Live<AnimateAttrs>;
}
