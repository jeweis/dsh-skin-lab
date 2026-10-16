/**
 * Palettes — the colour axis of a theme.
 *
 * A palette is three anchors per palette mode: a **surface** (the page and panel
 * base), an **ink** (text and borders), and an **accent** (brand, buttons, links,
 * selection). Sixty-odd tokens are derived from them, so a palette is six hex
 * values and can never drift structurally from its siblings.
 *
 * Three disciplines make the set read as designed rather than as six recoloured
 * templates:
 *
 *   1. **Surfaces stay close to neutral.** They carry a whisper of the theme's hue
 *      and differ in mood by lightness, not by saturation. Identity lives in the
 *      accent; a saturated surface is what makes a theme look like a colour wash.
 *   2. **Mixing happens in OKLab.** sRGB interpolation makes mid-tones muddy and
 *      accent tints grey; equal perceptual steps keep borders, fades and tints even
 *      across every palette. See `mixOk` in `color.js`.
 *   3. **Button text is chosen by contrast, not by habit.** The fill's relative
 *      luminance is compared against 0.179 — the point where black and white text
 *      have equal contrast — so a light accent gets dark text and a deep one white.
 *
 * `checkJs` compiles this file against the installed DSH declarations, and
 * `verify.mjs` asserts the shape of the result (identical key sets, valid hex, both
 * schemes distinct, every emitted name a real platform token, palette accents
 * spread around the hue wheel).
 */
import { BLACK, WHITE, luminance, mixOk } from './color.js'

/**
 * @typedef {{ surface: string, ink: string, accent: string }} Anchors
 * @typedef {{ light: Anchors, dark: Anchors }} PaletteAnchors
 * @typedef {{ id: string, label: string, tokens: Record<string, { light: string, dark: string }> }} Palette
 */

/**
 * Per-mode shape constants. Both modes raise surfaces toward white — a raised dark
 * surface is lighter, not darker — so only the magnitudes differ. Borders and fades
 * move toward ink.
 */
const SHAPE = {
  light: { layer1: 0.70, layer2: 0.40, layer3: 1, overlay: 1, code: 0.05, border: [0.09, 0.18, 0.28, 0.40], fade: [0.26, 0.42, 0.58, 0.72], tooltip: 0.88 },
  dark: { layer1: 0.06, layer2: 0.11, layer3: 0.16, overlay: 0.09, code: 0.09, border: [0.07, 0.13, 0.20, 0.32], fade: [0.26, 0.40, 0.56, 0.70], tooltip: 0.26 },
}

/** Where black and white text have equal contrast against a fill. */
const CONTRAST_PIVOT = 0.179

/** Text that sits on a filled brand surface, chosen for contrast with that fill. */
const ON_ACCENT = { dark: '#12161a', light: WHITE }

/**
 * Semantic states are shared by every palette: they mean the same thing everywhere,
 * and a palette that repainted "error" would be a bug, not a feature. Secondary and
 * tertiary are the tinted backgrounds a banner uses, so they mix toward the surface.
 *
 * The variant list is per state because the platform's inventory is not uniform —
 * `idle` defines only a primary and `warn` alone adds a label colour. Emitting a
 * name the platform never reads would be dead weight, so this table mirrors the real
 * inventory; `verify.mjs` enforces that every token this plugin emits exists.
 */
const STATES = {
  error: { light: '#c0392b', dark: '#ff6f61', variants: ['primary', 'secondary'] },
  success: { light: '#128a63', dark: '#33cc95', variants: ['primary', 'secondary', 'tertiary'] },
  warn: { light: '#b07d16', dark: '#eaa93f', variants: ['primary', 'secondary', 'tertiary'] },
  idle: { light: '#8aa0ad', dark: '#64808d', variants: ['primary'] },
}

/** How far each state variant is mixed toward the surface. */
/** @type {Record<string, number>} */
const STATE_VARIANT_MIX = { primary: 0, secondary: 0.55, tertiary: 0.78 }

/** The gradient variants the welcome screen ships with. */
const ONBOARDING_VARIANTS = ['blue', 'cyan', 'violet']

/**
 * Derive one palette's full token table.
 * @param {PaletteAnchors} palette - anchors for both palette modes.
 * @returns {Record<string, { light: string, dark: string }>} token name to pair.
 */
function buildTokens(palette) {
  /** @type {Record<string, { light: string, dark: string }>} */
  const out = {}

  for (const mode of /** @type {const} */ (['light', 'dark'])) {
    const { surface, ink, accent } = palette[mode]
    const shape = SHAPE[mode]
    // A hover deepens a light-mode accent and brightens a dark-mode one, so the
    // response reads as "more" in both schemes.
    const hover = mode === 'light' ? BLACK : WHITE
    /** @param {string} token @param {string} value */
    const set = (token, value) => { (out[token] ??= { light: '#000000', dark: '#000000' })[mode] = value }

    // Surfaces.
    set('--dsw-alias-bg-base', surface)
    set('--dsw-alias-bg-layer-1', mixOk(surface, WHITE, shape.layer1))
    set('--dsw-alias-bg-layer-2', mixOk(surface, WHITE, shape.layer2))
    set('--dsw-alias-bg-layer-3', mixOk(surface, WHITE, shape.layer3))
    set('--dsw-alias-bg-overlay', mixOk(surface, WHITE, shape.overlay))
    set('--dsw-alias-bg-skeleton', mixOk(surface, ink, shape.code))
    set('--dsw-alias-settings-card-fill', mixOk(surface, WHITE, shape.layer2))
    set('--dsw-alias-settings-card-stroke', mixOk(surface, ink, shape.border[0]))

    // Borders.
    set('--dsw-alias-border-l1', mixOk(surface, ink, shape.border[0]))
    set('--dsw-alias-border-l2', mixOk(surface, ink, shape.border[1]))
    set('--dsw-alias-border-l3', mixOk(surface, ink, shape.border[2]))
    set('--dsw-alias-border-l4', mixOk(surface, ink, shape.border[3]))

    // Labels. The four fades are one perceptual ladder, so a page using secondary
    // and tertiary text gets an even step rather than an accidental jump.
    set('--dsw-alias-label-primary', ink)
    set('--dsw-alias-label-primary-dimmed', mixOk(ink, surface, shape.fade[0] - 0.06))
    set('--dsw-alias-label-secondary', mixOk(ink, surface, shape.fade[1]))
    set('--dsw-alias-label-tertiary', mixOk(ink, surface, shape.fade[2]))
    set('--dsw-alias-label-dimmed', mixOk(ink, surface, shape.fade[3]))
    set('--dsw-alias-label-primary-foreground', luminance(accent) > CONTRAST_PIVOT ? ON_ACCENT.dark : ON_ACCENT.light)

    // Brand, links, and the filled button that carries them.
    set('--dsw-alias-brand-primary', accent)
    set('--dsw-alias-brand-text', mode === 'light' ? mixOk(accent, BLACK, 0.12) : accent)
    set('--dsw-alias-link', mode === 'light' ? mixOk(accent, BLACK, 0.08) : accent)
    set('--dsw-alias-button-primary-fill', accent)
    set('--dsw-alias-button-primary-hover', mixOk(accent, hover, 0.16))
    set('--dsw-alias-button-primary-dimmed', mixOk(accent, surface, 0.45))

    // Ghost / floating / toolbar buttons and generic interactive states.
    set('--dsw-alias-button-ghost-active-fill', mixOk(surface, accent, 0.14))
    set('--dsw-alias-button-ghost-active-hover', mixOk(surface, accent, 0.20))
    set('--dsw-alias-button-ghost-active-border', mixOk(surface, accent, 0.40))
    set('--dsw-alias-button-floating-fill', mixOk(surface, WHITE, shape.layer1))
    set('--dsw-alias-button-floating-hover', mixOk(surface, WHITE, shape.layer2))
    set('--dsw-alias-button-tool-bar-fill', mixOk(surface, WHITE, shape.layer2))
    set('--dsw-alias-interactive-bg-hover', mixOk(surface, ink, 0.06))
    set('--dsw-alias-interactive-bg-active', mixOk(surface, ink, 0.10))
    set('--dsw-alias-interactive-bg-hover-accent', mixOk(surface, accent, 0.14))

    // Sidebar chrome. The active nav pill leans harder on the accent than a plain
    // hover, because it is the one place a theme can show its own character.
    set('--dsw-specific-sidebar-fill', mixOk(surface, accent, 0.06))
    set('--dsw-specific-sidebar-nav-item-hover', mixOk(surface, accent, 0.12))
    set('--dsw-specific-sidebar-nav-item-active', mixOk(surface, accent, 0.20))
    set('--dsw-specific-sidebar-nav-item-active-accent', accent)

    // Scrollbars, switch, tooltips, inline code.
    set('--dsw-alias-scrollbar-bg-l1', mixOk(surface, ink, 0.14))
    set('--dsw-alias-scrollbar-bg-l2', mixOk(surface, ink, 0.08))
    set('--dsw-alias-scrollbar-hover-l1', mixOk(surface, ink, 0.30))
    set('--dsw-alias-scrollbar-hover-l2', mixOk(surface, ink, 0.20))
    set('--dsw-alias-switch-thumb', mixOk(surface, WHITE, 0.94))
    set('--dsw-alias-tooltip-bg', mixOk(surface, ink, shape.tooltip))
    set('--dsw-alias-tooltip-key-bg', mixOk(mixOk(surface, ink, shape.tooltip), surface, 0.22))
    set('--dsw-alias-toast-bg', mixOk(surface, ink, shape.tooltip))
    set('--dsw-alias-toast-label', luminance(mixOk(surface, ink, shape.tooltip)) > 0.179 ? ON_ACCENT.dark : ON_ACCENT.light)
    set('--dsw-alias-markdown-code-block', mixOk(surface, ink, shape.code))
    set('--dsw-alias-markdown-inline-code', mixOk(surface, ink, shape.code + 0.04))
    set('--dsw-alias-markdown-code-block-banner', mixOk(surface, ink, shape.code + 0.02))

    // The welcome screen's gradient is a real, themable brand surface: three stop
    // lists, one per build variant, each a dark → accent → light ramp around the
    // palette's own accent. (Its neighbour `--dsw-linear-gradient-think` is a fade
    // *mask* — white with alpha — so it is deliberately left alone.)
    const deep = mixOk(accent, BLACK, 0.24)
    const ramp = [`${deep} 20%`, `${accent} 51%`, `${mixOk(accent, WHITE, 0.42)} 85%`, `${deep} 100%`].join(', ')
    for (const variant of ONBOARDING_VARIANTS) set(`--dsw-gradient-onboarding-${variant}-stops`, ramp)

    // States: primary from the shared hue, the tinted variants mixed to the surface.
    for (const [state, entry] of Object.entries(STATES)) {
      for (const variant of entry.variants) {
        set(`--dsw-alias-state-${state}-${variant}`, mixOk(entry[mode], surface, STATE_VARIANT_MIX[variant] ?? 0))
      }
    }
    set('--dsw-alias-state-warn-label', mixOk(STATES.warn[mode], ink, 0.35))
    set('--dsw-alias-state-business-primary', mixOk(accent, ink, 0.18))
    set('--dsw-alias-state-business-tertiary', mixOk(accent, surface, 0.78))
  }

  return out
}

/**
 * The shipped palettes, in row order. Anchors are the only hand-picked values.
 *
 * Read as a set: a deep cool teal, a warm paper with a seal-red accent, a forest
 * green, a night violet, a low warm amber, and an airy ice blue. Lightness alternates
 * so the six cards do not look like one theme in six hues.
 */
export const palettes = [
  {
    id: 'abyss',
    label: '深海 Abyss',
    light: { surface: '#eef2f6', ink: '#0e1a22', accent: '#0f6f8c' },
    dark: { surface: '#0a1116', ink: '#e6eef3', accent: '#4cc9dd' },
  },
  {
    id: 'ink',
    label: '纸墨 Ink',
    light: { surface: '#f5f1e8', ink: '#1b1917', accent: '#9a3f2c' },
    dark: { surface: '#15130f', ink: '#eae4d9', accent: '#e08a70' },
  },
  {
    id: 'pine',
    label: '松林 Pine',
    light: { surface: '#f1f4f0', ink: '#131c17', accent: '#2d6a4a' },
    dark: { surface: '#0c1310', ink: '#e3ece5', accent: '#66c295' },
  },
  {
    id: 'aurora',
    label: '极光 Aurora',
    light: { surface: '#f3f2f8', ink: '#1b1730', accent: '#6a4bd0' },
    dark: { surface: '#0b0a14', ink: '#e9e6f7', accent: '#a78bfa' },
  },
  {
    id: 'ember',
    label: '余烬 Ember',
    light: { surface: '#f7f1ea', ink: '#231a12', accent: '#b45309' },
    dark: { surface: '#14100c', ink: '#f2e6d9', accent: '#f0a35e' },
  },
  {
    id: 'frost',
    label: '霜白 Frost',
    light: { surface: '#f1f5f9', ink: '#101c26', accent: '#2f6f9e' },
    dark: { surface: '#0c1219', ink: '#e7f0f8', accent: '#8ec7f0' },
  },
].map((palette) => ({ id: palette.id, label: palette.label, tokens: buildTokens(palette) }))

/** The palette used when nothing is remembered. */
export const DEFAULT_PALETTE_ID = 'abyss'

/**
 * @param {string} id - requested palette id.
 * @returns {Palette} the palette with this id, falling back to the default, then to the first.
 */
export function paletteById(id) {
  return palettes.find((palette) => palette.id === id)
    ?? palettes.find((palette) => palette.id === DEFAULT_PALETTE_ID)
    ?? palettes[0]
}

/** Test-only surface. */
export const __paletteInternals = { buildTokens, SHAPE, STATES, CONTRAST_PIVOT }
