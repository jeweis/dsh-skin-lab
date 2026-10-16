/**
 * Appearance — everything a theme controls that is not the palette: how the
 * background is painted, how much chrome goes translucent, and the structural
 * elements (logo, glass, elevation) that make a theme read as a designed look.
 *
 * Pure functions plus a storage-shaped serializer, so the whole feature is
 * assertable in Node: `backgroundCss` and `elementCss` are string comparisons,
 * `transparencyTokens` and `elementTokens` are plain objects, and `parseSettings`
 * is where untrusted input (a hand-edited storage entry, an older payload) turns
 * into a valid model or is discarded field by field.
 *
 * Three decisions worth stating, because they are what make arbitrary input safe:
 *
 *   - An image source only survives `sanitizeImageUrl`: an allowlisted scheme, a
 *     length cap, and no quote or backslash — the value ends up inside
 *     `url("…")`, and those are the characters that could break out.
 *   - A built-in theme ships **one artwork per colour scheme**, and the paint picks
 *     the member that matches the scheme in force. One image per theme was the
 *     original design and it was simply wrong: scrimming a dark image into light mode
 *     flattens every dark theme into the same pale wash, so four themes lost their
 *     identity at once. A scrim can lift an image, but it cannot invent structure
 *     that was never drawn. The veil survives as a safety net for the single image a
 *     user supplies themselves, where there is no counterpart to switch to.
 *   - Released surfaces keep their palette hue: a translucent panel is
 *     `rgba(<that palette's own value>, α)` rather than a neutral grey, so the
 *     wallpaper shows through a panel that still belongs to the theme.
 */
import { clamp, normalizeHex, rgba } from './color.js'
import { embeddedBackgroundLightness, embeddedBackgrounds } from './assets.js'
import { DEFAULT_PALETTE_ID } from './palettes.js'

/** How the app background is painted. `theme` means "leave it to the theme". */
export const BACKGROUND_MODES = ['theme', 'color', 'gradient', 'image']

/**
 * The colour schemes a built-in background is drawn for. `color-scheme` on the
 * document element is the single source of truth: it is what the application already
 * sets, and it is exactly what `light-dark()` in our own CSS resolves against, so
 * reading it keeps the image choice and the scrim choice in the same frame of
 * reference instead of guessing at a media query.
 */
export const SCHEMES = ['light', 'dark']

/**
 * @param {unknown} value - candidate scheme.
 * @returns {'light' | 'dark'} a member of `SCHEMES`; anything else means `light`.
 */
export function schemeOr(value) {
  return value === 'dark' ? 'dark' : 'light'
}

/** Object-fit choices for an image background; `tile` repeats at natural size. */
export const IMAGE_SIZES = ['cover', 'contain', 'tile']

/**
 * How much of the chrome goes translucent. `base` is the safe minimum; `glass`
 * releases cards, overlays and the active nav pill too, which reads well over a
 * photograph and badly over a busy one.
 */
export const TRANSPARENCY_RANGES = ['base', 'panel', 'glass']

/** Shadow character. `default` keeps the application's own elevation. */
export const ELEVATIONS = ['default', 'soft', 'flat', 'glow']

/** Backdrop-blur chrome. `default` keeps the application's own. */
export const GLASS_MODES = ['default', 'on', 'off']

/**
 * Above this an upload is re-encoded rather than stored as it came. A data URL costs
 * ~1.37x the file and storage tops out near 5 MB, so a photo straight off a phone is over
 * it. This is a **trigger**, not a limit — the hard cap is `MAX_IMAGE_URL`.
 */
export const MAX_IMAGE_BYTES = 2_200_000

/**
 * The largest file worth reading at all. Auto-compression removes the old refusal
 * threshold, but decoding 100 MB would freeze the tab, so there is still a ceiling — just
 * one far fewer images ever reach.
 */
export const MAX_UPLOAD_BYTES = 32_000_000

/**
 * What an oversized upload is compressed down to, in data URL characters. Deliberately
 * below `MAX_IMAGE_URL`: the gap is the margin that stops a re-encode from landing one
 * byte over the hard cap it is trying to satisfy.
 */
export const SHRINK_TARGET = 2_600_000

/** Largest accepted image URL, as text. */
export const MAX_IMAGE_URL = 3_000_000

/** Field defaults; also the model returned for unreadable stored state. */
export const DEFAULT_BACKGROUND = {
  mode: 'theme',
  asset: '',
  url: '',
  color: '#101722',
  from: '#101722',
  to: '#22303f',
  angle: 135,
  size: 'cover',
  veil: 30,
  range: 'panel',
}

/** Structural element defaults. Every field at its neutral value means `elementTokens` and `elementCss` contribute nothing. */
export const DEFAULT_STYLE = {
  tintLogo: false,
  hideWordmark: false,
  logoImage: '',
  glass: 'default',
  elevation: 'default',
}

/** Which tokens each transparency range releases, in escalation order. */
/** @type {Record<string, string[]>} */
const RANGE_TOKENS = {
  base: [
    '--dsw-alias-bg-base',
  ],
  panel: [
    '--dsw-alias-bg-base',
    '--dsw-specific-sidebar-fill',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-settings-card-fill',
  ],
  glass: [
    '--dsw-alias-bg-base',
    '--dsw-specific-sidebar-fill',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-overlay',
    '--dsw-alias-settings-card-fill',
    '--dsw-specific-sidebar-nav-item-active',
  ],
}

/** How opaque a released surface stays. `null` means fully transparent. */
/** @type {Record<string, number | null>} */
const RELEASE_ALPHA = {
  '--dsw-alias-bg-base': null,
  '--dsw-specific-sidebar-fill': 0.62,
  '--dsw-alias-bg-layer-1': 0.78,
  '--dsw-alias-bg-layer-2': 0.70,
  '--dsw-alias-bg-layer-3': 0.84,
  '--dsw-alias-bg-overlay': 0.90,
  '--dsw-alias-settings-card-fill': 0.74,
  '--dsw-specific-sidebar-nav-item-active': 0.55,
}

/**
 * Elevation stacks.
 *
 * The platform's own values are a 1px stroke ring drawn from `--dsw-elevation-stroke`
 * followed by two soft shadows, so a replacement keeps the ring and changes only the
 * falloff: the surface keeps its crisp edge and gains a different depth. That ring is
 * why the theme never has to fight the application's borders — it already inherits
 * this palette's `--dsw-alias-border-l4` through `--dsw-elevation-stroke-color`.
 */
/** @type {Record<string, string>} */
const ELEVATION_SOFT = {
  '--dsw-elevation-soft': 'var(--dsw-elevation-stroke), 0 6px 20px 0 rgba(0, 0, 0, 0.07), 0 1px 3px 0 rgba(0, 0, 0, 0.05)',
  '--dsw-elevation-panel': 'var(--dsw-elevation-stroke), 0 4px 14px 0 rgba(0, 0, 0, 0.06), 0 0 22px 0 rgba(0, 0, 0, 0.04)',
  '--dsw-elevation-prominent': 'var(--dsw-elevation-stroke), 0 14px 40px 0 rgba(0, 0, 0, 0.12), 0 2px 6px 0 rgba(0, 0, 0, 0.06)',
  '--dsw-shadow-lv1': '0 2px 6px 0 rgba(0, 0, 0, 0.06)',
  '--dsw-shadow-lv1-blur': '0 6px 20px 0 rgba(0, 0, 0, 0.07)',
  '--dsw-shadow-lv2': '0 4px 14px 0 rgba(0, 0, 0, 0.08)',
  '--dsw-shadow-lv3': '0 14px 40px 0 rgba(0, 0, 0, 0.14)',
}

/** Flat: keep the hairline, drop every falloff. */
/** @type {Record<string, string>} */
const ELEVATION_FLAT = {
  '--dsw-elevation-soft': '0 0 0 1px var(--dsw-elevation-stroke-color)',
  '--dsw-elevation-panel': '0 0 0 1px var(--dsw-elevation-stroke-color)',
  '--dsw-elevation-prominent': '0 0 0 1px var(--dsw-elevation-stroke-color)',
  '--dsw-shadow-lv1': 'none',
  '--dsw-shadow-lv1-blur': 'none',
  '--dsw-shadow-lv2': 'none',
  '--dsw-shadow-lv3': 'none',
}

/**
 * Glow: the ring and the halo are both drawn from the palette accent, which is the
 * one place a theme is allowed to colour a shadow.
 * @param {string} accent - the palette accent for one scheme.
 * @returns {Record<string, string>} elevation and shadow overrides.
 */
function glowElevation(accent) {
  const ring = rgba(accent, 0.30)
  const halo = rgba(accent, 0.22)
  const tight = rgba(accent, 0.16)
  return {
    '--dsw-elevation-stroke-color': ring,
    '--dsw-elevation-soft': `0 0 0 1px ${ring}, 0 6px 22px 0 ${halo}, 0 1px 3px 0 rgba(0, 0, 0, 0.10)`,
    '--dsw-elevation-panel': `0 0 0 1px ${ring}, 0 4px 16px 0 ${tight}, 0 0 24px 0 ${tight}`,
    '--dsw-elevation-prominent': `0 0 0 1px ${ring}, 0 14px 44px 0 ${halo}, 0 2px 6px 0 rgba(0, 0, 0, 0.12)`,
    '--dsw-shadow-lv1': `0 2px 8px 0 ${tight}`,
    '--dsw-shadow-lv1-blur': `0 6px 22px 0 ${halo}`,
    '--dsw-shadow-lv2': `0 4px 16px 0 ${halo}`,
    '--dsw-shadow-lv3': `0 14px 44px 0 ${halo}`,
  }
}

/**
 * @param {unknown} value - candidate image source.
 * @returns {string} a URL that is safe to place inside `url("…")`, or `''`.
 */
export function sanitizeImageUrl(value) {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (url === '' || url.length > MAX_IMAGE_URL) return ''
  if (!/^(?:data:image\/|https?:\/\/|blob:)/i.test(url)) return ''
  // The value is interpolated into a double-quoted CSS string: a quote or a
  // backslash is an escape hatch, and a newline ends the declaration.
  if (/["'\\\r\n]/.test(url)) return ''
  return url
}

/**
 * @param {unknown} value - candidate enum member.
 * @param {readonly string[]} allowed - the legal values.
 * @param {string} fallback - used when `value` is not one of them.
 * @returns {string} a member of `allowed`.
 */
function enumOr(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

/**
 * @param {unknown} value - candidate number.
 * @param {number} lo - lower bound.
 * @param {number} hi - upper bound.
 * @param {number} fallback - used when `value` is not a finite number.
 * @returns {number} a finite number inside `[lo, hi]`.
 */
function numberOr(value, lo, hi, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(clamp(value, lo, hi)) : fallback
}

/** @param {unknown} value @param {boolean} fallback @returns {boolean} */
function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * @param {unknown} value - candidate built-in background key.
 * @returns {string} a key present in `embeddedBackgrounds`, or `''`.
 */
export function sanitizeAssetKey(value) {
  return typeof value === 'string' && value in embeddedBackgrounds ? value : ''
}

/**
 * Turn stored text into a usable background, field by field. Never throws: an
 * unreadable payload yields the defaults, and one bad field costs only that field.
 *
 * @param {unknown} source - the candidate background, or the document wrapping it.
 * @returns {typeof DEFAULT_BACKGROUND} a fully populated background.
 */
export function parseBackground(source) {
  if (source === null || typeof source !== 'object') return { ...DEFAULT_BACKGROUND }
  const raw = /** @type {Record<string, unknown>} */ (source)
  return {
    mode: enumOr(raw.mode, BACKGROUND_MODES, DEFAULT_BACKGROUND.mode),
    asset: sanitizeAssetKey(raw.asset),
    url: sanitizeImageUrl(raw.url),
    color: normalizeHex(raw.color) ?? DEFAULT_BACKGROUND.color,
    from: normalizeHex(raw.from) ?? DEFAULT_BACKGROUND.from,
    to: normalizeHex(raw.to) ?? DEFAULT_BACKGROUND.to,
    angle: numberOr(raw.angle, 0, 360, DEFAULT_BACKGROUND.angle),
    size: enumOr(raw.size, IMAGE_SIZES, DEFAULT_BACKGROUND.size),
    veil: numberOr(raw.veil, 0, 85, DEFAULT_BACKGROUND.veil),
    range: enumOr(raw.range, TRANSPARENCY_RANGES, DEFAULT_BACKGROUND.range),
  }
}

/**
 * @param {unknown} source - the candidate style block.
 * @returns {typeof DEFAULT_STYLE} a fully populated style block.
 */
export function parseStyle(source) {
  if (source === null || typeof source !== 'object') return { ...DEFAULT_STYLE }
  const raw = /** @type {Record<string, unknown>} */ (source)
  return {
    tintLogo: boolOr(raw.tintLogo, DEFAULT_STYLE.tintLogo),
    hideWordmark: boolOr(raw.hideWordmark, DEFAULT_STYLE.hideWordmark),
    logoImage: sanitizeImageUrl(raw.logoImage),
    glass: enumOr(raw.glass, GLASS_MODES, DEFAULT_STYLE.glass),
    elevation: enumOr(raw.elevation, ELEVATIONS, DEFAULT_STYLE.elevation),
  }
}

/** The whole persisted document. */
export const DEFAULT_SETTINGS = {
  paletteId: DEFAULT_PALETTE_ID,
  background: { ...DEFAULT_BACKGROUND },
  style: { ...DEFAULT_STYLE },
}

/**
 * @param {unknown} raw - the string read from storage.
 * @returns {typeof DEFAULT_SETTINGS} a fully populated settings document.
 */
export function parseSettings(raw) {
  if (typeof raw !== 'string' || raw === '') return { ...DEFAULT_SETTINGS, background: { ...DEFAULT_BACKGROUND }, style: { ...DEFAULT_STYLE } }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_SETTINGS, background: { ...DEFAULT_BACKGROUND }, style: { ...DEFAULT_STYLE } }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ...DEFAULT_SETTINGS, background: { ...DEFAULT_BACKGROUND }, style: { ...DEFAULT_STYLE } }
  }
  const document = /** @type {Record<string, unknown>} */ (parsed)
  const paletteId = typeof document.paletteId === 'string' && document.paletteId !== ''
    ? document.paletteId
    : DEFAULT_PALETTE_ID
  return { paletteId, background: parseBackground(document.background), style: parseStyle(document.style) }
}

/**
 * @param {typeof DEFAULT_SETTINGS} settings - the document to store.
 * @returns {string} JSON text.
 */
export function serializeSettings(settings) {
  return JSON.stringify({ paletteId: settings.paletteId, background: settings.background, style: settings.style })
}

/**
 * The image actually painted: the user's own source wins over the built-in key, and a
 * built-in key resolves to the artwork drawn for `scheme`.
 *
 * @param {typeof DEFAULT_BACKGROUND} background - the chosen background.
 * @param {'light' | 'dark'} scheme - the colour scheme in force.
 * @returns {string} a data URL or `''`.
 */
export function backgroundSource(background, scheme) {
  const custom = sanitizeImageUrl(background.url)
  if (custom !== '') return custom
  if (background.asset === '') return ''
  return embeddedBackgrounds[background.asset]?.[schemeOr(scheme)] ?? ''
}

/**
 * Whether anything should be painted over the palette's surface. Deliberately not a
 * function of the scheme: a key resolves to artwork in *both* schemes, so whether the
 * page is painted cannot depend on which one is in force.
 *
 * @param {typeof DEFAULT_BACKGROUND} background - the chosen background.
 * @returns {boolean} whether the background paints anything at all.
 */
export function isPainted(background) {
  if (background.mode === 'gradient' || background.mode === 'color') return true
  if (background.mode !== 'image') return false
  return sanitizeImageUrl(background.url) !== '' || sanitizeAssetKey(background.asset) !== ''
}

/**
 * Where a backdrop has to land for each scheme's own text to stay readable, and how
 * far an automatic veil may go.
 *
 * A fixed veil cannot work. The interface's text is near-black under a light scheme
 * and near-white under a dark one, and a released page surface is transparent — so a
 * dark image behind a light interface puts near-black text on a dark photograph. The
 * scrim therefore has to depend on the image *and* the scheme. `light` and `dark` are
 * the comfortable mean-lightness ceiling and floor, `max` caps the scrim, and
 * `unknown` is the standing assumption for a user's own image, whose lightness this
 * half cannot read without decoding it.
 */
const BACKDROP = { light: 0.68, dark: 0.30, max: 0.72, unknown: 0.5 }

/**
 * The scrim a backdrop of this mean lightness needs in each scheme.
 *
 * Zero when the image already suits the scheme — a dark image in dark mode is the
 * intended pairing and keeps every bit of its detail. It ramps up as the mismatch
 * grows, which is what turns a dark image into a pale washed backdrop behind a light
 * interface instead of an unreadable one.
 *
 * @param {number} lightness - mean lightness of the artwork, 0..1.
 * @returns {{ light: number, dark: number }} scrim alphas.
 */
function autoVeil(lightness) {
  return {
    light: clamp((BACKDROP.light - lightness) / (1 - BACKDROP.light), 0, BACKDROP.max),
    dark: clamp((lightness - BACKDROP.dark) / BACKDROP.dark, 0, BACKDROP.max),
  }
}

/**
 * The scrim pair a background asks for: the automatic correction for the current
 * mismatch, biased by the user's own control (`veil` of 30 is neutral).
 *
 * The lightness read is the lightness of the image *this scheme will paint*. For a
 * paired built-in that is the artwork drawn for the scheme, so the correction is
 * zero; for a user's own single image the correction is whatever it takes to keep
 * that scheme's text readable.
 *
 * @param {typeof DEFAULT_BACKGROUND} background - the chosen background.
 * @param {'light' | 'dark'} scheme - the colour scheme in force.
 * @returns {{ light: number, dark: number }} scrim alphas, rounded for stable CSS.
 */
function veilPair(background, scheme) {
  const custom = sanitizeImageUrl(background.url)
  const stats = custom === ''
    ? embeddedBackgroundLightness[String(background.asset ?? '')]?.[schemeOr(scheme)]
    : undefined
  const auto = autoVeil(stats?.mean ?? BACKDROP.unknown)
  const bias = (background.veil - 30) * 0.006
  /** @param {number} value */
  const shape = (value) => Math.round(clamp(value + bias, 0, 0.88) * 1000) / 1000
  return { light: shape(auto.light), dark: shape(auto.dark) }
}

/**
 * The paint itself. It lands on `html`, not `body`: an `html` background
 * propagates to the canvas, so it stays behind every app surface without z-index
 * games, and `background-attachment: fixed` keeps a photograph from scrolling.
 *
 * The scrim is written twice. The first declaration is a plain dark scrim, which
 * every engine understands; the second uses `light-dark()`, which reads the
 * `color-scheme` the application already sets on `html`, so one image gets a light
 * scrim in light mode and a dark one in dark mode — at *different* strengths, because
 * the mismatch being corrected is not symmetric. An engine without `light-dark()`
 * keeps the first declaration. For a paired built-in both strengths are zero, so the
 * whole mechanism is inert and the artwork shows exactly as drawn.
 *
 * @param {typeof DEFAULT_BACKGROUND} background - the chosen background.
 * @param {'light' | 'dark'} scheme - the colour scheme in force, which selects the artwork.
 * @returns {string} CSS text, or `''` when the palette should keep its own surface.
 */
export function backgroundCss(background, scheme) {
  if (!isPainted(background)) return ''
  const base = background.mode === 'gradient'
    ? background.from
    : background.mode === 'color' ? background.color : '#0b0f14'
  /** @type {string[]} */
  const layers = []
  if (background.mode === 'gradient') {
    layers.push(`linear-gradient(${String(background.angle)}deg, ${background.from}, ${background.to})`)
  }
  const tiled = background.mode === 'image' && background.size === 'tile'
  const size = background.mode === 'image' && !tiled ? background.size : 'auto'
  const rules = [
    `html{background-color:${base};background-size:${size};background-position:center;background-repeat:${tiled ? 'repeat' : 'no-repeat'};background-attachment:fixed}`,
  ]
  if (background.mode === 'image') {
    const source = `url(${JSON.stringify(backgroundSource(background, scheme))})`
    const veil = veilPair(background, scheme)
    const lead = layers.length > 0 ? `${layers.join(', ')}, ` : ''
    const scrim = (/** @type {string} */ color, /** @type {number} */ alpha) => (
      `linear-gradient(${rgba(color, alpha)}, ${rgba(color, alpha)})`
    )
    const themed = (/** @type {number} */ alpha) => (
      `linear-gradient(light-dark(${rgba('#ffffff', alpha)}, ${rgba('#000000', alpha)}), light-dark(${rgba('#ffffff', alpha)}, ${rgba('#000000', alpha)}))`
    )
    rules.push(`html{background-image:${lead}${veil.dark > 0 ? `${scrim('#000000', veil.dark)}, ` : ''}${source}}`)
    // White at the light-scheme strength, black at the dark-scheme strength: two
    // different alphas, which is the whole point of writing the scrim this way.
    const pair = veil.light === veil.dark
      ? themed(veil.light)
      : `linear-gradient(light-dark(${rgba('#ffffff', veil.light)}, ${rgba('#000000', veil.dark)}), light-dark(${rgba('#ffffff', veil.light)}, ${rgba('#000000', veil.dark)}))`
    rules.push(`html{background-image:${lead}${veil.light > 0 || veil.dark > 0 ? `${pair}, ` : ''}${source}}`)
  } else {
    rules.push(`html{background-image:${layers.length > 0 ? layers.join(', ') : 'none'}}`)
  }
  rules.push('body{background-color:transparent}')
  return rules.join('')
}

/**
 * Used when the official palette is in force: the application's own surface values
 * are not ours to read, so a released surface falls back to neutral translucent
 * chrome. Without this the paint would land behind opaque panels and appear to do
 * nothing — the failure mode this whole mechanism exists to prevent.
 */
const NEUTRAL_RELEASE = { light: 'rgba(255, 255, 255, 0.62)', dark: 'rgba(12, 16, 22, 0.58)' }

/**
 * The token overrides that let the paint through. Without these the application's
 * own opaque surfaces sit on top of the wallpaper and nothing appears to happen.
 *
 * @param {typeof DEFAULT_BACKGROUND} background - the chosen background.
 * @param {Record<string, { light: string, dark: string }>} paletteTokens - the active palette, or `{}` for the official one.
 * @returns {Record<string, { light: string, dark: string }>} overrides, or `{}`.
 */
export function transparencyTokens(background, paletteTokens) {
  if (!isPainted(background)) return {}
  /** @type {Record<string, { light: string, dark: string }>} */
  const out = {}
  for (const name of RANGE_TOKENS[background.range]) {
    const alpha = RELEASE_ALPHA[name]
    const pair = paletteTokens[name]
    if (alpha === null) {
      out[name] = { light: 'transparent', dark: 'transparent' }
    } else if (alpha !== undefined) {
      out[name] = pair === undefined
        ? { ...NEUTRAL_RELEASE }
        : { light: rgba(pair.light, alpha), dark: rgba(pair.dark, alpha) }
    }
  }
  return out
}

/**
 * Structural element overrides: glass chrome and the shadow character. `default`
 * elevation and the logo rules contribute nothing here — the logo is CSS.
 *
 * @param {typeof DEFAULT_STYLE} style - the chosen style block.
 * @param {{ light: string, dark: string }} accent - the palette's accent pair, for a glow.
 * @returns {Record<string, { light: string, dark: string }>} overrides, or `{}`.
 */
export function elementTokens(style, accent) {
  /** @type {Record<string, { light: string, dark: string }>} */
  const out = {}
  if (style.glass === 'on') {
    // The application's own material for menus is 40px of blur at 150% saturation;
    // matching it keeps a themed surface looking native rather than bolted on.
    out['--dsw-mask-blur'] = { light: '18px', dark: '18px' }
    out['--dsw-menu-backdrop-filter'] = { light: 'blur(40px) saturate(160%)', dark: 'blur(40px) saturate(160%)' }
  } else if (style.glass === 'off') {
    out['--dsw-mask-blur'] = { light: 'none', dark: 'none' }
    out['--dsw-menu-backdrop-filter'] = { light: 'none', dark: 'none' }
  }
  if (style.elevation === 'glow') {
    const light = glowElevation(accent.light)
    const dark = glowElevation(accent.dark)
    for (const name of Object.keys(light)) out[name] = { light: light[name], dark: dark[name] }
  } else if (style.elevation === 'soft' || style.elevation === 'flat') {
    const stack = style.elevation === 'soft' ? ELEVATION_SOFT : ELEVATION_FLAT
    for (const [name, value] of Object.entries(stack)) out[name] = { light: value, dark: value }
  }
  return out
}

/**
 * The logo rules.
 *
 * The mark and the wordmark are real slots: the renderer wraps every outlet as
 * `<div data-slot="…" style="display:contents">`. That anchor is addressable, but it
 * **generates no box** — which is the trap this code has to stay on the right side of:
 *
 *   - `color` is inherited, so tinting reaches the mark *through* the anchor. That rule
 *     worked from the first build, and that is exactly what made the other two look like
 *     a rendering quirk rather than a selector problem.
 *   - `width`, `height` and `background-image` are not inherited and need a box. Set on
 *     the anchor they are silently ignored, so a replacement mark never appears.
 *   - `display` is written **inline** on the anchor, so only `!important` can change it.
 *
 * So the two rules below hide whatever the shell rendered and turn the anchor itself into
 * the 24px box the slot already reserved. The occupant is hidden rather than assumed: the
 * shell may render an svg today and something else tomorrow, and either way the user asked
 * for their own image to take its place.
 *
 * @param {typeof DEFAULT_STYLE} style - the chosen style block.
 * @returns {string} CSS text, or `''` when the logo should stay official.
 */
export function elementCss(style) {
  /** @type {string[]} */
  const rules = []
  if (style.tintLogo) {
    rules.push('[data-slot="sidebar.brand.mark"],[data-slot="sidebar.brand.name"]{color:var(--dsw-alias-brand-primary)}')
  }
  if (style.hideWordmark) {
    rules.push('[data-slot="sidebar.brand.name"]{display:none!important}')
  }
  const logo = sanitizeImageUrl(style.logoImage)
  if (logo !== '') {
    // `display:block!important` is what beats the anchor's inline `display:contents`;
    // without it the declaration below has no box to paint into and nothing shows.
    rules.push(
      `[data-slot="sidebar.brand.mark"]{display:block!important;width:24px;height:24px;flex:0 0 auto;`
      + `background-image:url(${JSON.stringify(logo)});background-size:contain;background-position:center;background-repeat:no-repeat}`,
    )
    rules.push('[data-slot="sidebar.brand.mark"]>*{display:none}')
  }
  return rules.join('')
}

/**
 * Test-only surface. It lives at the end of the file on purpose: a `const` referenced
 * here is in its temporal dead zone until its own declaration is evaluated, so an
 * aggregate like this one has to come after everything it names.
 */
export const __appearanceInternals = {
  RANGE_TOKENS, RELEASE_ALPHA, ELEVATION_SOFT, ELEVATION_FLAT, MAX_IMAGE_URL, BACKDROP, autoVeil, veilPair,
}
