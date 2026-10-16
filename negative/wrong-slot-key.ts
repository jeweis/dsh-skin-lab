/**
 * Negative control — this file MUST fail to compile.
 *
 * It exists to prove `tsconfig.probe.json` is not passing vacuously: it repeats
 * the row registration from `src/client.js` with a slot key that no package
 * declares in the `SlotMap`, and with the component erased to `any` so the only
 * possible error is the key itself.
 *
 * Run: npm run typecheck:negative     (expect a non-zero exit)
 *
 * It is deliberately outside `types/` so the main probe program never includes it.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

declare const ctx: Context
declare const Component: any

ctx.slots.register({
  name: 'settings.general.item.typo',
  id: 'skin-lab',
  order: 20,
  inject: () => ({ get: () => ({ paletteId: 'abyss' }) }),
}, Component)
