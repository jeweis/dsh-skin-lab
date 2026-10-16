/**
 * Type-level conformance probe.
 *
 * It compiles this plugin's real source — `checkJs` is on, so `src/client.js` is
 * typechecked rather than merely imported — against the declarations of the DSH
 * **actually installed on this machine** (`0.2.0-rc.2`, cordis `4.0.4`), rather
 * than against a source checkout of a different version. `tsconfig.probe.json`
 * maps the specifiers at the absolute paths those declarations live at, so a
 * signature change between versions fails here instead of at runtime in the
 * browser.
 *
 * The type imports are what put each augmentation into the program:
 * `ui-theme/client` merges `theme` into the cordis Context, `ui-renderer/client`
 * merges `slots` (the `SlotRegistry` service — note it is the *renderer* package,
 * not `ui-slots`, that declares the Context seat), and `ui-settings/client`
 * contributes the `settings.section` entry to the `SlotMap` that
 * `slots.register` is keyed by. Without the third one the registration below
 * would be a compile error — which is the point of the probe.
 *
 * Run: npm run typecheck   (noEmit; writes nothing)
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import { apply, inject, name } from '../src/client.js'
import { DEFAULT_PALETTE_ID, paletteById, palettes } from '../src/palettes.js'
import { backgroundCss, backgroundSource, elementCss, elementTokens, transparencyTokens } from '../src/appearance.js'

/**
 * The one call that matters: with `ctx` typed by the installed declarations, this
 * checks the whole registration path — `theme.overrideTokens`, `slots.inject`,
 * `slots.register` keyed by `settings.section`, and the inject face the page
 * component receives.
 */
declare const ctx: Context
apply(ctx)

/** `inject` must stay a plain string array. */
const declared: string[] = inject

/** A palette lookup must keep returning a token table, not undefined. */
const tokens: Record<string, { light: string, dark: string }> = paletteById(DEFAULT_PALETTE_ID).tokens

/**
 * Every token table this plugin hands to `overrideTokens` must satisfy the
 * platform's own pair shape, and the CSS builders must stay strings.
 */
const overrides: Record<string, { light: string, dark: string }> = {
  ...tokens,
  ...transparencyTokens(
    { mode: 'color', asset: '', url: '', color: '#000000', from: '#000000', to: '#ffffff', angle: 0, size: 'cover', veil: 0, range: 'glass' },
    tokens,
  ),
  ...elementTokens(
    { tintLogo: true, hideWordmark: false, logoImage: '', glass: 'on', elevation: 'glow' },
    tokens['--dsw-alias-brand-primary'],
  ),
}
// Both schemes, because the artwork a theme paints is selected by the one in force.
const light: string = backgroundCss({ mode: 'image', asset: 'abyss', url: '', color: '#000000', from: '#000000', to: '#ffffff', angle: 0, size: 'cover', veil: 30, range: 'panel' }, 'light')
const dark: string = backgroundCss({ mode: 'image', asset: 'abyss', url: '', color: '#000000', from: '#000000', to: '#ffffff', angle: 0, size: 'cover', veil: 30, range: 'panel' }, 'dark')
const source: string = backgroundSource({ mode: 'image', asset: 'abyss', url: '', color: '#000000', from: '#000000', to: '#ffffff', angle: 0, size: 'cover', veil: 30, range: 'panel' }, 'dark')
const logo: string = elementCss({ tintLogo: true, hideWordmark: false, logoImage: '', glass: 'default', elevation: 'default' })

export { dark, declared, light, logo, name, overrides, palettes, source, tokens }
