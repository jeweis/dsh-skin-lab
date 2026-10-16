/**
 * Shrink — bringing a picked image inside the storage budget.
 *
 * A wallpaper has to live as a `data:` URL inside `localStorage`, which tops out near
 * 5 MB for the whole origin, so an image genuinely has a ceiling and a modern phone photo
 * is over it. The first version refused the file and told the user to go and compress it
 * themselves. That was the wrong answer: the picture is already decoded in this page, and
 * a canvas re-encode costs one frame of work.
 *
 * The split here is deliberate. `dataUrlBytes` and `planSteps` are pure and are what the
 * suite pins down; `loadImage` and `encodeWithCanvas` are the only parts that need a
 * browser, and they are kept thin enough to read in one sitting.
 *
 * Two behaviours worth stating, because they are what make this safe to do silently:
 *
 *   - **It only runs when it has to.** A file that already fits is stored byte for byte,
 *     so a small upload never loses quality to a re-encode.
 *   - **It reports what it did.** A re-encoded upload still gets a notice with the before
 *     and after size, because "why does my picture look different" is a question the
 *     plugin should answer before it is asked.
 */
import { MAX_IMAGE_BYTES } from './appearance.js'

/**
 * Longest edge a stored wallpaper keeps. Beyond this a canvas buys bytes, not pixels: the
 * artwork is painted with `background-attachment: fixed` and `cover`, so a 4K screenshot
 * is downscaled by the compositor anyway.
 */
export const BACKGROUND_MAX_EDGE = 2560

/**
 * Longest edge a logo keeps. Generous on purpose — the slot is 24x24 CSS pixels, but a
 * HiDPI display and a non-square source both want headroom.
 */
export const LOGO_MAX_EDGE = 256

/**
 * The encodes tried in order, largest and best first. Each rung is a whole downscale, so
 * the ladder is short on purpose. The last rung is small enough that any photograph a
 * browser can decode lands inside the budget — if even that misses, the caller refuses,
 * which is the honest outcome rather than storing something oversized.
 *
 * @type {Array<{ scale: number, quality: number }>}
 */
export const SHRINK_STEPS = [
  { scale: 1, quality: 0.86 },
  { scale: 0.8, quality: 0.82 },
  { scale: 0.65, quality: 0.78 },
  { scale: 0.5, quality: 0.74 },
  { scale: 0.38, quality: 0.7 },
  { scale: 0.28, quality: 0.66 },
  { scale: 0.2, quality: 0.62 },
  { scale: 0.14, quality: 0.58 },
]

/**
 * The bytes a data URL actually carries, as opposed to how many characters it costs.
 *
 * Worth having because the two differ by a third: base64 spends 4 characters on every 3
 * bytes, so a file that looks like it fits can still be over the cap. The user-facing
 * message wants bytes; the storage check wants characters.
 *
 * @param {string} dataUrl - a `data:` URL.
 * @returns {number} decoded payload size in bytes.
 */
export function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const payload = dataUrl.length - comma - 1
  return dataUrl.slice(0, comma).includes(';base64') ? Math.floor((payload * 3) / 4) : payload
}

/**
 * The re-encodes to attempt for a source of this size, in order.
 *
 * Separated from the encoding itself so the ladder can be checked without a canvas: what
 * matters is that it starts at the cap or below, never upscales, and strictly descends.
 *
 * @param {number} width - source width in pixels.
 * @param {number} height - source height in pixels.
 * @param {number} maxEdge - longest edge the first attempt may use.
 * @returns {Array<{ width: number, height: number, quality: number }>} ordered attempts.
 */
export function planSteps(width, height, maxEdge) {
  const longest = Math.max(width, height)
  if (!Number.isFinite(longest) || longest <= 0) return []
  /** @type {Array<{ width: number, height: number, quality: number }>} */
  const steps = []
  for (const step of SHRINK_STEPS) {
    // `Math.min(1, …)` is what keeps a small source from being upscaled: a 400px logo
    // asked for at 2560 would otherwise be enlarged, which adds bytes and no detail.
    const scale = Math.min(1, (maxEdge * step.scale) / longest)
    const next = {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: step.quality,
    }
    const previous = steps[steps.length - 1]
    // A source already inside the cap produces the same dimensions at every scale, so the
    // repeats collapse: re-encoding identical pixels at a lower quality buys nothing.
    if (previous !== undefined && previous.width === next.width && previous.height === next.height) continue
    steps.push(next)
  }
  return steps
}

/**
 * Decode a source into something drawable.
 * @param {string} source - a data URL or object URL.
 * @returns {Promise<HTMLImageElement | null>} the decoded image, or `null`.
 */
function loadImage(source) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => { resolve(image) }
    // A file that is not really an image lands here rather than throwing, which is what
    // lets a corrupt upload fall back to the plain refusal.
    image.onerror = () => { resolve(null) }
    image.src = source
  })
}

/**
 * Re-encode one rung.
 *
 * The matte is not decoration. JPEG has no alpha channel and a canvas left transparent
 * encodes as black, so a transparent PNG uploaded as a wallpaper would come back with a
 * black field behind it. Filling with the theme's own surface first is the least
 * surprising composite and costs nothing.
 *
 * @param {HTMLImageElement} image - the decoded source.
 * @param {{ width: number, height: number, quality: number }} step - the rung to encode.
 * @param {string} matte - a CSS colour to composite onto.
 * @returns {string} a JPEG data URL, or `''` when the canvas is unavailable.
 */
function encodeWithCanvas(image, step, matte) {
  const canvas = document.createElement('canvas')
  canvas.width = step.width
  canvas.height = step.height
  const context = canvas.getContext('2d')
  if (context === null) return ''
  context.fillStyle = matte
  context.fillRect(0, 0, step.width, step.height)
  context.drawImage(image, 0, 0, step.width, step.height)
  return canvas.toDataURL('image/jpeg', step.quality)
}

/**
 * Re-encode `source` until it fits `budget`, or give up.
 *
 * @param {object} options - the request.
 * @param {string} options.source - a data URL to decode and re-encode.
 * @param {number} options.maxEdge - longest edge the first attempt may use.
 * @param {number} options.budget - maximum data URL length, in characters.
 * @param {string} options.matte - CSS colour composited under the image.
 * @returns {Promise<{ dataUrl: string, bytes: number, width: number, height: number } | null>}
 *   the first attempt that fits, or `null` when none does.
 */
export async function shrinkToBudget({ source, maxEdge, budget, matte }) {
  const image = await loadImage(source)
  if (image === null) return null
  for (const step of planSteps(image.width, image.height, maxEdge)) {
    const dataUrl = encodeWithCanvas(image, step, matte)
    if (dataUrl === '' || dataUrl.length > budget) continue
    return { dataUrl, bytes: dataUrlBytes(dataUrl), width: step.width, height: step.height }
  }
  return null
}

/**
 * Whether a file needs a re-encode, given both its own size and the data URL it produced.
 *
 * The file size is the cheap early answer, but a file can be small and still decode to an
 * unexpectedly long URL, so the URL length is checked as well.
 *
 * @param {number} fileBytes - the picked file's size.
 * @param {number} urlLength - the length of the data URL read from it.
 * @param {number} budget - the target data URL length.
 * @returns {boolean} whether to re-encode.
 */
export function needsShrink(fileBytes, urlLength, budget) {
  return fileBytes > MAX_IMAGE_BYTES || urlLength > budget
}

/** Test-only surface, kept last so the declarations it names are already evaluated. */
export const __shrinkInternals = { loadImage, encodeWithCanvas }
