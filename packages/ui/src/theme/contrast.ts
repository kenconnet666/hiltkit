/**
 * 对比度计算（WCAG 2）：内置主题的测试和用户自建主题的检查共用。
 * 只认 #RRGGBB 和 rgba()；var()、color-mix() 这些算不出来，返回 undefined，不算违规。
 */

type Rgba = readonly [number, number, number, number];

export function parseColor(color: string): Rgba | undefined {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16), 1];
  const rgb = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(color);
  if (rgb) return [+rgb[1]!, +rgb[2]!, +rgb[3]!, rgb[4] === undefined ? 1 : +rgb[4]];
  return undefined;
}

const luminance = ([r, g, b]: Rgba): number => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** 前景和背景的对比度。半透明的前景先叠到背景上再算；算不出来返回 undefined */
export function contrast(foreground: string, background: string): number | undefined {
  const front = parseColor(foreground);
  const back = parseColor(background);
  if (!front || !back) return undefined;
  const alpha = front[3];
  const mixed: Rgba = [
    front[0] * alpha + back[0] * (1 - alpha),
    front[1] * alpha + back[1] * (1 - alpha),
    front[2] * alpha + back[2] * (1 - alpha),
    1,
  ];
  const a = luminance(mixed);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
