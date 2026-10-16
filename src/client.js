/**
 * dsh-skin-lab — client half: wiring.
 *
 * A theme is three independent axes combined: a palette (colours, `palettes.js`), a
 * background (painted artwork, gradient or flat colour, `appearance.js`), and a few
 * structural elements (logo tinting, glass chrome, elevation — also `appearance.js`).
 * The built-in themes in `themes.js` are designed pairings of the three; the settings
 * page in `page.js` exposes each axis on its own.
 *
 * Two invariants carry the correctness of this half:
 *
 *   1. **The live override layer is always owned.** `overrideTokens` returns a
 *      disposer that is a no-op once the same source has re-overridden, so a plugin
 *      that remembers only its first disposer leaves the running layer owned by
 *      nobody — the skin then survives uninstall and the official look cannot come
 *      back. Every recompose retracts through `layerDispose` and installs the new one.
 *   2. **Nothing unvalidated reaches the CSS.** Every mutation is rebuilt as a patch
 *      over the current settings and round-tripped through `parseSettings`, so a value
 *      that survived storage editing or an older payload cannot land in a stylesheet.
 */
import {
  DEFAULT_BACKGROUND,
  DEFAULT_STYLE,
  backgroundCss,
  elementCss,
  elementTokens,
  parseSettings,
  serializeSettings,
  transparencyTokens,
} from './appearance.js'
import { DEFAULT_PALETTE_ID, paletteById } from './palettes.js'
import { defaultSettings } from './themes.js'
import { ThemesSection, pageCss } from './page.js'

export const name = 'dsh-skin-lab'
export const inject = ['slots', 'theme']

const STORAGE_KEY = 'dsh-skin-lab.settings'
/** The key the previous version wrote; read once so a chosen look is not lost. */
const LEGACY_STORAGE_KEY = 'dsh-skin-lab.skin'
/** A palette id that means "stack no palette at all", i.e. the application's own. */
const OFFICIAL_PALETTE_ID = 'official'
/** The previous version's skin ids, mapped onto the palettes that succeeded them. */
/** @type {Record<string, string>} */
const LEGACY_PALETTE_IDS = { official: OFFICIAL_PALETTE_ID, ocean: 'abyss', sakura: 'ink', forest: 'pine', dusk: 'aurora' }
/** The brand blue, used only when the official palette is in force and a glow needs a hue. */
const OFFICIAL_ACCENT = { light: '#4d6bfe', dark: '#4d6bfe' }

/** @typedef {ReturnType<typeof parseSettings>} Settings */

/** @type {Settings} */
let settings = defaultSettings()
/** The disposer of the layer that is live right now. @type {(() => void) | null} */
let layerDispose = null
/** @type {HTMLStyleElement | null} */
let paintTag = null
/** @type {HTMLStyleElement | null} */
let pageTag = null
let persistFailed = false
/** The scheme the shell is rendering in; picks which artwork a theme paints. @type {'light' | 'dark'} */
let scheme = 'light'
/** Page callbacks to wake when the scheme changes. @type {Set<() => void>} */
const schemeListeners = new Set()

/**
 * The colour scheme in force.
 *
 * Read from `color-scheme` on the document element rather than from a media query
 * alone, because that property is what the application itself sets — including when
 * the user forces light or dark instead of following the system — and it is the same
 * value our own CSS `light-dark()` resolves against. Keeping both on one source of
 * truth is what stops the artwork and its scrim from disagreeing.
 *
 * A bare `light dark` leaves the choice to the engine, which resolves it through the
 * media query, so that is the honest answer in that case.
 *
 * @returns {'light' | 'dark'} the scheme the shell is rendering in.
 */
function readScheme() {
  const declared = String(getComputedStyle(document.documentElement).colorScheme ?? '')
  const saysLight = declared.includes('light')
  const saysDark = declared.includes('dark')
  if (saysDark && !saysLight) return 'dark'
  if (saysLight && !saysDark) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * The palette tokens in force. The official palette means "stack none", so a
 * background combined with it falls back to neutral translucent chrome.
 * @returns {Record<string, { light: string, dark: string }>} the palette's tokens, or `{}`.
 */
function paletteTokens() {
  if (settings.paletteId === OFFICIAL_PALETTE_ID) return {}
  return paletteById(settings.paletteId).tokens
}

/**
 * Everything this plugin wants to override, composed into one layer so that one
 * source owns one disposer and no two layers race for the same token.
 * @returns {Record<string, { light: string, dark: string }>} token overrides.
 */
function layerTokens() {
  const base = paletteTokens()
  const accent = base['--dsw-alias-brand-primary'] ?? OFFICIAL_ACCENT
  return {
    ...base,
    ...transparencyTokens(settings.background, base),
    ...elementTokens(settings.style, accent),
  }
}

/**
 * Push the current settings at the shell: restack the token layer and rewrite the
 * paint stylesheet. Retracts before stacking, so the previous layer is always
 * released by the disposer that owns it.
 * @param {{ theme: { overrideTokens: (source: string, tokens: Record<string, { light: string, dark: string }>) => () => void } }} ctx - client context.
 */
function applyState(ctx) {
  layerDispose?.()
  layerDispose = null
  const tokens = layerTokens()
  if (Object.keys(tokens).length > 0) layerDispose = ctx.theme.overrideTokens(name, tokens)

  const paint = backgroundCss(settings.background, scheme) + elementCss(settings.style)
  if (paint === '') {
    paintTag?.remove()
    paintTag = null
    return
  }
  if (paintTag === null) {
    paintTag = document.createElement('style')
    paintTag.dataset.plugin = name
    paintTag.dataset.pluginCss = `${name}/paint.css`
    document.head.appendChild(paintTag)
  }
  paintTag.textContent = paint
}

/**
 * @returns {Settings} what storage remembers, or the default theme.
 */
function readStored() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw !== null) return parseSettings(raw)
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (legacy === null) return defaultSettings()
  const paletteId = LEGACY_PALETTE_IDS[legacy] ?? DEFAULT_PALETTE_ID
  return parseSettings(serializeSettings({ ...defaultSettings(), paletteId }))
}

/**
 * Apply a patch, remember it, and repaint. The merged document goes through
 * `parseSettings` so a rejected value can never reach the stylesheet.
 * @param {{ theme: { overrideTokens: (source: string, tokens: Record<string, { light: string, dark: string }>) => () => void } }} ctx - client context.
 * @param {Record<string, unknown>} patch - partial `paletteId` / `background` / `style`.
 */
function commit(ctx, patch) {
  settings = parseSettings(serializeSettings({
    paletteId: typeof patch.paletteId === 'string' ? patch.paletteId : settings.paletteId,
    background: { ...settings.background, ...(patch.background ?? {}) },
    style: { ...settings.style, ...(patch.style ?? {}) },
  }))
  persistFailed = false
  try {
    localStorage.setItem(STORAGE_KEY, serializeSettings(settings))
  } catch {
    // A full quota must not cost the user the look they just picked, so the
    // in-memory state stands and the page explains why it will not survive a reload.
    persistFailed = true
  }
  applyState(ctx)
}

/**
 * Register the theme page.
 * @param {import('@deepseek-ai/cordis').Context} ctx - client root context.
 */
export function apply(ctx) {
  settings = readStored()
  // Read before the appearance effect runs, so the very first paint already uses the
  // scheme's own artwork instead of a dark image behind a light interface for a frame.
  scheme = readScheme()
  ctx.effect(() => {
    applyState(ctx)
    return () => {
      layerDispose?.()
      layerDispose = null
      paintTag?.remove()
      paintTag = null
    }
  }, 'dsh-skin-lab: appearance')
  ctx.effect(() => {
    const sync = () => {
      const next = readScheme()
      if (next === scheme) return
      scheme = next
      // Repaint first, then wake the page: the settings gallery shows the artwork the
      // current scheme will actually paint, so it has to move with the paint.
      applyState(ctx)
      for (const listener of schemeListeners) listener()
    }
    // The application writes the resolved scheme as an inline `color-scheme` on the
    // document element, so an attribute mutation is exactly the signal we want; the
    // media listener covers a system change the application has not yet re-resolved.
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-ds-theme-source'],
    })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', sync)
    }
  }, 'dsh-skin-lab: colour scheme')
  ctx.effect(() => {
    pageTag = document.createElement('style')
    pageTag.dataset.plugin = name
    pageTag.dataset.pluginCss = `${name}/page.css`
    pageTag.textContent = pageCss
    document.head.appendChild(pageTag)
    return () => {
      pageTag?.remove()
      pageTag = null
    }
  }, 'dsh-skin-lab: page stylesheet')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'themes',
    order: 20,
    label: () => '主题',
    inject: () => ({
      get: () => settings,
      apply: (/** @type {Record<string, unknown>} */ patch) => { commit(ctx, patch) },
      reset: () => {
        commit(ctx, { paletteId: OFFICIAL_PALETTE_ID, background: { ...DEFAULT_BACKGROUND }, style: { ...DEFAULT_STYLE } })
      },
      persistFailed: () => persistFailed,
      scheme: () => scheme,
      subscribe: (/** @type {() => void} */ listener) => {
        schemeListeners.add(listener)
        return () => { schemeListeners.delete(listener) }
      },
    }),
  }, ThemesSection))
}
