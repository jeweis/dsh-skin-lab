/**
 * Regression control — proves `verify.mjs` catches the defect that let a skin
 * survive uninstall.
 *
 * The defect: the plugin kept the disposer of its *first* override layer and
 * dropped the one returned by every later switch. Because rc.2's disposer is a
 * no-op once the same source has re-overridden, the stacked layer ended up owned
 * by nobody, so unloading the plugin left the skin applied and the stock
 * appearance unreachable.
 *
 * This writes a copy of the artifact with the teardown retraction removed; run
 * the suite against that copy and it MUST fail:
 *
 *   node negative/drop-teardown-retraction.mjs
 *   $env:DSH_SKIN_LAB_ARTIFACT='negative/dropped-teardown.js'; node verify.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

// The teardown body, matched loosely: the build re-indents every inlined line.
const RETRACTION = /return \(\) => \{\s*layerDispose\?\.\(\)\s*layerDispose = null\s*paintTag\?\.remove\(\)\s*paintTag = null\s*\}/
const found = source.match(new RegExp(RETRACTION, 'g'))?.length ?? 0
if (found !== 1) {
  throw new Error(`control: expected exactly 1 teardown retraction in the artifact, found ${found} — the artifact shape changed, update this control`)
}

const target = join(root, 'negative', 'dropped-teardown.js')
writeFileSync(target, source.replace(RETRACTION, 'return () => {}'))
console.log(`wrote ${target} — teardown no longer retracts the live layer`)
