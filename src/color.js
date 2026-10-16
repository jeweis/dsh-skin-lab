/**
 * Color math for the picker, the skin derivation and the wallpaper.
 *
 * Pure functions with no framework or DOM knowledge, so every conversion and
 * every piece of pointer geometry can be asserted in `verify.mjs` without a
 * browser. The only impure thing the UI adds on top is reading
 * `getBoundingClientRect()` and passing it in.
 *
 * @typedef {{ r: number, g: number, b: number }} Rgb
 * @typedef {{ h: number, s: number, v: number }} Hsv - hue 0..360, saturation and value 0..1.
 */

/**
 * @param {number} n - value.
 * @param {number} lo - lower bound.
 * @param {number} hi - upper bound.
 * @returns {number} `n` pulled into `[lo, hi]`.
 */
export function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n
}

/** White, as the derivation's "raise a surface" target. */
export const WHITE = '#ffffff'

/** Pure black, the target for "deepen this colour". */
export const BLACK = '#000000'

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * @param {unknown} input - candidate color, with or without `#`, 3 or 6 digits.
 * @returns {string | null} canonical lowercase `#rrggbb`, or null when it is not a hex color.
 */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null
  const match = HEX.exec(input.trim())
  if (match === null) return null
  const digits = match[1].toLowerCase()
  return `#${digits.length === 3 ? digits.split('').map((digit) => digit + digit).join('') : digits}`
}

/**
 * @param {string} hex - hex color; invalid input reads as black rather than throwing in a render.
 * @returns {Rgb} channels in 0..255.
 */
export function hexToRgb(hex) {
  const value = normalizeHex(hex) ?? '#000000'
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  }
}

/**
 * @param {Rgb} rgb - channels in 0..255; each is rounded and clamped.
 * @returns {string} `#rrggbb`.
 */
export function rgbToHex({ r, g, b }) {
  const at = (/** @type {number} */ channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')
  return `#${at(r)}${at(g)}${at(b)}`
}

/**
 * @param {Rgb} rgb - channels in 0..255.
 * @returns {Hsv} hue in degrees, saturation/value in 0..1.
 */
export function rgbToHsv({ r, g, b }) {
  const red = clamp(r, 0, 255) / 255
  const green = clamp(g, 0, 255) / 255
  const blue = clamp(b, 0, 255) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const span = max - min
  let hue = 0
  if (span > 0) {
    if (max === red) hue = ((green - blue) / span) % 6
    else if (max === green) hue = (blue - red) / span + 2
    else hue = (red - green) / span + 4
    hue *= 60
    if (hue < 0) hue += 360
  }
  return { h: hue, s: max === 0 ? 0 : span / max, v: max }
}

/**
 * @param {Hsv} hsv - hue in degrees (wraps), saturation/value in 0..1 (clamped).
 * @returns {Rgb} channels in 0..255.
 */
export function hsvToRgb({ h, s, v }) {
  const hue = ((h % 360) + 360) % 360
  const saturation = clamp(s, 0, 1)
  const value = clamp(v, 0, 1)
  const chroma = value * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const offset = value - chroma
  const sector = Math.floor(hue / 60) % 6
  const table = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][sector]
  return {
    r: Math.round((table[0] + offset) * 255),
    g: Math.round((table[1] + offset) * 255),
    b: Math.round((table[2] + offset) * 255),
  }
}

/**
 * @param {string} hex - hex color.
 * @returns {Hsv} the same color in HSV.
 */
export function hexToHsv(hex) {
  return rgbToHsv(hexToRgb(hex))
}

/**
 * @param {Hsv} hsv - HSV color.
 * @returns {string} `#rrggbb`.
 */
export function hsvToHex(hsv) {
  return rgbToHex(hsvToRgb(hsv))
}

/**
 * @param {string} hex - hex color.
 * @param {number} alpha - opacity in 0..1.
 * @returns {string} an `rgba(...)` value.
 */
export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(clamp(alpha, 0, 1))})`
}

/**
 * Mix two `#rrggbb` colors; `0` returns `a`, `1` returns `b`.
 * @param {string} a - start color.
 * @param {string} b - end color.
 * @param {number} ratio - blend factor.
 * @returns {string} the mixed color.
 */
export function mix(a, b, ratio) {
  const from = hexToRgb(a)
  const to = hexToRgb(b)
  const at = (/** @type {number} */ start, /** @type {number} */ end) => Math.round(start + (end - start) * ratio).toString(16).padStart(2, '0')
  return `#${at(from.r, to.r)}${at(from.g, to.g)}${at(from.b, to.b)}`
}

/**
 * sRGB channel (0..1) to linear light.
 * @param {number} channel - 0..1.
 * @returns {number} linear value.
 */
function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/**
 * Linear light back to an sRGB channel.
 * @param {number} value - linear value.
 * @returns {number} 0..1 (unclamped; callers clamp).
 */
function linearToSrgb(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

/** @typedef {{ L: number, a: number, b: number }} Oklab */

/**
 * @param {{ r: number, g: number, b: number }} rgb - 0..255 channels.
 * @returns {Oklab} the colour in OKLab (Ottosson, 2020).
 */
function rgbToOklab({ r, g, b }) {
  const lr = srgbToLinear(r / 255)
  const lg = srgbToLinear(g / 255)
  const lb = srgbToLinear(b / 255)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  }
}

/**
 * @param {Oklab} lab - the colour in OKLab.
 * @returns {{ r: number, g: number, b: number }} clamped 0..255 channels.
 */
function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  /** @param {number} value @returns {number} */
  const channel = (value) => Math.round(clamp(linearToSrgb(value), 0, 1) * 255)
  return {
    r: channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: channel(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  }
}

/**
 * Mix two colours in OKLab rather than in sRGB, which is what every derived palette
 * token uses.
 *
 * sRGB interpolation runs a straight line through gamma-encoded bytes, which is why
 * naive mixes go muddy: the midpoint of black and white lands on `#808080`, a grey
 * that reads far too light, and tinting an accent toward a surface passes through a
 * desaturated sludge. OKLab is perceptually uniform, so equal steps look equal, the
 * black-to-white midpoint is a genuine mid grey (~`#636363`), and accent tints stay
 * clean instead of turning grey.
 *
 * @param {string} a - start color.
 * @param {string} b - end color.
 * @param {number} ratio - blend factor; `0` returns `a`, `1` returns `b`.
 * @returns {string} `#rrggbb`.
 */
export function mixOk(a, b, ratio) {
  if (ratio <= 0) return a
  if (ratio >= 1) return b
  const from = rgbToOklab(hexToRgb(a))
  const to = rgbToOklab(hexToRgb(b))
  return rgbToHex(oklabToRgb({
    L: from.L + (to.L - from.L) * ratio,
    a: from.a + (to.a - from.a) * ratio,
    b: from.b + (to.b - from.b) * ratio,
  }))
}

/**
 * Where a pointer landed inside the saturation/value square.
 * @param {{ left: number, top: number, width: number, height: number }} rect - the square's box.
 * @param {number} x - pointer x in viewport coordinates.
 * @param {number} y - pointer y in viewport coordinates.
 * @returns {{ s: number, v: number }} saturation across, value up.
 */
export function saturationValueFromPoint(rect, x, y) {
  return {
    s: rect.width > 0 ? clamp((x - rect.left) / rect.width, 0, 1) : 0,
    v: rect.height > 0 ? 1 - clamp((y - rect.top) / rect.height, 0, 1) : 0,
  }
}

/**
 * Where a pointer landed on the hue strip.
 * @param {{ left: number, width: number }} rect - the strip's box.
 * @param {number} x - pointer x in viewport coordinates.
 * @returns {number} hue in degrees.
 */
export function hueFromPoint(rect, x) {
  return rect.width > 0 ? clamp((x - rect.left) / rect.width, 0, 1) * 360 : 0
}

/**
 * WCAG relative luminance, used to pick readable text over a chosen swatch.
 * @param {string} hex - hex color.
 * @returns {number} luminance in 0..1.
 */
export function luminance(hex) {
  const channel = (/** @type {number} */ value) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * WCAG contrast ratio between two colours, from 1 (identical) to 21 (black on
 * white). 4.5 is the AA threshold for body text, and it is the standard the palette
 * holds its on-fill label colour to — a difference of luminances is not a measure of
 * legibility, a ratio is.
 *
 * @param {string} a - hex color.
 * @param {string} b - hex color.
 * @returns {number} the ratio, 1..21.
 */
export function contrastRatio(a, b) {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}
