/**
 * Artifact verification: does `lib/client.js` behave the way `src/` says, under
 * the loader, theme and slot contracts the shell implements?
 *
 * No DSH boot and no browser. Four layers:
 *
 *   1. **Pure logic** — colour maths, pointer geometry, the background model and
 *      the token derivation, imported straight from `src/`.
 *   2. **Platform inventory** — every token name this plugin can emit is checked
 *      against the token names the installed rc.2 theme actually defines. A typo
 *      such as `--dsw-alias-bg-layer-4` would otherwise be accepted silently and
 *      simply never apply.
 *   3. **Artifact** — the loader contract: `factory(require)` returns the plugin,
 *      the only module it requests is the baseline `react`, the file is ASCII.
 *   4. **Behaviour** — `apply(ctx)` against a recording context, then the
 *      registered page rendered and driven through its own handlers: theme cards,
 *      palette buttons, background mode tabs, the picker's pointer drags, a file
 *      upload, the URL field, the element toggles and the restore button.
 *
 * The theme stub models rc.2's `overrideTokens` faithfully, including the rule that
 * makes layer ownership subtle: the returned disposer is a **no-op once the same
 * source has re-overridden**. A harness that always retracted would pass a plugin
 * whose skin survives uninstall — the defect `negative/drop-teardown-retraction.mjs`
 * guards against.
 *
 * Usage: node verify.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  clamp, contrastRatio, hexToHsv, hexToRgb, hsvToHex, hueFromPoint, luminance, mix, mixOk, normalizeHex,
  rgbToHex, rgba, saturationValueFromPoint,
} from './src/color.js'
import { DEFAULT_PALETTE_ID, paletteById, palettes } from './src/palettes.js'
import {
  BACKGROUND_MODES,
  DEFAULT_BACKGROUND,
  DEFAULT_SETTINGS,
  DEFAULT_STYLE,
  ELEVATIONS,
  GLASS_MODES,
  IMAGE_SIZES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_URL,
  MAX_UPLOAD_BYTES,
  SCHEMES,
  SHRINK_TARGET,
  TRANSPARENCY_RANGES,
  backgroundCss,
  backgroundSource,
  elementCss,
  elementTokens,
  isPainted,
  parseBackground,
  parseSettings,
  parseStyle,
  sanitizeAssetKey,
  sanitizeImageUrl,
  serializeSettings,
  transparencyTokens,
  __appearanceInternals,
} from './src/appearance.js'
import { backgroundLabels, defaultSettings, matchTheme, themeSettings, themes } from './src/themes.js'
import {
  BACKGROUND_MAX_EDGE,
  LOGO_MAX_EDGE,
  SHRINK_STEPS,
  dataUrlBytes,
  needsShrink,
  planSteps,
} from './src/shrink.js'
import { embeddedBackgroundLightness, embeddedBackgrounds } from './src/assets.js'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Overridable so negative/drop-teardown-retraction.mjs can point the same suite at
// a deliberately broken copy and prove the uninstall assertions have teeth.
const artifact = process.env.DSH_SKIN_LAB_ARTIFACT ?? join(root, 'lib', 'client.js')
const text = readFileSync(artifact, 'utf8')

const STORAGE_KEY = 'dsh-skin-lab.settings'
const LEGACY_STORAGE_KEY = 'dsh-skin-lab.skin'
const SOURCE = 'dsh-skin-lab'

const failures = []
const check = (label, ok, detail) => {
  if (ok) console.log(`  PASS  ${label}`)
  else { console.log(`  FAIL  ${label}${detail === undefined ? '' : ` \u2014 ${detail}`}`); failures.push(label) }
}
const info = (message) => console.log(`  INFO  ${message}`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ACCENT = { light: '#0f6f8c', dark: '#4cc9dd' }

/** Depth-first search for every element whose className matches exactly. */
function findAll(node, className, out = []) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return out
  if (node.props?.className === className) out.push(node)
  for (const child of node.children ?? []) findAll(child, className, out)
  return out
}

/** The rendered control inside the labelled field or setting row that reads as given. */
function controlIn(tree, label, className) {
  const holder = [...findAll(tree, 'dsh-theme-field'), ...findAll(tree, 'dsh-theme-setting')].find((node) => {
    const caption = findAll(node, 'dsh-theme-field-label')[0]
    return caption?.children?.[0] === label
  })
  return holder === undefined ? undefined : findAll(holder, className)[0]
}

// --- the installed rc.2 token inventory ---------------------------------------

/**
 * Token names read out of the installed `dsh-client-ui-theme` bundle. Only the set
 * this plugin touches is listed, which is exactly the point: it is the authority
 * for step 2 below.
 */
const RC2_TOKENS = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay', '--dsw-alias-bg-skeleton',
  '--dsw-alias-settings-card-fill', '--dsw-alias-settings-card-stroke',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
  '--dsw-alias-label-primary', '--dsw-alias-label-primary-dimmed', '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-dimmed',
  '--dsw-alias-brand-primary', '--dsw-alias-brand-text', '--dsw-alias-link',
  '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover', '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-ghost-active-fill', '--dsw-alias-button-ghost-active-hover', '--dsw-alias-button-ghost-active-border',
  '--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover', '--dsw-alias-button-tool-bar-fill',
  '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active', '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-specific-sidebar-fill', '--dsw-specific-sidebar-nav-item-hover',
  '--dsw-specific-sidebar-nav-item-active', '--dsw-specific-sidebar-nav-item-active-accent',
  '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l1', '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-switch-thumb', '--dsw-alias-tooltip-bg', '--dsw-alias-tooltip-key-bg',
  '--dsw-alias-toast-bg', '--dsw-alias-toast-label',
  '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-inline-code', '--dsw-alias-markdown-code-block-banner',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-error-secondary',
  '--dsw-alias-state-success-primary', '--dsw-alias-state-success-secondary', '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-primary', '--dsw-alias-state-warn-secondary', '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-state-warn-label', '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary',
  '--dsw-shadow-lv1', '--dsw-shadow-lv1-blur', '--dsw-shadow-lv2', '--dsw-shadow-lv3',
  '--dsw-elevation-stroke-color', '--dsw-elevation-soft', '--dsw-elevation-panel', '--dsw-elevation-prominent',
  '--dsw-mask-blur', '--dsw-menu-backdrop-filter',
  '--dsw-gradient-onboarding-blue-stops', '--dsw-gradient-onboarding-cyan-stops',
  '--dsw-gradient-onboarding-violet-stops',
])

// --- pure logic: colour maths and pointer geometry ----------------------------

check('hex parsing canonicalizes 3-digit shorthand', normalizeHex('#abc') === '#aabbcc' && normalizeHex('ABC') === '#aabbcc')
check('hex parsing rejects anything that is not a 3/6-digit hex colour',
  normalizeHex('xyz') === null && normalizeHex('#12345') === null && normalizeHex('#1234567') === null && normalizeHex(12) === null)
check('hex and rgb agree at the corners',
  same(hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 }) && rgbToHex({ r: 0, g: 0, b: 0 }) === '#000000')
check('rgb clamps out-of-range channels', rgbToHex({ r: -20, g: 300, b: 128 }) === '#00ff80')

const roundTrip = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#0d7490', '#f06292', '#e2f0f5']
check('HSV round-trips every anchor exactly', roundTrip.every((hex) => hsvToHex(hexToHsv(hex)) === hex),
  roundTrip.filter((hex) => hsvToHex(hexToHsv(hex)) !== hex).join(', '))
check('primaries land on their HSV poles',
  same(hexToHsv('#ff0000'), { h: 0, s: 1, v: 1 }) && hsvToHex({ h: 120, s: 1, v: 1 }) === '#00ff00')
check('hue wraps instead of going negative or out of range',
  hsvToHex({ h: 360, s: 1, v: 1 }) === '#ff0000' && hsvToHex({ h: -120, s: 1, v: 1 }) === '#0000ff')
check('rgba() renders an alpha value', rgba('#000000', 0.5) === 'rgba(0, 0, 0, 0.5)' && rgba('#ffffff', 2) === 'rgba(255, 255, 255, 1)')
check('mix() interpolates and rounds', mix('#000000', '#ffffff', 0.5) === '#808080' && mix('#0d7490', '#2fc6d8', 0) === '#0d7490')
check('clamp() bounds both ends', clamp(-5, 0, 1) === 0 && clamp(5, 0, 1) === 1 && clamp(0.5, 0, 1) === 0.5)
check('luminance() spans 0 to 1', luminance('#000000') === 0 && luminance('#ffffff') === 1)
check('contrastRatio() spans 1 to 21', contrastRatio('#000000', '#000000') === 1
  && Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01)

check('mixing is perceptual, not a straight line through gamma-encoded bytes', (() => {
  const sRGB = mix('#000000', '#ffffff', 0.5)
  const perceptual = mixOk('#000000', '#ffffff', 0.5)
  // sRGB halves the *bytes*, which lands far too light; OKLab halves the perceived
  // lightness, which is what equal steps require.
  return sRGB === '#808080' && perceptual !== sRGB && Math.abs(luminance(perceptual) - 0.125) < 0.01
})())
check('perceptual mixing preserves its endpoints exactly',
  mixOk('#123456', '#abcdef', 0) === '#123456' && mixOk('#123456', '#abcdef', 1) === '#abcdef'
  && mixOk('#123456', '#abcdef', -1) === '#123456' && mixOk('#123456', '#abcdef', 9) === '#abcdef')
check('perceptual mixing is stable when both ends agree', mixOk('#2f6f9e', '#2f6f9e', 0.4) === '#2f6f9e')

const square = { left: 10, top: 20, width: 100, height: 50 }
check('the SV square maps its corners (top-right is full saturation and value)',
  same(saturationValueFromPoint(square, 110, 20), { s: 1, v: 1 })
  && same(saturationValueFromPoint(square, 10, 70), { s: 0, v: 0 }))
check('the SV square clamps a pointer dragged outside it',
  same(saturationValueFromPoint(square, -500, 900), { s: 0, v: 0 })
  && same(saturationValueFromPoint(square, 500, -500), { s: 1, v: 1 }))
check('a zero-size box yields a defined point instead of NaN',
  same(saturationValueFromPoint({ left: 0, top: 0, width: 0, height: 0 }, 5, 5), { s: 0, v: 0 }))
check('the hue strip maps 0..360 across its width',
  hueFromPoint({ left: 0, width: 360 }, 90) === 90 && hueFromPoint({ left: 0, width: 360 }, 1000) === 360)

// --- pure logic: palettes -----------------------------------------------------

const tokenNames = Object.keys(palettes[0].tokens)
check('every palette declares the identical token set', palettes.every((palette) => same(Object.keys(palette.tokens), tokenNames)))
check('the token set is substantial (surfaces, buttons, links, chrome)', tokenNames.length >= 45, `${String(tokenNames.length)} tokens`)
const plainTokens = tokenNames.filter((name) => !name.startsWith('--dsw-gradient-onboarding'))
check('every plain token value is a 6-digit hex pair', palettes.every((palette) => plainTokens.every((name) => (
  /^#[0-9a-f]{6}$/.test(palette.tokens[name].light) && /^#[0-9a-f]{6}$/.test(palette.tokens[name].dark)
))))
check('the welcome-screen gradient is a four-stop ramp around the palette accent',
  palettes.every((palette) => ['blue', 'cyan', 'violet'].every((variant) => {
    const stops = palette.tokens[`--dsw-gradient-onboarding-${variant}-stops`].dark.split(', ')
    return stops.length === 4 && stops[0].endsWith(' 20%') && stops[2].endsWith(' 85%') && stops[3].endsWith(' 100%')
      && stops[1] === `${palette.tokens['--dsw-alias-brand-primary'].dark} 51%`
  })))
check('no palette uses one value for both schemes on the base surface', palettes.every((palette) => (
  palette.tokens['--dsw-alias-bg-base'].light !== palette.tokens['--dsw-alias-bg-base'].dark
)))
check('the label ladder is monotonically less legible against the page', palettes.every((palette) => (
  ['light', 'dark'].every((mode) => {
    // Direction flips between schemes — a light surface fades text *lighter*, a dark
    // one fades it darker — so the mode-independent property is that contrast against
    // the page base falls at every step.
    const base = palette.tokens['--dsw-alias-bg-base'][mode]
    const ladder = [
      '--dsw-alias-label-primary',
      '--dsw-alias-label-primary-dimmed',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
      '--dsw-alias-label-dimmed',
    ].map((name) => contrastRatio(palette.tokens[name][mode], base))
    return ladder.every((value, index) => index === 0 || value < ladder[index - 1])
  })
)))
check('the accent anchor drives brand, link and the filled button', palettes.every((palette) => {
  const brand = palette.tokens['--dsw-alias-brand-primary']
  const link = palette.tokens['--dsw-alias-link']
  return palette.tokens['--dsw-alias-button-primary-fill'].light === brand.light
    && palette.tokens['--dsw-alias-button-primary-fill'].dark === brand.dark
    // A raw accent is often too light for text on a light surface, so link and
    // brand text are deepened there and left alone in dark mode.
    && link.dark === brand.dark && luminance(link.light) < luminance(brand.light)
}))
check('text on a filled brand surface clears WCAG AA against every accent', palettes.every((palette) => (
  ['light', 'dark'].every((mode) => contrastRatio(
    palette.tokens['--dsw-alias-label-primary-foreground'][mode],
    palette.tokens['--dsw-alias-button-primary-fill'][mode],
  ) >= 4.5)
)), palettes.map((palette) => {
  const pair = (mode) => contrastRatio(
    palette.tokens['--dsw-alias-label-primary-foreground'][mode],
    palette.tokens['--dsw-alias-button-primary-fill'][mode],
  ).toFixed(2)
  return `${palette.id}:${pair('light')}/${pair('dark')}`
}).join(' '))
check('a missing palette id falls back to the default', paletteById('nope').id === DEFAULT_PALETTE_ID)
check('the palette list has unique ids', new Set(palettes.map((palette) => palette.id)).size === palettes.length)

const emitted = new Set(tokenNames)
{
  const styles = [
    { glass: 'on', elevation: 'default' }, { glass: 'off', elevation: 'default' },
    { glass: 'default', elevation: 'flat' }, { glass: 'default', elevation: 'soft' },
    { glass: 'default', elevation: 'glow' },
  ]
  for (const style of styles) {
    for (const name of Object.keys(elementTokens({ ...DEFAULT_STYLE, ...style }, ACCENT))) emitted.add(name)
  }
  for (const range of TRANSPARENCY_RANGES) {
    for (const name of Object.keys(transparencyTokens({ ...DEFAULT_BACKGROUND, mode: 'color', range }, palettes[0].tokens))) emitted.add(name)
  }
}
const invented = [...emitted].filter((name) => !RC2_TOKENS.has(name))
check('every token name this plugin can emit exists in the installed rc.2 theme',
  invented.length === 0, invented.join(', '))
info(`${String(invented.length)} invented names; ${String(emitted.size)} distinct tokens emitted across every palette, range and style`)

// --- pure logic: the background model -----------------------------------------

check('image URLs with an unlisted scheme are refused',
  sanitizeImageUrl('') === '' && sanitizeImageUrl('javascript:alert(1)') === ''
  && sanitizeImageUrl('data:text/html;base64,PHNjcmlwdD4=') === '')
check('image URLs that could break out of url("…") are refused',
  sanitizeImageUrl('https://x/a.png"') === '' && sanitizeImageUrl("https://x/a.png'") === ''
  && sanitizeImageUrl('https://x/a\\b.png') === '' && sanitizeImageUrl('https://x/a\nb.png') === '')
check('image URLs beyond the storage budget are refused',
  sanitizeImageUrl(`data:image/png;base64,${'A'.repeat(3_000_001)}`) === '')
check('legitimate image URLs survive',
  sanitizeImageUrl('data:image/png;base64,AAA') === 'data:image/png;base64,AAA'
  && sanitizeImageUrl('https://example.com/a.png') === 'https://example.com/a.png'
  && sanitizeImageUrl('blob:http://localhost/x') === 'blob:http://localhost/x')
check('an unknown built-in background key is refused', sanitizeAssetKey('abyss') === 'abyss' && sanitizeAssetKey('nope') === '')

check('an unreadable stored payload yields the defaults',
  same(parseBackground(''), DEFAULT_BACKGROUND) && same(parseBackground('{'), DEFAULT_BACKGROUND)
  && same(parseBackground('null'), DEFAULT_BACKGROUND))
check('one bad field costs only that field',
  parseBackground({ mode: 'nope' }).mode === DEFAULT_BACKGROUND.mode
  && parseBackground({ color: '#GGG' }).color === DEFAULT_BACKGROUND.color
  && parseBackground({ scrim: 999 }).veil === DEFAULT_BACKGROUND.veil
  && parseBackground({ angle: -40 }).angle === 0
  && parseBackground({ veil: 900 }).veil === 85)
check('a bad style field costs only that field',
  parseStyle('nope').glass === DEFAULT_STYLE.glass
  && parseStyle({ glass: true }).glass === DEFAULT_STYLE.glass
  && parseStyle({ elevation: 'bogus' }).elevation === DEFAULT_STYLE.elevation
  // A value that used to be valid but has since been renamed must fall back rather
  // than reach `elementTokens` as an unknown key.
  && parseStyle({ elevation: 'sharp' }).elevation === DEFAULT_STYLE.elevation
  && parseStyle({ tintLogo: 'yes' }).tintLogo === DEFAULT_STYLE.tintLogo)
check('an unreadable document yields the field defaults, not a theme',
  same(parseSettings(''), DEFAULT_SETTINGS) && same(parseSettings('[]'), DEFAULT_SETTINGS))
check('the default theme is the designed pairing of all three axes',
  same(parseSettings(serializeSettings(defaultSettings())), themeSettings(themes[0])))

check('the default background leaves the theme alone until the user chooses',
  DEFAULT_BACKGROUND.mode === 'theme' && isPainted(DEFAULT_BACKGROUND) === false)
check('a flat colour and a gradient count as painted, an empty image does not',
  isPainted({ ...DEFAULT_BACKGROUND, mode: 'color' }) === true
  && isPainted({ ...DEFAULT_BACKGROUND, mode: 'gradient' }) === true
  && isPainted({ ...DEFAULT_BACKGROUND, mode: 'image' }) === false)
check('a built-in key resolves to the artwork drawn for that scheme',
  backgroundSource({ ...DEFAULT_BACKGROUND, mode: 'image', asset: 'abyss' }, 'light').startsWith('data:image/jpeg;base64,')
  && backgroundSource({ ...DEFAULT_BACKGROUND, mode: 'image', asset: 'abyss' }, 'light')
    !== backgroundSource({ ...DEFAULT_BACKGROUND, mode: 'image', asset: 'abyss' }, 'dark'))
check("a user's own source wins over the built-in key",
  backgroundSource({ ...DEFAULT_BACKGROUND, mode: 'image', asset: 'abyss', url: 'https://x/y.png' }, 'dark') === 'https://x/y.png')
check('an unrecognised scheme resolves like light instead of failing open',
  backgroundSource({ ...DEFAULT_BACKGROUND, mode: 'image', asset: 'abyss' }, 'sepia')
  === backgroundSource({ ...DEFAULT_BACKGROUND, mode: 'image', asset: 'abyss' }, 'light'))

check('the theme mode paints nothing', backgroundCss(DEFAULT_BACKGROUND, 'light') === '')
check('a colour background paints the canvas and clears the body', (() => {
  const css = backgroundCss({ ...DEFAULT_BACKGROUND, mode: 'color', color: '#101722' }, 'light')
  return css.includes('background-color:#101722') && css.includes('background-image:none')
    && css.includes('body{background-color:transparent}')
})())
check('a gradient becomes a linear-gradient at the chosen angle',
  backgroundCss({ ...DEFAULT_BACKGROUND, mode: 'gradient', angle: 135 }, 'light').includes('linear-gradient(135deg, #101722, #22303f)'))

/**
 * The scrim alpha the paint will apply in `scheme`, read back out of the CSS it wrote.
 * @param {string} css - stylesheet text.
 * @param {'light' | 'dark'} scheme - which member of the `light-dark()` pair applies.
 * @returns {number} the alpha in force, zero when no scrim is painted.
 */
function scrimAlpha(css, scheme) {
  const pair = /light-dark\(rgba\(255, 255, 255, ([\d.]+)\), rgba\(0, 0, 0, ([\d.]+)\)\)/.exec(css)
  if (pair !== null) return Number(scheme === 'light' ? pair[1] : pair[2])
  // No `light-dark()` pair means the only declaration emitted was the plain dark one.
  const plain = /background-image:linear-gradient\(rgba\(0, 0, 0, ([\d.]+)\)/.exec(css)
  return plain === null ? 0 : Number(plain[1])
}

check('every built-in theme paints its own artwork unscrimmed in BOTH schemes', (() => {
  // The assertion behind the whole pairing. Before it, one image per theme had to be
  // scrimmed into the scheme it was not drawn for, and all four dark themes collapsed
  // into the same pale wash under a light interface — a theme identity that survives
  // only in its palette is not the theme that was designed.
  const offenders = []
  for (const theme of themes) {
    const background = { ...DEFAULT_BACKGROUND, ...theme.background }
    for (const scheme of SCHEMES) {
      const alpha = scrimAlpha(backgroundCss(background, scheme), scheme)
      if (alpha !== 0) offenders.push(`${theme.id}/${scheme}=${String(alpha)}`)
    }
  }
  return offenders.length === 0
})())
check('a user image of unknown lightness is still scrimmed in both schemes, plainly first', (() => {
  const css = backgroundCss(
    { ...DEFAULT_BACKGROUND, mode: 'image', url: 'https://example.test/a.png', asset: '', veil: 30 }, 'light',
  )
  const pair = /light-dark\(rgba\(255, 255, 255, ([\d.]+)\), rgba\(0, 0, 0, ([\d.]+)\)\)/.exec(css)
  const plain = /background-image:linear-gradient\(rgba\(0, 0, 0, ([\d.]+)\)/.exec(css)
  return pair !== null && Number(pair[1]) > 0.5 && Number(pair[2]) > 0.5
    && plain !== null && Number(plain[1]) > 0.5
    && css.includes('url("https://example.test/a.png")')
    && css.indexOf(plain[0]) < css.indexOf('light-dark(')
})())
check('the veil control slides the automatic scrim within safe bounds', (() => {
  const at = __appearanceInternals.autoVeil(embeddedBackgroundLightness.abyss.dark.mean)
  const bias = (veil) => (veil - 30) * 0.006
  // A user cannot dial the mismatch away: the automatic part stays in force.
  return at.light + bias(0) > 0.5 && at.light === 0.72 && at.dark === 0 && bias(30) === 0
})())
check('tiling repeats at natural size instead of stretching',
  backgroundCss({ ...DEFAULT_BACKGROUND, mode: 'image', asset: 'abyss', size: 'tile' }, 'dark')
    .includes('background-size:auto;background-position:center;background-repeat:repeat'))
check('contain letterboxes rather than crops',
  backgroundCss({ ...DEFAULT_BACKGROUND, mode: 'image', asset: 'abyss', size: 'contain' }, 'dark').includes('background-size:contain'))

// --- auto-compression --------------------------------------------------------

check('a data URL is measured in bytes, not in characters', (() => {
  // base64 spends four characters on every three bytes, which is the gap that lets an
  // upload look small and still be over the cap.
  return dataUrlBytes('data:image/png;base64,QUJD') === 3
    && dataUrlBytes('data:image/png,abc') === 3
    && dataUrlBytes('not a data url') === 0
})())
check('the shrink target leaves real margin under the hard cap', SHRINK_TARGET < MAX_IMAGE_URL)
check('the upload ceiling sits well above the shrink trigger', MAX_UPLOAD_BYTES > MAX_IMAGE_BYTES * 5)
check('a file that fits is never re-encoded, and one that does not is', (() => {
  return needsShrink(200_000, 270_000, SHRINK_TARGET) === false
    && needsShrink(9_000_000, 270_000, SHRINK_TARGET) === true
    && needsShrink(200_000, SHRINK_TARGET + 1, SHRINK_TARGET) === true
})())
check('the ladder starts at the cap, never upscales, and strictly descends', (() => {
  const steps = planSteps(6000, 4000, BACKGROUND_MAX_EDGE)
  const longest = steps.map((step) => Math.max(step.width, step.height))
  return steps.length === SHRINK_STEPS.length
    && longest[0] === BACKGROUND_MAX_EDGE
    && longest.every((edge, index) => edge <= BACKGROUND_MAX_EDGE && (index === 0 || edge < longest[index - 1]))
    && steps.every((step, index) => index === 0 || step.quality < steps[index - 1].quality)
})())
check('a source already inside the cap gets one attempt, at its own size', (() => {
  // Every scale would round to the same pixels, so the repeats collapse instead of
  // re-encoding the identical image at a lower quality seven times.
  const steps = planSteps(320, 200, BACKGROUND_MAX_EDGE)
  return steps.length === 1 && steps[0].width === 320 && steps[0].height === 200
    && steps[0].quality === SHRINK_STEPS[0].quality
})())
check('a logo is compressed to a mark, not to a wallpaper',
  Math.max(planSteps(4000, 3000, LOGO_MAX_EDGE)[0].width, planSteps(4000, 3000, LOGO_MAX_EDGE)[0].height) === LOGO_MAX_EDGE)
check('a degenerate source produces no plan rather than a broken one',
  same(planSteps(0, 0, BACKGROUND_MAX_EDGE), []) && same(planSteps(Number.NaN, 10, 100), []))

check('the theme mode releases no tokens', same(transparencyTokens(DEFAULT_BACKGROUND, palettes[0].tokens), {}))
check('the base range releases only the base surface',
  same(Object.keys(transparencyTokens({ ...DEFAULT_BACKGROUND, mode: 'color', range: 'base' }, palettes[0].tokens)), ['--dsw-alias-bg-base']))
check('the panel range releases four surfaces and the glass range eight',
  Object.keys(transparencyTokens({ ...DEFAULT_BACKGROUND, mode: 'color', range: 'panel' }, palettes[0].tokens)).length === 4
  && Object.keys(transparencyTokens({ ...DEFAULT_BACKGROUND, mode: 'color', range: 'glass' }, palettes[0].tokens)).length === 8)
check('the base surface goes fully transparent so the paint shows through',
  transparencyTokens({ ...DEFAULT_BACKGROUND, mode: 'color' }, palettes[0].tokens)['--dsw-alias-bg-base'].light === 'transparent')
check('a released surface keeps its palette hue instead of turning grey', (() => {
  const released = transparencyTokens({ ...DEFAULT_BACKGROUND, mode: 'color' }, palettes[0].tokens)['--dsw-alias-bg-layer-1']
  const pair = palettes[0].tokens['--dsw-alias-bg-layer-1']
  return released.light === rgba(pair.light, 0.78) && released.dark === rgba(pair.dark, 0.78)
})())
check('with the official palette a released surface falls back to neutral chrome', (() => {
  const released = transparencyTokens({ ...DEFAULT_BACKGROUND, mode: 'color' }, {})['--dsw-specific-sidebar-fill']
  return typeof released.light === 'string' && released.light.startsWith('rgba(')
})())
check('every released token is a { light, dark } string pair',
  Object.entries(transparencyTokens({ ...DEFAULT_BACKGROUND, mode: 'color', range: 'glass' }, palettes[0].tokens))
    .every(([name, pair]) => name.startsWith('--dsw-') && typeof pair.light === 'string' && typeof pair.dark === 'string'))

check('glass at "on" blurs, at "off" removes it, at "default" says nothing',
  elementTokens({ ...DEFAULT_STYLE, glass: 'on' }, ACCENT)['--dsw-mask-blur'].light === '18px'
  && elementTokens({ ...DEFAULT_STYLE, glass: 'off' }, ACCENT)['--dsw-mask-blur'].light === 'none'
  && elementTokens({ ...DEFAULT_STYLE, glass: 'default' }, ACCENT)['--dsw-mask-blur'] === undefined)
check('the default elevation and glass contribute no overrides at all',
  same(elementTokens(DEFAULT_STYLE, ACCENT), {}))
check('a glow elevation draws both its ring and its halo from the accent', (() => {
  const glow = elementTokens({ ...DEFAULT_STYLE, elevation: 'glow' }, ACCENT)
  return glow['--dsw-elevation-stroke-color'].light === rgba(ACCENT.light, 0.30)
    && glow['--dsw-elevation-soft'].light.includes(rgba(ACCENT.light, 0.22))
    && glow['--dsw-elevation-soft'].dark.includes(rgba(ACCENT.dark, 0.22))
})())
check('a flat elevation keeps the hairline ring and drops every falloff', (() => {
  const flat = elementTokens({ ...DEFAULT_STYLE, elevation: 'flat' }, ACCENT)
  return flat['--dsw-elevation-soft'].light === '0 0 0 1px var(--dsw-elevation-stroke-color)'
    && flat['--dsw-shadow-lv1'].light === 'none' && flat['--dsw-shadow-lv3'].light === 'none'
})())
check('a soft elevation keeps the platform ring and only re-tunes the falloff', (() => {
  const soft = elementTokens({ ...DEFAULT_STYLE, elevation: 'soft' }, ACCENT)
  return Object.keys(soft).every((name) => name.startsWith('--dsw-elevation') || name.startsWith('--dsw-shadow'))
    && soft['--dsw-elevation-panel'].light.startsWith('var(--dsw-elevation-stroke),')
    && soft['--dsw-elevation-prominent'].light.startsWith('var(--dsw-elevation-stroke),')
})())
check('elevation "default" contributes nothing', same(elementTokens({ ...DEFAULT_STYLE, elevation: 'default' }, ACCENT), {}))

check('the logo rules are absent until the user asks for them', elementCss(DEFAULT_STYLE) === '')
check('tinting addresses the brand slots and lets them inherit the accent', (() => {
  const css = elementCss({ ...DEFAULT_STYLE, tintLogo: true })
  return css.includes('[data-slot="sidebar.brand.mark"]') && css.includes('[data-slot="sidebar.brand.name"]')
    && css.includes('color:var(--dsw-alias-brand-primary)')
})())
check('hiding the wordmark keeps the mark, and beats the anchor\'s inline display', (() => {
  const css = elementCss({ ...DEFAULT_STYLE, hideWordmark: true })
  return css.includes('[data-slot="sidebar.brand.name"]{display:none!important}') && !css.includes('brand.mark')
})())
check('a custom logo overrides the anchor\'s display and hides whatever occupies it', (() => {
  const css = elementCss({ ...DEFAULT_STYLE, logoImage: 'data:image/png;base64,AAA' })
  return css.includes('[data-slot="sidebar.brand.mark"]{display:block!important;width:24px;height:24px')
    && css.includes('url("data:image/png;base64,AAA")')
    && css.includes('[data-slot="sidebar.brand.mark"]>*{display:none}')
})())
check('the logo rule does not name the occupant, so a different one still gives way', (() => {
  // The first version hid `svg` by name. It happened to work, and it is still the wrong
  // shape: the shell decides what fills the slot, and this rule must not depend on that.
  const css = elementCss({ ...DEFAULT_STYLE, logoImage: 'data:image/png;base64,AAA' })
  return !/brand\.mark"\]\s*svg/.test(css)
})())
check('an unsafe custom logo is refused by the same sanitizer',
  elementCss({ ...DEFAULT_STYLE, logoImage: 'javascript:alert(1)' }) === '')

// --- the platform facts the logo rules depend on --------------------------------

/**
 * The installed client bundle for a `@deepseek-ai` package, when this shell can see it.
 *
 * The logo rules are only correct *relative to the shell*: they assume an outlet is wrapped
 * in a `data-slot` element pinned to `display: contents`, and that the two brand slot keys
 * exist. Both are facts about code rather than documentation, and getting either wrong is
 * silent. The first version of this rule got one wrong — it hid the official mark correctly
 * and painted nothing at all, because an element with `display: contents` generates no box
 * and cannot carry a background. Reading the platform back is what turns the next such
 * change into a failure here instead of a surprise on the user's screen.
 *
 * @param {string} name - the `@deepseek-ai` package name.
 * @returns {string} the bundle source, or `''` when it is not installed here.
 */
function platformBundle(name) {
  const home = process.env.DSH_HOME
  if (home === undefined || home === '') return ''
  const candidate = join(home, 'profiles', 'node_modules', '@deepseek-ai', name, 'lib', 'client.js')
  return existsSync(candidate) ? readFileSync(candidate, 'utf8') : ''
}

const rendererBundle = platformBundle('dsh-client-ui-renderer')
const sidebarBundle = platformBundle('dsh-client-ui-sidebar')
if (rendererBundle === '' || sidebarBundle === '') {
  info('platform probe skipped: the installed client bundles are not readable from this shell')
} else {
  check('platform: an outlet anchor is a data-slot element pinned to display:contents',
    rendererBundle.includes('display: "contents"') && rendererBundle.includes('"data-slot": slotKey'))
  check('platform: a box-less anchor is exactly why the logo rule must override display', (() => {
    // Deliberately asserted together. If the shell ever stops anchoring outlets with
    // `display: contents`, this fails so the `!important` can be retired on purpose —
    // rather than quietly outliving the reason it was added.
    return rendererBundle.includes('display: "contents"')
      && elementCss({ ...DEFAULT_STYLE, logoImage: 'data:image/png;base64,AAA' }).includes('display:block!important')
  })())
  check('platform: the two brand slot keys this plugin addresses still exist',
    sidebarBundle.includes('"sidebar.brand.mark"') && sidebarBundle.includes('"sidebar.brand.name"'))
}

// --- pure logic: themes and the embedded artwork -------------------------------

check('there are fourteen built-in themes with unique ids and labels',
  themes.length === 14 && new Set(themes.map((theme) => theme.id)).size === 14
  && new Set(themes.map((theme) => theme.label)).size === 14)
check('every theme names a real palette', themes.every((theme) => palettes.some((palette) => palette.id === theme.paletteId)))
check('every theme names a real built-in background',
  themes.every((theme) => theme.background.mode === 'image' && sanitizeAssetKey(theme.background.asset) !== ''))
check('every theme declares real element values', themes.every((theme) => (
  GLASS_MODES.includes(theme.style.glass)
  && ELEVATIONS.includes(theme.style.elevation)
)))
check('every theme is a complete pair: both schemes carry artwork and a measurement', (() => {
  const offenders = []
  for (const theme of themes) {
    for (const scheme of SCHEMES) {
      const source = embeddedBackgrounds[theme.background.asset]?.[scheme]
      const stats = embeddedBackgroundLightness[theme.background.asset]?.[scheme]
      if (typeof source !== 'string' || source === '') offenders.push(`${theme.id}/${scheme}:art`)
      if (typeof stats?.mean !== 'number' || typeof stats?.p05 !== 'number' || typeof stats?.p95 !== 'number') {
        offenders.push(`${theme.id}/${scheme}:stats`)
      }
    }
  }
  return offenders.length === 0
})())
check('each pair straddles the boundary, so neither member is decoration', (() => {
  // If both members of a pair sat on the same side, one scheme would still be showing an
  // image it was not drawn for and would still need the scrim this design removes.
  return Object.values(embeddedBackgroundLightness).every((pair) => (
    pair.light.mean >= __appearanceInternals.BACKDROP.light
    && pair.dark.mean <= __appearanceInternals.BACKDROP.dark
  ))
})())
check('every built-in theme keeps its own text legible in BOTH colour schemes', (() => {
  // The assertion behind the whole pairing, and the reason each artwork is measured as a
  // distribution rather than a mean. A released page surface is transparent, so the
  // backdrop is the artwork itself — and the two schemes fail in opposite directions:
  // a light interface writes near-black labels and has to survive the artwork's darkest
  // 5%, while a dark interface writes near-white labels and has to survive its
  // brightest 5%. Checking the mean alone passes an artwork whose highlight still eats a
  // paragraph, which is exactly the defect this caught: four of the six dark artworks
  // scored 10:1 or better on the mean and between 2.3:1 and 3.9:1 on the tail.
  const failures = []
  for (const theme of themes) {
    const stats = embeddedBackgroundLightness[theme.background.asset]
    for (const scheme of SCHEMES) {
      const tail = scheme === 'light' ? stats[scheme].p05 : stats[scheme].p95
      const channel = Math.round(clamp(tail, 0, 1) * 255)
      const label = paletteById(theme.paletteId).tokens['--dsw-alias-label-primary'][scheme]
      const ratio = contrastRatio(label, rgbToHex({ r: channel, g: channel, b: channel }))
      if (ratio < 4.5) failures.push(`${theme.id}/${scheme} ${ratio.toFixed(2)}`)
    }
  }
  return failures.length === 0
})())
check('every theme survives its own parser round-trip',
  themes.every((theme) => same(parseSettings(serializeSettings(themeSettings(theme))), themeSettings(theme))))
check('a preset is recognised as itself, and an edited combination as nothing',
  themes.every((theme) => matchTheme(themeSettings(theme)) === theme.id)
  && matchTheme(parseSettings(serializeSettings({ paletteId: 'ink', background: { ...DEFAULT_BACKGROUND, mode: 'gradient' } }))) === '')
check('an unknown theme id falls back to the default', matchTheme(parseSettings('{}')) === '')
check('the artwork is embedded as sanitizer-accepted JPEG data URLs',
  themes.every((theme) => SCHEMES.every((scheme) => {
    const source = embeddedBackgrounds[theme.background.asset]?.[scheme]
    return typeof source === 'string' && source.startsWith('data:image/jpeg;base64,') && sanitizeImageUrl(source) === source
  })))
check('the palettes are visually distinct rather than six shades of one hue', (() => {
  const hues = palettes.map((palette) => hexToHsv(palette.tokens['--dsw-alias-brand-primary'].dark).h).sort((a, b) => a - b)
  const gaps = hues.map((hue, index) => (index === 0 ? hue + 360 - hues[hues.length - 1] : hue - hues[index - 1]))
  return 360 - Math.max(...gaps) >= 200
})())
info(`themes: ${themes.map((theme) => theme.id).join(', ')}`)
info(`palettes: ${palettes.map((palette) => palette.id).join(', ')}; ${String(ELEVATIONS.length)} elevations, ${String(GLASS_MODES.length)} glass modes, ${String(BACKGROUND_MODES.length)} background modes, ${String(IMAGE_SIZES.length)} sizes`)

// --- the theme stub, and proof that it models the trap ------------------------

/**
 * Faithful model of rc.2's `ThemeRuntime.overrideTokens`, read off its bundle:
 *
 *   const layer = { seq: this.overrideSeq++, tokens };
 *   this.overrides.set(source, layer); this.publish();
 *   return () => { if (this.overrides.get(source) !== layer) return;
 *                  this.overrides.delete(source); this.publish(); };
 *
 * @returns a theme service stub recording every stack and retraction.
 */
function createTheme() {
  const live = new Map()
  const stacked = []
  const retracted = []
  let seq = 0
  return {
    live,
    stacked,
    retracted,
    overrideTokens(source, tokens) {
      const layer = { seq: seq++, source, tokens }
      live.set(source, layer)
      stacked.push(layer)
      return () => {
        if (live.get(source) !== layer) return
        live.delete(source)
        retracted.push(layer)
      }
    },
  }
}

{
  const probe = createTheme()
  const first = probe.overrideTokens('probe', {})
  const second = probe.overrideTokens('probe', {})
  first()
  check("harness models rc.2's rule: a superseded disposer is a no-op", probe.live.size === 1, `live=${String(probe.live.size)}`)
  second()
  check('harness models retraction by the live disposer', probe.live.size === 0, `live=${String(probe.live.size)}`)
}

// --- the artifact, and the page driven through its own handlers ---------------

check('artifact is pure ASCII (no charset can corrupt the labels)', /^[^\x80-\uffff]*$/.test(text))
check('registers through window.__ModuleLoader__.load', /window\.__ModuleLoader__\.load\(/.test(text))

/** Boot the artifact the way the shell does, against recording stubs. */
async function boot({ remembered = null, legacy = null, query = '', eyeDropper = false, scheme = 'light' } = {}) {
  const requested = []
  const react = {
    stateWrites: [],
    effects: [],
    cleanups: [],
    // A minimal renderer: function components are expanded in place, so the tree
    // the assertions walk is the tree a browser would mount rather than a tree of
    // unresolved component references.
    createElement: (type, props, ...children) => {
      const flat = children.flat(Infinity)
      return typeof type === 'function'
        ? type({ ...(props ?? {}), children: flat })
        : { type, props: props ?? {}, children: flat }
    },
    useState: (initial) => [initial, (next) => { react.stateWrites.push(next) }],
    // React runs a mount effect immediately, and the plugin's scheme subscription is
    // established there — a stub that only recorded the callback would let a page that
    // never reacts to a scheme change pass.
    useEffect: (effect) => {
      react.effects.push(effect)
      const cleanup = effect()
      if (typeof cleanup === 'function') react.cleanups.push(cleanup)
    },
  }
  const request = (id) => {
    requested.push(id)
    if (id === 'react') return react
    throw new Error(`the artifact asked for an unexpected module: ${id}`)
  }

  const styles = []
  // The shell resolves the colour scheme and writes it as an inline `color-scheme` on the
  // document element, so the stub mirrors that rather than a media query: it is the same
  // value the plugin's own CSS `light-dark()` resolves against, and both the artwork
  // choice and the scrim have to be driven by it.
  const rootElement = { style: {}, scheme, observers: [] }
  /**
   * A canvas whose `toDataURL` reports roughly what a JPEG of those pixels would weigh.
   * The suite cannot encode a JPEG, so the numbers are not pixels — but they are monotonic
   * in area and in quality, which is exactly what the shrink ladder decides on, so the
   * loop terminates here for the same reason it terminates in a browser.
   */
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ fillStyle: '', fillRect: () => {}, drawImage: () => {} }),
          toDataURL(_type, quality) {
            const bytes = Math.max(1024, Math.round(this.width * this.height * quality * 0.09))
            return `data:image/jpeg;base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`
          },
        }
      }
      const element = { dataset: {}, textContent: '', removed: false }
      element.remove = () => { element.removed = true; const at = styles.indexOf(element); if (at >= 0) styles.splice(at, 1) }
      return element
    },
    head: { appendChild: (element) => styles.push(element) },
    documentElement: rootElement,
  }
  /**
   * Every source decodes to the same oversized photograph. That is the point: a stub that
   * decoded to something small would let a broken shrink ladder pass, because the first
   * rung would always fit.
   */
  globalThis.Image = class {
    constructor() { this.width = 0; this.height = 0; this.onload = null; this.onerror = null }
    set src(value) {
      void value
      this.width = 4000
      this.height = 3000
      queueMicrotask(() => { this.onload?.() })
    }
  }
  globalThis.getComputedStyle = (element) => ({
    colorScheme: element === rootElement ? rootElement.scheme : '',
  })
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.target = null }
    observe(target) { this.target = target; target.observers.push(this) }
    disconnect() {
      const target = this.target
      if (target === null) return
      const at = target.observers.indexOf(this)
      if (at >= 0) target.observers.splice(at, 1)
      this.target = null
    }
  }
  /** Change the scheme the way the shell does, then let the plugin notice. */
  const setScheme = (next) => {
    rootElement.scheme = next
    for (const observer of [...rootElement.observers]) observer.callback()
  }

  const storage = new Map()
  if (remembered !== null) storage.set(STORAGE_KEY, remembered)
  if (legacy !== null) storage.set(LEGACY_STORAGE_KEY, legacy)
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  })
  // `readAsDataURL` resolves synchronously, which is enough to exercise the
  // plugin's onload wiring without a real file.
  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    value: class {
      constructor() { this.result = 'data:image/png;base64,QUJD'; this.onload = null }
      readAsDataURL() { this.onload?.() }
    },
  })
  if (eyeDropper) {
    Object.defineProperty(globalThis, 'EyeDropper', {
      configurable: true,
      value: class { open() { return Promise.resolve({ sRGBHex: '#abcdef' }) } },
    })
  } else {
    delete globalThis.EyeDropper
  }

  let entry
  globalThis.window = {
    __ModuleLoader__: { load: (value) => { entry = value } },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  }
  await import(`${pathToFileURL(artifact).href}${query}`)

  const theme = createTheme()
  const effects = []
  const injections = []
  const registrations = []
  const ctx = {
    effect: (setup, label) => { const dispose = setup(); effects.push({ label, dispose }); return dispose },
    theme,
    slots: {
      inject: (key, callback) => { injections.push(key); callback() },
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
  }
  return { entry, request, ctx, theme, effects, injections, registrations, styles, storage, react, rootElement, setScheme }
}

/** Render the registered page and index its parts. */
function render(run) {
  const registration = run.registrations[0]
  const face = registration.options.inject()
  const tree = registration.component(face)
  return {
    registration,
    face,
    tree,
    cards: findAll(tree, 'dsh-theme-card'),
    palettes: findAll(tree, 'dsh-theme-palette'),
    tabs: findAll(tree, 'dsh-theme-tab'),
    assets: findAll(tree, 'dsh-theme-asset'),
    reset: findAll(tree, 'dsh-theme-reset')[0],
  }
}

const stored = (run) => JSON.parse(run.storage.get(STORAGE_KEY))
const tagFor = (run, suffix) => run.styles.find((tag) => String(tag.dataset.pluginCss).endsWith(suffix))
const paintOf = (run) => tagFor(run, 'paint.css')?.textContent ?? ''
const liveTokens = (run) => run.theme.live.get(SOURCE)?.tokens ?? {}

const run = await boot()
check('exactly one entry carrying a factory', run.entry !== undefined && typeof run.entry.factory === 'function')
check('entry id is the package name', run.entry?.id === pkg.name, String(run.entry?.id))

// A request other than the baseline `react` throws, so this also proves the
// artifact reaches the theme and slot services through `ctx` and nothing else.
const loaded = run.entry.factory(run.request)
check('exports name/inject/apply', typeof loaded.name === 'string' && Array.isArray(loaded.inject) && typeof loaded.apply === 'function')
check('name matches the package', loaded.name === pkg.name, String(loaded.name))
check('inject declares slots and theme', same(loaded.inject, ['slots', 'theme']), JSON.stringify(loaded.inject))

loaded.apply(run.ctx)

check('boot stacks exactly one layer', run.theme.live.size === 1, `live=${String(run.theme.live.size)}`)
check('the live layer belongs to this plugin', [...run.theme.live.keys()][0] === SOURCE, [...run.theme.live.keys()].join(','))
check('a first run applies the default theme, palette and artwork together',
  same(render(run).face.get(), themeSettings(themes[0])))
check('a first run writes nothing to storage (booting stays read-only)',
  run.storage.get(STORAGE_KEY) === undefined)
check('the layer carries the palette', same(liveTokens(run)['--dsw-alias-brand-primary'], paletteById('abyss').tokens['--dsw-alias-brand-primary']))
check('the layer carries the released surfaces for the painted background',
  liveTokens(run)['--dsw-alias-bg-base'].light === 'transparent')
check('the layer carries the element overrides the theme asked for',
  liveTokens(run)['--dsw-mask-blur'].light === '18px' && liveTokens(run)['--dsw-elevation-panel'] !== undefined)
check('the paint and the page chrome are two separate stylesheets',
  run.styles.length === 2 && tagFor(run, 'page.css') !== undefined && tagFor(run, 'paint.css') !== undefined,
  `tags=${String(run.styles.length)}`)
check('the paint references the theme artwork', paintOf(run).includes('url("data:image/jpeg;base64,'))
check('the paint carries a scheme-aware veil', paintOf(run).includes('light-dark('))
check('the paint carries the logo rule the theme asked for',
  paintOf(run).includes('[data-slot="sidebar.brand.mark"]'))
check('every registration is owned by ctx.effect', run.effects.length === 3, `effects=${String(run.effects.length)}`)
check('the page is injected into settings.section', same(run.injections, ['settings.section']), JSON.stringify(run.injections))
check('exactly one page is registered', run.registrations.length === 1, `pages=${String(run.registrations.length)}`)
const registration = run.registrations[0]
check('page declares name/id/order', registration?.options.name === 'settings.section'
  && registration?.options.id === 'themes' && typeof registration?.options.order === 'number',
  JSON.stringify(registration?.options))
check('page declares a nav label function',
  typeof registration?.options.label === 'function' && registration.options.label() === '主题')
check('page component is a function', typeof registration?.component === 'function')

const page = render(run)
check('inject face exposes get/apply/reset', typeof page.face?.get === 'function'
  && typeof page.face?.apply === 'function' && typeof page.face?.reset === 'function')
check('the gallery offers one card per built-in theme', page.cards.length === themes.length, `${String(page.cards.length)} vs ${String(themes.length)}`)
check('each card shows its theme label and a miniature interface', (() => {
  const labels = page.cards.map((card) => findAll(card, 'dsh-theme-card-label')[0]?.children?.[0])
  return same(labels, themes.map((theme) => theme.label))
    && page.cards.every((card) => findAll(card, 'dsh-theme-shot').length === 1
      && findAll(card, 'dsh-theme-shot-main').length === 1
      && findAll(card, 'dsh-theme-shot-btn').length === 1)
})())
check('a card paints its miniature in that theme palette, in the scheme in force', (() => {
  const ink = themes.findIndex((theme) => theme.id === 'ink')
  const tokens = paletteById('ink').tokens
  const mode = run.rootElement.scheme
  const card = page.cards[ink]
  const title = findAll(findAll(card, 'dsh-theme-shot-card')[0], 'dsh-theme-shot-title')[0]
  const button = findAll(card, 'dsh-theme-shot-btn')[0]
  const side = findAll(card, 'dsh-theme-shot-side')[0]
  return title?.props?.style?.background === rgba(tokens['--dsw-alias-label-primary'][mode], 0.85)
    && button?.props?.style?.background === tokens['--dsw-alias-brand-primary'][mode]
    && side?.props?.style?.background === rgba(tokens['--dsw-specific-sidebar-fill'][mode], 0.72)
})())
check('a card paints the artwork drawn for the scheme in force, not the other one', (() => {
  const asset = themes[0].background.asset
  const shot = findAll(page.cards[0], 'dsh-theme-shot')[0]
  return shot?.props?.style?.backgroundImage
    === `url(${JSON.stringify(embeddedBackgrounds[asset][run.rootElement.scheme])})`
})())
check('only the theme in force is pressed', page.cards.filter((card) => card.props['aria-pressed'] === true).length === 1)
check('the pressed card is the default theme', page.cards[themes.findIndex((theme) => theme.id === themes[0].id)]?.props['aria-pressed'] === true)
check('the palette row offers every palette plus the official one',
  page.palettes.length === palettes.length
  && findAll(page.tree, 'dsh-theme-palette-official').length === 1, `palettes=${String(page.palettes.length)}`)
check('all four background modes are offered', page.tabs.length === 4, `tabs=${String(page.tabs.length)}`)
check('the mode in force is the pressed tab', page.tabs[BACKGROUND_MODES.indexOf('image')]?.props['aria-pressed'] === true)
check('the built-in backgrounds are all offered as thumbnails',
  page.assets.length === Object.keys(backgroundLabels).length, `assets=${String(page.assets.length)}`)
check('the thumbnails show the artwork drawn for the scheme in force', (() => {
  // Order-independent: the offering order is a presentation choice and its own change,
  // so what this pins is that every embedded background is offered, once, in this scheme.
  const expected = Object.values(embeddedBackgrounds)
    .map((pair) => `url(${JSON.stringify(pair[run.rootElement.scheme])})`)
  const rendered = page.assets.map((tile) => findAll(tile, 'dsh-theme-asset-img')[0]?.props?.style?.backgroundImage)
  return rendered.length === expected.length && expected.every((source) => rendered.includes(source))
})())
check('the restore button is enabled while a theme is applied', page.reset?.props.disabled === false)

// Switching colour scheme with the page open. The paint and the gallery have to move
// together: a gallery that kept showing the previous scheme's artwork would advertise
// something the user is not about to get.
const lightPaint = paintOf(run)
run.setScheme('dark')
check('a scheme change repaints the live background with the other artwork',
  paintOf(run) !== lightPaint && paintOf(run).includes(embeddedBackgrounds.abyss.dark.slice(0, 40)))
check('a scheme change is announced to the page rather than only painted',
  run.react.stateWrites.length > 0, `writes=${String(run.react.stateWrites.length)}`)
check('a scheme change re-renders the gallery in the new scheme',
  findAll(render(run).cards[0], 'dsh-theme-shot')[0].props.style.backgroundImage
    === `url(${JSON.stringify(embeddedBackgrounds.abyss.dark)})`)
check('a scheme change moves the thumbnails too',
  findAll(render(run).assets[0], 'dsh-theme-asset-img')[0].props.style.backgroundImage
    === `url(${JSON.stringify(embeddedBackgrounds.abyss.dark)})`)
check('a scheme change leaves the token layer alone (the palette was already a pair)',
  same(liveTokens(run)['--dsw-alias-brand-primary'], paletteById('abyss').tokens['--dsw-alias-brand-primary']))
check('a redundant scheme notification does not repaint',
  (() => {
    const before = paintOf(run)
    run.setScheme('dark')
    return paintOf(run) === before
  })())
run.setScheme('light')
check('switching back restores the light artwork',
  paintOf(run).includes(embeddedBackgrounds.abyss.light.slice(0, 40)))

// Swapping a whole theme through its card.
const ink = themes.find((theme) => theme.id === 'ink')
page.cards[themes.indexOf(ink)].props.onClick()
check('clicking a card applies all three axes at once', same(stored(run), themeSettings(ink)), JSON.stringify(stored(run)).slice(0, 80))
check('switching a theme replaces the layer instead of stacking a second one',
  run.theme.live.size === 1, `live=${String(run.theme.live.size)}`)
check('the live layer is the new theme palette',
  same(liveTokens(run)['--dsw-alias-brand-primary'], paletteById('ink').tokens['--dsw-alias-brand-primary']))
check('the new theme glass setting reaches the layer', liveTokens(run)['--dsw-mask-blur'].light === 'none')
check('the new theme artwork reaches the paint', paintOf(run).includes(embeddedBackgrounds.ink.light.slice(0, 40)))
check('the pressed card follows the choice', render(run).cards[themes.indexOf(ink)].props['aria-pressed'] === true)

// Swapping one axis on its own.
const abyss = palettes.find((palette) => palette.id === 'abyss')
render(run).palettes[palettes.indexOf(abyss)].props.onClick()
check('swapping only the palette leaves the background alone',
  stored(run).paletteId === 'abyss' && stored(run).background.asset === 'ink', JSON.stringify(stored(run).background.asset))
check('swapping only the palette repaints the layer',
  same(liveTokens(run)['--dsw-alias-brand-primary'], paletteById('abyss').tokens['--dsw-alias-brand-primary']))

findAll(render(run).tree, 'dsh-theme-palette-official')[0].props.onClick()
check('the official palette stacks no palette tokens',
  stored(run).paletteId === 'official' && liveTokens(run)['--dsw-alias-border-l1'] === undefined)
check('the official palette still releases surfaces, so the artwork stays visible',
  liveTokens(run)['--dsw-alias-bg-base'].light === 'transparent'
  && String(liveTokens(run)['--dsw-specific-sidebar-fill'].light).startsWith('rgba('))
render(run).palettes[palettes.indexOf(abyss)].props.onClick()
check('picking a palette again restores its tokens', liveTokens(run)['--dsw-alias-border-l1'] !== undefined)

// Background modes.
const tab = (label) => render(run).tabs.find((entry) => entry.children[0] === label)
tab('纯色').props.onClick()
check('the flat-colour mode paints a colour and no image',
  stored(run).background.mode === 'color' && paintOf(run).includes('background-color:#101722')
  && !paintOf(run).includes('url('))
tab('渐变').props.onClick()
check('the gradient mode paints a linear-gradient', paintOf(run).includes('linear-gradient(135deg, #101722, #22303f)'))
const angle = findAll(render(run).tree, 'dsh-theme-range')[0]
angle.props.onChange({ target: { value: '200' } })
check('dragging the angle slider repaints at the new angle',
  stored(run).background.angle === 200 && paintOf(run).includes('linear-gradient(200deg, #101722, #22303f)'))
tab('跟随主题').props.onClick()
check('returning to the theme mode stops painting and releases nothing extra',
  stored(run).background.mode === 'theme' && !paintOf(run).includes('background-color')
  && same(liveTokens(run)['--dsw-alias-bg-base'], paletteById('abyss').tokens['--dsw-alias-bg-base']))
check('the logo rule survives while the background is gone',
  paintOf(run).includes('[data-slot="sidebar.brand.mark"]'))

tab('图片').props.onClick()
/**
 * The thumbnail for a built-in background, found by its label rather than by index:
 * the offering order is a presentation choice, and pinning it here would make every
 * gallery reordering look like a regression in an unrelated assertion.
 * @param {Awaited<ReturnType<typeof boot>>} run - the booted artifact.
 * @param {string} key - the embedded background key.
 * @returns {Record<string, any> | undefined} the tile.
 */
const assetTile = (run, key) => render(run).assets.find(
  (tile) => findAll(tile, 'dsh-theme-asset-label')[0]?.children?.[0] === backgroundLabels[key],
)
assetTile(run, 'aurora').props.onClick()
check('picking a built-in background records the key and paints its artwork',
  stored(run).background.asset === 'aurora' && stored(run).background.url === ''
  && paintOf(run).includes(embeddedBackgrounds.aurora.light.slice(0, 40)))
check('the pressed thumbnail follows the choice',
  assetTile(run, 'aurora').props['aria-pressed'] === true)

const fileInput = findAll(render(run).tree, 'dsh-theme-file')[0]
fileInput.props.onChange({ target: { files: [{ size: 1000 }] } })
check('a small local file is stored byte for byte, never re-encoded',
  stored(run).background.url === 'data:image/png;base64,QUJD' && stored(run).background.asset === 'aurora'
  && paintOf(run).includes('url("data:image/png;base64,QUJD")'))

const urlField = findAll(render(run).tree, 'dsh-theme-text')[0]
urlField.props.onChange({ target: { value: 'javascript:alert(1)' } })
check('an unlisted scheme in the address field is refused and changes nothing',
  stored(run).background.url === 'data:image/png;base64,QUJD')
urlField.props.onChange({ target: { value: 'https://example.com/wall.png' } })
check('a pasted https address is accepted and painted',
  stored(run).background.url === 'https://example.com/wall.png' && paintOf(run).includes('url("https://example.com/wall.png")'))
urlField.props.onChange({ target: { value: '' } })
check('clearing the address falls back to the built-in key',
  stored(run).background.url === '' && paintOf(run).includes(embeddedBackgrounds.aurora.light.slice(0, 40)))

// Auto-compression. The old behaviour refused an over-cap file and told the user to go and
// compress it themselves; the file is already decoded in the page, so the plugin does it.
// The stub decodes every source to the same oversized photograph, which is what makes the
// ladder actually run instead of fitting on the first rung.
const oversizedWrites = run.react.stateWrites.length
findAll(render(run).tree, 'dsh-theme-file')[0].props.onChange({ target: { files: [{ size: 9_000_000 }] } })
await new Promise((resolve) => { setTimeout(resolve, 0) })
check('an oversized file is compressed instead of refused', (() => {
  const url = stored(run).background.url
  return url.startsWith('data:image/jpeg;base64,') && url.length <= SHRINK_TARGET
})())
check('the compression says what it did', run.react.stateWrites.slice(oversizedWrites)
  .some((value) => typeof value === 'string' && value.includes('\u5df2\u81ea\u52a8\u538b\u7f29')))
check('the compressed upload is what gets painted', paintOf(run).includes(stored(run).background.url.slice(0, 40)))
const uploadBefore = stored(run).background.url
findAll(render(run).tree, 'dsh-theme-file')[0].props.onChange({ target: { files: [{ size: 9_000_000 }] } })
check('a second oversized pick does not change anything until it resolves',
  stored(run).background.url === uploadBefore)
await new Promise((resolve) => { setTimeout(resolve, 0) })
check('an unreadable file is refused rather than half-applied', (() => {
  // A zero-byte pick decodes to nothing in a browser; the stub's FileReader always yields
  // bytes, so what this pins is the guard that keeps an empty read off the settings.
  const before = stored(run).background.url
  findAll(render(run).tree, 'dsh-theme-file')[0].props.onChange({ target: { files: [{ size: 40_000_000 }] } })
  return stored(run).background.url === before
})())
// Restore the built-in source, so the scrim assertions that follow measure the artwork's
// own lightness instead of the unknown-lightness fallback a custom upload gets.
findAll(render(run).tree, 'dsh-theme-text')[0].props.onChange({ target: { value: '' } })
check('clearing a compressed upload returns to the built-in artwork',
  stored(run).background.url === '' && paintOf(run).includes(embeddedBackgrounds.aurora.light.slice(0, 40)))

const veil = findAll(render(run).tree, 'dsh-theme-range')[0]
veil.props.onChange({ target: { value: '85' } })
check('the veil control biases the automatic scrim instead of replacing it', (() => {
  const css = paintOf(run)
  // 极光 is a paired theme, so the automatic part is zero in the scheme in force and the
  // whole of this value is the user's own bias. Rounding is pinned so the CSS is stable.
  return stored(run).background.veil === 85
    && css.includes('light-dark(rgba(255, 255, 255, 0.33), rgba(0, 0, 0, 0.88))')
})())
veil.props.onChange({ target: { value: '0' } })
check('even at its minimum, the scheme the artwork was not drawn for keeps its scrim', (() => {
  const css = paintOf(run)
  // Dialling the control down cannot strip the other scheme of its protection, which is
  // what makes the control a bias rather than an override.
  return stored(run).background.veil === 0
    && css.includes('light-dark(rgba(255, 255, 255, 0), rgba(0, 0, 0, 0.54))')
})())

// The picker, driven with pointer events.
const box = { left: 0, top: 0, width: 200, height: 140 }
const pointer = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, currentTarget: { getBoundingClientRect: () => box, setPointerCapture: () => {} } })
tab('纯色').props.onClick()
check('the platform eyedropper is offered only when the runtime has one',
  findAll(render(run).tree, 'dsh-theme-eye').length === 0)
findAll(render(run).tree, 'dsh-theme-hue')[0].props.onPointerDown(pointer(0, 7))
check('dragging the hue strip to the far left turns the colour red',
  Math.abs(hexToHsv(stored(run).background.color).h) <= 1 && hexToHsv(stored(run).background.color).s > 0.2,
  stored(run).background.color)
findAll(render(run).tree, 'dsh-theme-sv')[0].props.onPointerDown(pointer(0, 140))
check('dragging the SV square to its dark corner commits black', stored(run).background.color === '#000000', stored(run).background.color)
const hexField = findAll(render(run).tree, 'dsh-theme-hex')[0]
hexField.props.onChange({ target: { value: '#123456' } })
check('typing a hex value commits exactly that colour', stored(run).background.color === '#123456', stored(run).background.color)
hexField.props.onChange({ target: { value: 'nonsense' } })
check('typing nonsense commits nothing', stored(run).background.color === '#123456', stored(run).background.color)
check('the painted colour follows the picker', paintOf(run).includes('background-color:#123456'))

// Element controls, end to end.
const tint = controlIn(render(run).tree, '左上角 Logo 跟随强调色', 'dsh-theme-switch')
const tintBefore = stored(run).style.tintLogo
tint.props.onClick()
check('the logo switch flips the style, and the stylesheet follows it both ways',
  stored(run).style.tintLogo === !tintBefore
  && paintOf(run).includes('[data-slot="sidebar.brand.mark"]') === stored(run).style.tintLogo)
controlIn(render(run).tree, '隐藏字标（只留 Logo）', 'dsh-theme-switch').props.onClick()
check('the wordmark switch reaches the stylesheet',
  stored(run).style.hideWordmark === true && paintOf(run).includes('[data-slot="sidebar.brand.name"]{display:none!important}'))
const glass = controlIn(render(run).tree, '玻璃质感（浮层模糊）', 'dsh-theme-select')
glass.props.onChange({ target: { value: 'off' } })
check('the glass select reaches the layer',
  liveTokens(run)['--dsw-mask-blur'].light === 'none')
controlIn(render(run).tree, '阴影', 'dsh-theme-select').props.onChange({ target: { value: 'glow' } })
check('the elevation select reaches the layer',
  String(liveTokens(run)['--dsw-shadow-lv1'].light).includes('rgba('))
check('every enumerated choice is offered with a non-empty label', (() => {
  // A missing entry in a label map renders as a blank option, which is the kind of
  // thing that only shows up in a screenshot — so it is asserted instead.
  const selects = [
    [controlIn(render(run).tree, '阴影', 'dsh-theme-select'), ELEVATIONS],
    [controlIn(render(run).tree, '玻璃质感（浮层模糊）', 'dsh-theme-select'), GLASS_MODES],
    [controlIn(render(run).tree, '透明范围', 'dsh-theme-select'), TRANSPARENCY_RANGES],
  ]
  return selects.every(([select, expected]) => same(select?.children.map((option) => option.props.value), expected)
    && select.children.every((option) => typeof option.children[0] === 'string' && option.children[0] !== ''))
})())
const logoFile = findAll(render(run).tree, 'dsh-theme-logofile')[0]
logoFile.props.onChange({ target: { files: [{ size: 1000 }] } })
check('a custom logo replaces the mark',
  stored(run).style.logoImage === 'data:image/png;base64,QUJD'
  && paintOf(run).includes('[data-slot="sidebar.brand.mark"]{display:block!important;width:24px;height:24px')
  && paintOf(run).includes('url("data:image/png;base64,QUJD")'))
controlIn(render(run).tree, '透明范围', 'dsh-theme-select').props.onChange({ target: { value: 'glass' } })
check('the transparency select releases more surfaces',
  Object.keys(liveTokens(run)).length > 0 && liveTokens(run)['--dsw-alias-bg-overlay'] !== undefined)

// Restore official.
render(run).reset.props.onClick()
check('restore official retracts the layer entirely',
  run.theme.live.size === 0 && run.styles.length === 1, `live=${String(run.theme.live.size)} tags=${String(run.styles.length)}`)
check('restore official is persisted as the official state',
  same(stored(run), { paletteId: 'official', background: DEFAULT_BACKGROUND, style: DEFAULT_STYLE }),
  JSON.stringify(stored(run)).slice(0, 80))
check('the restore button is then disabled', render(run).reset.props.disabled === true)

check('layer bookkeeping conserves: every stack is either retracted or still live',
  run.theme.stacked.length === run.theme.retracted.length + run.theme.live.size,
  `stacked=${String(run.theme.stacked.length)} retracted=${String(run.theme.retracted.length)} live=${String(run.theme.live.size)}`)

for (const effect of run.effects) effect.dispose()
check('unmounting removes every stylesheet', run.styles.length === 0, `tags=${String(run.styles.length)}`)
check('unmounting leaves nothing live', run.theme.live.size === 0, `live=${String(run.theme.live.size)}`)

// --- remembered state, migration, and teardown ownership ----------------------

const remembered = await boot({ remembered: serializeSettings(themeSettings(ink)), query: '?remembered=1' })
remembered.entry.factory(remembered.request).apply(remembered.ctx)
check('a remembered theme is restacked at boot',
  same(liveTokens(remembered)['--dsw-alias-brand-primary'], paletteById('ink').tokens['--dsw-alias-brand-primary']))
check('a remembered artwork is repainted at boot',
  paintOf(remembered).includes(embeddedBackgrounds.ink.light.slice(0, 40)))

const migrated = await boot({ legacy: 'forest', query: '?legacy=1' })
migrated.entry.factory(migrated.request).apply(migrated.ctx)
check("the previous version's stored skin id still applies",
  same(liveTokens(migrated)['--dsw-alias-brand-primary'], paletteById('pine').tokens['--dsw-alias-brand-primary']))

const officialRun = await boot({ remembered: serializeSettings(defaultSettings()), query: '?official=2' })
officialRun.entry.factory(officialRun.request).apply(officialRun.ctx)
check('the default theme is what a first run gets', officialRun.theme.live.size === 1)

// Teardown ownership on its own. Uninstalling must retract the layer that is live
// at that moment, not merely the first one ever stacked — getting this wrong is
// what let a skin survive uninstall and block the official look from returning.
const leaving = await boot({ query: '?leaving=1' })
leaving.entry.factory(leaving.request).apply(leaving.ctx)
render(leaving).cards[themes.indexOf(ink)].props.onClick()
const stackedBeforeTeardown = leaving.theme.stacked.length
for (const effect of leaving.effects) effect.dispose()
check('UNINSTALL RETRACTS THE THEME: the live layer does not survive teardown',
  leaving.theme.live.size === 0, `live=${String(leaving.theme.live.size)}`)
check('teardown retracted the layer that was live, not the boot layer',
  leaving.theme.stacked.length === stackedBeforeTeardown && leaving.theme.retracted.length === 2
  && same(leaving.theme.retracted.at(-1)?.tokens['--dsw-alias-brand-primary'], paletteById('ink').tokens['--dsw-alias-brand-primary']),
  `retracted=${String(leaving.theme.retracted.length)}`)
check('teardown also removes the paint stylesheet', leaving.styles.length === 0, `tags=${String(leaving.styles.length)}`)

// The eyedropper only exists where the runtime provides one, so it needs its own boot.
const picking = await boot({ eyeDropper: true, query: '?eyedropper=1' })
picking.entry.factory(picking.request).apply(picking.ctx)
const pickingTab = render(picking).tabs.find((entry) => entry.children[0] === '\u7eaf\u8272')
pickingTab.props.onClick()
const eyeButton = findAll(render(picking).tree, 'dsh-theme-eye')[0]
check('the eyedropper appears when the runtime provides one', eyeButton !== undefined)
eyeButton?.props.onClick()
await new Promise((resolve) => { setTimeout(resolve, 0) })
check('an eyedropper pick becomes the background colour',
  stored(picking).background.color === '#abcdef', stored(picking).background.color)

info(`artifact ${String(text.length)} bytes`)
console.log(failures.length === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${String(failures.length)}: ${failures.join('; ')})`)
process.exit(failures.length === 0 ? 0 : 1)
