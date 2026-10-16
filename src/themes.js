/**
 * Built-in themes — the shipped combinations of the three axes.
 *
 * A theme is a starting point, not a mode: the settings page exposes palette and
 * background as independent choices, so a user can take 纸墨's warmth with 极光's
 * artwork and land on a theme that has no name. What this table fixes is the
 * *designed* pairing, the one the artwork and the palette were chosen against.
 *
 * Every theme supplies both colour schemes: a palette carrying a light and a dark
 * token set, and one artwork per scheme. Nothing here records which scheme is in
 * force — that is ambient, and both the paint and the gallery read it from the
 * document — so there is no "designed scheme" and no card that can misrepresent one.
 *
 * A preset deliberately says nothing about the veil. It used to carry a per-theme
 * value (ink 18, ember 34) because the veil was doing the work of adapting one image
 * to the other scheme; with a paired artwork it is pure pre-hazing, and the control
 * belongs to the user. Leaving the field out means every preset takes the neutral 30.
 */
import { DEFAULT_BACKGROUND, DEFAULT_STYLE, parseSettings, serializeSettings } from './appearance.js'
import { DEFAULT_PALETTE_ID } from './palettes.js'

/** Display names for the built-in artwork, keyed by asset. */
/** @type {Record<string, string>} */
export const backgroundLabels = {
  abyss: '深海',
  ink: '纸墨',
  pine: '松林',
  aurora: '极光',
  ember: '余烬',
  frost: '霜白',
  cat: '暖阳',
  hills: '远丘',
  sea: '浅湾',
  bloom: '野花',
  piano: '琴房',
  nebula: '星海',
  reading: '窗前',
  neon: '霓虹',
}

/**
 * @typedef {object} Theme
 * @property {string} id
 * @property {string} label
 * @property {string} paletteId
 * @property {Partial<typeof DEFAULT_BACKGROUND>} background
 * @property {Partial<typeof DEFAULT_STYLE>} style
 */

/**
 * The shipped themes, in row order.
 *
 * Every theme is a **day/night pair of one hand-painted watercolour scene** with a real
 * subject: a whale under a light shaft, ink-wash mountains on paper, a reading girl by a
 * window, a rain-slick neon corner. The first six were originally pure colour fields —
 * smooth gradients with no focal point — and that was a mistake worth recording: with no
 * subject they had nothing to look at, and next to the illustrated set they read as
 * unfinished. They were redrawn as scenes. What survives from that period is the rule that
 * made subjects safe to draw in the first place, stated precisely:
 *
 * **Legibility is decided by the tail of the lightness distribution, not the mean.** In a
 * light interface the binding pixel is the 5th percentile against a near-black label; in a
 * dark one it is the 95th against a near-white label. An accent occupying well under 5% of
 * the frame — a cat's eyes, a moon, a flame, a scatter of stars, a neon tube — cannot move
 * a 5th percentile, while a large high-contrast structure can. So every scene keeps its
 * subject in the lower-right third, leaves the left half and the centre an almost empty
 * wash, and confines its bright or dark accents. That is why a whale, a campfire and a
 * planet limb are all allowed, and why none of the ten needs a scrim.
 *
 * They reuse existing palettes on purpose: palette and background are independent axes,
 * which is the whole shape of this plugin, and six verified palettes already cover the
 * warm, green, teal and paper registers these scenes want.
 */
/** @type {Theme[]} */
export const themes = [
  {
    id: 'abyss',
    label: '深海 Abyss',
    paletteId: 'abyss',
    background: { mode: 'image', asset: 'abyss', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'soft' },
  },
  {
    id: 'ink',
    label: '纸墨 Ink',
    paletteId: 'ink',
    background: { mode: 'image', asset: 'ink', range: 'panel' },
    // Paper does not cast shadows, and its own chrome is already the quiet kind.
    style: { tintLogo: true, glass: 'off', elevation: 'flat' },
  },
  {
    id: 'pine',
    label: '松林 Pine',
    paletteId: 'pine',
    background: { mode: 'image', asset: 'pine', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'soft' },
  },
  {
    id: 'aurora',
    label: '极光 Aurora',
    paletteId: 'aurora',
    background: { mode: 'image', asset: 'aurora', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'glow' },
  },
  {
    id: 'ember',
    label: '余烬 Ember',
    paletteId: 'ember',
    background: { mode: 'image', asset: 'ember', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'glow' },
  },
  {
    id: 'frost',
    label: '霜白 Frost',
    paletteId: 'frost',
    background: { mode: 'image', asset: 'frost', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'soft' },
  },
  {
    id: 'cat',
    label: '暖阳 Sunbeam',
    paletteId: 'ember',
    background: { mode: 'image', asset: 'cat', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'soft' },
  },
  {
    id: 'hills',
    label: '远丘 Hills',
    paletteId: 'pine',
    background: { mode: 'image', asset: 'hills', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'default' },
  },
  {
    id: 'sea',
    label: '浅湾 Lagoon',
    paletteId: 'abyss',
    background: { mode: 'image', asset: 'sea', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'soft' },
  },
  {
    id: 'bloom',
    label: '野花 Meadow',
    paletteId: 'ink',
    // Quiet and paper-like, like 纸墨: the meadow is the texture, so the chrome is not.
    background: { mode: 'image', asset: 'bloom', range: 'panel' },
    style: { tintLogo: true, glass: 'off', elevation: 'flat' },
  },
  {
    id: 'piano',
    label: '琴房 Piano',
    paletteId: 'ink',
    // A lamp-lit room wants warmth, not contrast: soft elevation, and no glass, because
    // there is nothing behind the panels to see.
    background: { mode: 'image', asset: 'piano', range: 'panel' },
    style: { tintLogo: true, glass: 'off', elevation: 'soft' },
  },
  {
    id: 'nebula',
    label: '星海 Nebula',
    paletteId: 'aurora',
    // The one theme whose subject is light itself, so it takes the glow elevation.
    background: { mode: 'image', asset: 'nebula', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'glow' },
  },
  {
    id: 'reading',
    label: '窗前 Reading',
    paletteId: 'pine',
    background: { mode: 'image', asset: 'reading', range: 'panel' },
    style: { tintLogo: true, glass: 'off', elevation: 'soft' },
  },
  {
    id: 'neon',
    label: '霓虹 Neon',
    paletteId: 'abyss',
    // Painted light on a wet street: the glow elevation is the point. The range stays
    // `panel` like every other preset — a wider one is a taste the user can reach for.
    background: { mode: 'image', asset: 'neon', range: 'panel' },
    style: { tintLogo: true, glass: 'on', elevation: 'glow' },
  },
]

/** The theme used when nothing is remembered. */
export const DEFAULT_THEME_ID = 'abyss'

/**
 * @param {string} id - requested theme id.
 * @returns {Theme} the theme with this id, falling back to the default theme.
 */
export function themeById(id) {
  return themes.find((theme) => theme.id === id)
    ?? themes.find((theme) => theme.id === DEFAULT_THEME_ID)
    ?? themes[0]
}

/**
 * The full settings document a theme stands for. Merged over the field defaults and
 * then round-tripped through the parser, so a preset can never introduce a value the
 * rest of the plugin would reject.
 *
 * @param {Theme} theme - the theme to apply.
 * @returns {ReturnType<typeof parseSettings>} a valid settings document.
 */
export function themeSettings(theme) {
  return parseSettings(serializeSettings({
    paletteId: theme.paletteId,
    background: { ...DEFAULT_BACKGROUND, ...theme.background },
    style: { ...DEFAULT_STYLE, ...theme.style },
  }))
}

/** The settings a first run starts from: the default theme, untouched. */
export function defaultSettings() {
  return themeSettings(themeById(DEFAULT_THEME_ID))
}

/**
 * Which built-in theme, if any, a settings document matches. Used to light up the
 * gallery card; an edited combination simply matches nothing.
 *
 * @param {ReturnType<typeof parseSettings>} settings - the live settings.
 * @returns {string} a theme id, or `''`.
 */
export function matchTheme(settings) {
  const serialized = serializeSettings(settings)
  return themes.find((theme) => serializeSettings(themeSettings(theme)) === serialized)?.id ?? ''
}
