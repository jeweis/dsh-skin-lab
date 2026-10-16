/**
 * Dependency-free build: emit the two package artifacts.
 *
 * No bundler and no npm install. What this does is concatenate the package's own
 * ES modules into the framework's closure-factory format, read off bundles the
 * official preset (`packages/client/tsdown.client.ts`) produced and confirmed
 * against plugins already installed in the running DSH:
 *
 *   window.__ModuleLoader__.load({ id, factory })
 *
 * The factory receives the loader's `require` and returns `module.exports`.
 * Nothing is `import`ed at runtime: `react` comes from the loader's baseline
 * module table, so the artifact cannot trip the client purity gate.
 *
 * Guarantees the build enforces rather than hopes for:
 *
 *   - The only module syntax allowed is `import { a, b } from './x.js'` and
 *     `export const|function`. The graph is walked depth-first, dependencies
 *     emitted first, and any remaining `import`/`export` fails the build — so a
 *     stray `export default` or a package import stops it instead of shipping a
 *     broken bundle.
 *   - Two modules may not declare the same top-level name. Concatenation makes
 *     that a syntax error in the bundle, so the build reports both files instead.
 *   - The entry's three exports must still exist after stripping, or the build
 *     fails rather than emitting a factory that exports nothing.
 *   - The emitted artifact is pure ASCII: every non-ASCII code point becomes a
 *     `\uXXXX` escape, identical inside a string literal and inert inside a
 *     comment. Charset handling leaves the picture entirely.
 *
 * Usage: node scripts/build.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const entry = join(root, 'src', 'client.js')

// Matches an import written across several lines too: `[\s\S]*?` is lazy, and the
// trailing `from '…'` anchors the end, so it cannot swallow a second statement.
const RELATIVE_IMPORT = /^import\s*\{([\s\S]*?)\}\s*from\s*'(\.[^']*)'\s*$/gm

/**
 * Walk the entry's own module graph, dependencies first.
 * @param {string} file - module to visit.
 * @param {Set<string>} seen - modules already queued.
 * @param {string[]} order - emission order.
 */
function collect(file, seen, order) {
  for (const match of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
    const dependency = resolve(dirname(file), match[2])
    if (seen.has(dependency)) continue
    seen.add(dependency)
    collect(dependency, seen, order)
  }
  order.push(file)
}

/**
 * Remove module syntax so the module can be concatenated into one function body.
 * @param {string} text - module source.
 * @param {string} file - path, for the error message.
 * @returns {string} the body.
 */
function strip(text, file) {
  const out = text
    .replace(RELATIVE_IMPORT, '')
    .replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  if (/^\s*(?:import|export)\s/m.test(out)) {
    throw new Error(`build: unsupported module syntax survived in ${file} — only relative \`import { … } from './x.js'\` and \`export const|function\` are supported`)
  }
  return out.trim()
}

/** Escape every non-ASCII code point so the artifact never depends on a charset. */
function toAscii(text) {
  return text.replace(/[^\x00-\x7f]/g, (char) => {
    const point = char.codePointAt(0)
    return point > 0xffff
      ? `\\u{${point.toString(16)}}`
      : `\\u${point.toString(16).padStart(4, '0')}`
  })
}

const order = []
collect(entry, new Set(), order)

const sources = new Map(order.map((file) => [file, readFileSync(file, 'utf8')]))

// Concatenation puts every module in one function body, so a repeated top-level
// name is a parse error in the artifact. Catch it here, naming both files.
const declared = new Map()
for (const file of order) {
  for (const match of sources.get(file).matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    const name = match[1]
    const previous = declared.get(name)
    if (previous !== undefined) {
      throw new Error(`build: "${name}" is declared in both ${previous} and ${file} — the concatenated bundle would not parse`)
    }
    declared.set(name, file)
  }
}

const body = order.map((file) => strip(sources.get(file), file)).join('\n\n')

for (const required of [/^const name = /m, /^const inject = /m, /^function apply\(/m]) {
  if (!required.test(body)) throw new Error(`build: the entry module no longer declares ${String(required)}`)
}

const indented = body.split('\n').map((line) => (line === '' ? line : `\t\t${line}`)).join('\n')

const client = toAscii(`window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${indented}
\t\texports.apply = apply;
\t\texports.inject = inject;
\t\texports.name = name;
\t\treturn module.exports;
\t}
});
`)

if (!/^[\x00-\x7f]*$/.test(client)) throw new Error('build: artifact is not pure ASCII')

// Parse the result before shipping it. `vm.Script` compiles a real script (not a
// function body) without running it, and it reports the failing line against the
// filename below — so an unbalanced paren is a build error with a location, not a
// blank page in the app.
try {
  new Script(client, { filename: 'lib/client.js' })
} catch (error) {
  const where = error instanceof Error ? error.stack?.split('\n').slice(0, 2).join(' ') : String(error)
  throw new Error(`build: the generated bundle does not parse — ${where ?? String(error)}`)
}

/** The node half: the skin is browser-only, so this half only satisfies the row. */
const host = `export const name = ${JSON.stringify(pkg.name)}
export const inject = []
export function apply() {}
`

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'client.js'), client)
writeFileSync(join(root, 'lib', 'index.js'), host)
const modules = order.map((file) => file.slice(root.length + 1)).join(' + ')
console.log(`built lib/client.js (${String(client.length)} bytes, pure ASCII) from ${modules}`)
console.log(`built lib/index.js`)
