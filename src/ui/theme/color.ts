/**
 * OKLCH, the space the palette is authored in, converted to the sRGB hex that three.js and SVG
 * attributes take. The CSS keeps the OKLCH value; anything drawn from script reads the hex made
 * here from the very same numbers, so a colour is written once (tokens.ts).
 *
 * Pure arithmetic (Björn Ottosson's OKLab matrices), no DOM: the Vite config, the 3D builders
 * and the tests all load it.
 */

/** A colour as the palette states it: lightness in percent, chroma, hue in degrees, optional alpha. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha?: number;
}

/** One palette colour: the CSS value the stylesheet uses and the hex script consumers use. */
export interface Swatch {
  readonly css: string;
  /** `#rrggbb`, alpha dropped (the 3D materials and SVG fills that read it are opaque) */
  readonly hex: string;
  readonly alpha: number;
}

const toByte = (linear: number): number => {
  const v = Math.min(1, Math.max(0, linear));
  const gamma = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, gamma)) * 255);
};

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** sRGB hex for an OKLCH colour, clipped to the sRGB gamut. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const L = l / 100;
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  return `#${hex2(toByte(r))}${hex2(toByte(g))}${hex2(toByte(bl))}`;
}

/** A palette colour from OKLCH numbers: `oklch(97.7, 0.007, 85)` is `oklch(97.7% 0.007 85)`. */
export function oklch(l: number, c: number, h: number, alpha?: number): Swatch {
  const a = alpha === undefined ? "" : ` / ${alpha}`;
  return Object.freeze({ css: `oklch(${l}% ${c} ${h}${a})`, hex: oklchToHex({ l, c, h }), alpha: alpha ?? 1 });
}

/**
 * A palette colour given as sRGB hex (the 3D surfaces, whose albedos were picked as hex), with
 * an optional alpha for strokes painted onto a texture canvas.
 */
export function srgb(hex: string, alpha?: number): Swatch {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const h = hex.toLowerCase();
  if (alpha === undefined) return Object.freeze({ css: h, hex: h, alpha: 1 });
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Object.freeze({ css: `rgb(${r} ${g} ${b} / ${alpha})`, hex: h, alpha });
}

/** WCAG 2 relative luminance of a hex colour. */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2 contrast ratio between two hex colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
