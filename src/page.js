/**
 * The settings page — presentation only.
 *
 * Split out of `client.js` so the plugin wiring stays about layer ownership and the
 * page can be designed as one piece. It never touches `ctx`: everything it needs
 * arrives as props from the inject face.
 *
 * Two things are deliberate rather than incidental:
 *
 *   - **The theme cards are miniature applications, not wallpaper thumbnails.** Each
 *     preview paints a tiny sidebar, an active-nav pill, content bars and an accent
 *     button *in that theme's own tokens*, over that theme's artwork. The card shows
 *     what the theme does to the interface, which a crop of a JPEG cannot.
 *   - **The page styles itself with the palette it is applying.** Every colour here
 *     is a `--dsw-alias-*` token, so the settings page is themed by the theme being
 *     chosen — the most direct possible feedback while picking one. `color-mix()`
 *     supplies the tints (soft rings, hover washes) that a token layer cannot express.
 */
import { hexToHsv, hsvToHex, hueFromPoint, normalizeHex, rgba, saturationValueFromPoint } from './color.js'
import {
  BACKGROUND_MODES,
  DEFAULT_BACKGROUND,
  DEFAULT_STYLE,
  ELEVATIONS,
  GLASS_MODES,
  IMAGE_SIZES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_URL,
  MAX_UPLOAD_BYTES,
  SHRINK_TARGET,
  TRANSPARENCY_RANGES,
  isPainted,
  sanitizeImageUrl,
} from './appearance.js'
import { BACKGROUND_MAX_EDGE, LOGO_MAX_EDGE, needsShrink, shrinkToBudget } from './shrink.js'
import { paletteById, palettes } from './palettes.js'
import { backgroundLabels, matchTheme, themeSettings, themes } from './themes.js'
import { embeddedBackgrounds } from './assets.js'

const React = require('react')

/** Shorthand for the React element factory. */
const el = React.createElement

/**
 * A byte count the way a person reads it: whole KB under a megabyte, one decimal above.
 * @param {number} bytes - the size.
 * @returns {string} e.g. `412 KB` or `1.4 MB`.
 */
const sizeText = (bytes) => (
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${String(Math.round(bytes / 1024))} KB`
)

/**
 * The event shapes the page's own callbacks receive. They are typed structurally
 * rather than as DOM events because the elements are built through `el`, which has
 * no contextual typing to offer, and because `verify.mjs` fires plain objects of
 * exactly this shape — so the annotation is the contract both sides honour.
 *
 * @typedef {{ target: { value: string, files?: FileList | null } }} ChangeLike
 * @typedef {{ h: number, s: number, v: number }} Hsv
 * @typedef {{
 *   pointerId: number,
 *   clientX: number,
 *   clientY: number,
 *   currentTarget: {
 *     getBoundingClientRect: () => { left: number, top: number, width: number, height: number },
 *     setPointerCapture?: (pointerId: number) => void,
 *     hasPointerCapture?: (pointerId: number) => boolean,
 *   },
 * }} PointerLike
 * @typedef {ReturnType<typeof import('./appearance.js').parseSettings>} Settings
 * @typedef {{
 *   get: () => Settings,
 *   apply: (patch: Record<string, unknown>) => void,
 *   reset: () => void,
 *   persistFailed: () => boolean,
 *   scheme: () => 'light' | 'dark',
 *   subscribe: (listener: () => void) => () => void,
 * }} ThemesFace
 */

/** Display names for the model's enumerated values. */
/** @type {Record<string, string>} */
const MODE_LABELS = { theme: '跟随主题', color: '纯色', gradient: '渐变', image: '图片' }
/** @type {Record<string, string>} */
const SIZE_LABELS = { cover: '铺满', contain: '完整', tile: '平铺' }
/** @type {Record<string, string>} */
const RANGE_LABELS = { base: '仅主背景', panel: '含侧栏与卡片', glass: '玻璃（含浮层）' }
/** @type {Record<string, string>} */
const GLASS_LABELS = { default: '跟随官方', on: '开启模糊', off: '关闭模糊' }
/** @type {Record<string, string>} */
const ELEVATION_LABELS = { default: '跟随官方', soft: '柔和浮起', flat: '扁平（仅描边）', glow: '品牌光晕' }

/**
 * The order the built-in backgrounds are offered in. The themes' own order comes
 * first, then anything embedded that no theme names — alphabetical order would
 * interleave the abstract and illustrated families and read as arbitrary.
 * @type {string[]}
 */
const assetKeys = [...new Set([
  ...themes.map((theme) => String(theme.background.asset ?? '')),
  ...Object.keys(embeddedBackgrounds),
])].filter((key) => key in embeddedBackgrounds)

/** The page's own chrome, entirely in alias tokens. */
export const pageCss = [
  // Layout.
  '.dsh-theme-page{display:flex;flex-direction:column;gap:24px;max-width:768px;padding:2px 2px 20px}',
  '.dsh-theme-group{display:flex;flex-direction:column;gap:13px}',
  '.dsh-theme-head{display:flex;align-items:center;gap:9px}',
  '.dsh-theme-head-bar{width:3px;height:13px;border-radius:2px;background:var(--dsw-alias-brand-primary)}',
  '.dsh-theme-head-text{font-size:13px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
  '.dsh-theme-sub-text{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}',
  '.dsh-theme-rule{flex:1;height:1px;background:var(--dsw-alias-border-l1)}',
  '.dsh-theme-hint{margin-top:-5px;margin-left:12px;font-size:11px;line-height:1.65;color:var(--dsw-alias-label-tertiary)}',
  // Focus: one ring for everything interactive on the page.
  '.dsh-theme-page button:focus-visible,.dsh-theme-page input:focus-visible,.dsh-theme-page select:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:2px}',
  // Theme gallery.
  '.dsh-theme-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(182px,1fr));gap:12px}',
  '.dsh-theme-card{display:flex;flex-direction:column;gap:9px;padding:9px;cursor:pointer;text-align:left;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);transition:border-color .15s,box-shadow .15s,transform .15s}',
  '.dsh-theme-card:hover{border-color:var(--dsw-alias-border-l3);transform:translateY(-1px)}',
  '.dsh-theme-card[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,transparent)}',
  // The miniature application inside a card.
  '.dsh-theme-shot{position:relative;display:block;aspect-ratio:16/10;border-radius:9px;overflow:hidden;background-size:cover;background-position:center;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}',
  '.dsh-theme-shot-side{position:absolute;top:0;bottom:0;left:0;width:28%;display:flex;flex-direction:column;gap:5px;padding:9px 7px}',
  '.dsh-theme-shot-mark{width:9px;height:9px;border-radius:3px;margin-bottom:2px}',
  '.dsh-theme-shot-pill{width:88%;height:7px;border-radius:4px}',
  '.dsh-theme-shot-bar{width:72%;height:5px;border-radius:3px}',
  '.dsh-theme-shot-main{position:absolute;top:0;right:0;bottom:0;left:28%;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:9px 10px}',
  '.dsh-theme-shot-card{display:flex;flex-direction:column;gap:5px;padding:8px;border-radius:6px}',
  '.dsh-theme-shot-title{width:52%;height:6px;border-radius:3px}',
  '.dsh-theme-shot-line{width:86%;height:4px;border-radius:2px}',
  '.dsh-theme-shot-btn{align-self:flex-end;width:26%;height:8px;border-radius:4px}',
  '.dsh-theme-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}',
  '.dsh-theme-card-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary)}',
  '.dsh-theme-card[aria-pressed="true"] .dsh-theme-card-label{color:var(--dsw-alias-brand-primary)}',
  // Palette pills.
  '.dsh-theme-palettes{display:flex;flex-wrap:wrap;gap:8px}',
  '.dsh-theme-palette,.dsh-theme-palette-official{display:inline-flex;align-items:center;gap:9px;padding:6px 13px 6px 9px;cursor:pointer;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-secondary);transition:border-color .15s,background .15s,color .15s}',
  '.dsh-theme-palette-official{padding:6px 13px}',
  '.dsh-theme-palette:hover,.dsh-theme-palette-official:hover{border-color:var(--dsw-alias-border-l3)}',
  '.dsh-theme-palette[aria-pressed="true"],.dsh-theme-palette-official[aria-pressed="true"]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-brand-primary)}',
  '.dsh-theme-sw{display:inline-flex;gap:3px}',
  '.dsh-theme-sw-dot{width:11px;height:11px;border-radius:50%;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}',
  '.dsh-theme-palette-label{font-size:12px}',
  // Segmented control.
  '.dsh-theme-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-theme-tab{padding:6px 15px;cursor:pointer;border:none;border-radius:8px;background:transparent;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);transition:background .15s,color .15s}',
  '.dsh-theme-tab:hover{color:var(--dsw-alias-label-primary)}',
  '.dsh-theme-tab[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary);font-weight:500}',
  // Background tiles.
  '.dsh-theme-assets{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}',
  '.dsh-theme-asset{display:flex;flex-direction:column;gap:6px;padding:0;cursor:pointer;text-align:left;border:none;background:transparent}',
  '.dsh-theme-asset-img{display:block;aspect-ratio:16/10;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background-size:cover;background-position:center;transition:border-color .15s,box-shadow .15s}',
  '.dsh-theme-asset:hover .dsh-theme-asset-img{border-color:var(--dsw-alias-border-l3)}',
  '.dsh-theme-asset[aria-pressed="true"] .dsh-theme-asset-img{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent)}',
  '.dsh-theme-asset-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-theme-asset[aria-pressed="true"] .dsh-theme-asset-label{color:var(--dsw-alias-brand-primary)}',
  // Fields, rows, inputs.
  '.dsh-theme-field{display:flex;flex-direction:column;gap:7px}',
  '.dsh-theme-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
  '.dsh-theme-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}',
  '.dsh-theme-setting{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 13px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-theme-text,.dsh-theme-select,.dsh-theme-hex,.dsh-theme-file{padding:7px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;transition:border-color .15s,box-shadow .15s}',
  '.dsh-theme-text:focus,.dsh-theme-select:focus,.dsh-theme-hex:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}',
  '.dsh-theme-hex{width:94px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}',
  '.dsh-theme-file{flex:1;min-width:190px}',
  '.dsh-theme-file::file-selector-button{margin-right:9px;padding:5px 11px;cursor:pointer;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
  '.dsh-theme-range{flex:1;min-width:140px;height:20px;cursor:pointer;accent-color:var(--dsw-alias-brand-primary)}',
  '.dsh-theme-value{min-width:46px;font-size:12px;font-variant-numeric:tabular-nums;text-align:right;color:var(--dsw-alias-label-tertiary)}',
  // Picker.
  '.dsh-theme-sv{position:relative;width:200px;height:132px;border-radius:10px;cursor:crosshair;background-image:linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,rgba(255,255,255,0));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent)}',
  '.dsh-theme-hue{position:relative;width:200px;height:14px;border-radius:999px;cursor:pointer;background-image:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent)}',
  '.dsh-theme-knob{position:absolute;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)}',
  '.dsh-theme-eye{padding:6px 11px;cursor:pointer;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;transition:border-color .15s,color .15s}',
  '.dsh-theme-eye:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}',
  '.dsh-theme-preview{height:56px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1)}',
  // Switch.
  '.dsh-theme-switch{position:relative;flex:0 0 auto;width:38px;height:22px;padding:0;cursor:pointer;border:none;border-radius:999px;background:var(--dsw-alias-interactive-bg-active);transition:background .16s}',
  '.dsh-theme-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
  '.dsh-theme-switch-knob{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.28);transition:transform .16s}',
  '.dsh-theme-switch[aria-checked="true"] .dsh-theme-switch-knob{transform:translateX(16px)}',
  // Notices and the reset.
  '.dsh-theme-notice{margin:0;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.55;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}',
  '.dsh-theme-reset{align-self:flex-start;padding:8px 17px;cursor:pointer;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;transition:border-color .15s,background .15s}',
  '.dsh-theme-reset:hover:not(:disabled){border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3)}',
  '.dsh-theme-reset:disabled{opacity:.45;cursor:default}',
].join('')

/** @typedef {{ title: string, hint?: string, sub?: boolean, children?: unknown }} GroupProps */
/**
 * A titled block. `sub` drops the accent bar so a group nested inside another group
 * reads as a level below it rather than as a second section competing with the first.
 * @param {GroupProps} props
 */
function Group(props) {
  return el('div', { className: 'dsh-theme-group' },
    el('div', { className: 'dsh-theme-head' },
      props.sub === true ? null : el('span', { className: 'dsh-theme-head-bar' }),
      el('span', { className: props.sub === true ? 'dsh-theme-sub-text' : 'dsh-theme-head-text' }, props.title),
      el('span', { className: 'dsh-theme-rule' })),
    props.hint === undefined ? null : el('div', { className: 'dsh-theme-hint' }, props.hint),
    props.children)
}

/** @typedef {{ label: string, children?: unknown }} FieldProps */
/** @param {FieldProps} props */
function Field(props) {
  return el('div', { className: 'dsh-theme-field' },
    el('span', { className: 'dsh-theme-field-label' }, props.label),
    props.children)
}

/** A label on the left, its control on the right, on a raised surface. */
/** @param {FieldProps} props */
function Setting(props) {
  return el('div', { className: 'dsh-theme-setting' },
    el('span', { className: 'dsh-theme-field-label' }, props.label),
    props.children)
}

/** @typedef {{ label: string, checked: boolean, onChange: (checked: boolean) => void }} SwitchProps */
/** @param {SwitchProps} props */
function Switch(props) {
  return el(Setting, { label: props.label },
    el('button', {
      className: 'dsh-theme-switch',
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked,
      onClick: () => { props.onChange(!props.checked) },
    }, el('span', { className: 'dsh-theme-switch-knob' })))
}

/** @typedef {{ label: string, value: number, min: number, max: number, suffix?: string, onInput: (value: number) => void }} SliderProps */
/** @param {SliderProps} props */
function Slider(props) {
  return el(Field, { label: props.label },
    el('div', { className: 'dsh-theme-row' },
      el('input', {
        className: 'dsh-theme-range',
        type: 'range',
        min: props.min,
        max: props.max,
        value: props.value,
        onChange: (/** @type {ChangeLike} */ event) => { props.onInput(Number(event.target.value)) },
      }),
      el('span', { className: 'dsh-theme-value' }, `${String(props.value)}${props.suffix ?? ''}`)))
}

/** @typedef {{ value: string, label: string }} Option */
/** @typedef {{ label: string, value: string, options: Option[], onChange: (value: string) => void }} SelectProps */
/** @param {SelectProps} props */
function Select(props) {
  return el(Setting, { label: props.label },
    el('select', {
      className: 'dsh-theme-select',
      value: props.value,
      onChange: (/** @type {ChangeLike} */ event) => { props.onChange(event.target.value) },
    }, props.options.map((option) => el('option', { key: option.value, value: option.value }, option.label))))
}

/** @typedef {{ label: string, value: string, onChange: (value: string) => void }} ColorFieldProps */
/** @param {ColorFieldProps} props */
function ColorField(props) {
  const hsv = hexToHsv(props.value)
  const [text, setText] = React.useState(props.value)
  React.useEffect(() => { setText(props.value) }, [props.value])
  /** @param {Hsv} next */
  const emit = (next) => { props.onChange(hsvToHex(next)) }
  /** @param {PointerLike} event */
  const trackSquare = (event) => {
    const { s, v } = saturationValueFromPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
    emit({ h: hsv.h, s, v })
  }
  /** @param {PointerLike} event */
  const trackHue = (event) => {
    emit({ h: hueFromPoint(event.currentTarget.getBoundingClientRect(), event.clientX), s: hsv.s, v: hsv.v })
  }
  /** @param {(event: PointerLike) => void} track */
  const drag = (track) => ({
    onPointerDown: (/** @type {PointerLike} */ event) => { event.currentTarget.setPointerCapture?.(event.pointerId); track(event) },
    onPointerMove: (/** @type {PointerLike} */ event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId) === true) track(event) },
  })
  /** @type {unknown[]} */
  const controls = [
    el('div', { key: 'sv', className: 'dsh-theme-sv', ...drag(trackSquare) },
      el('span', { className: 'dsh-theme-knob', style: { left: `${String(hsv.s * 100)}%`, top: `${String((1 - hsv.v) * 100)}%`, background: props.value } })),
    el('div', { key: 'hue', className: 'dsh-theme-hue', ...drag(trackHue) },
      el('span', { className: 'dsh-theme-knob', style: { left: `${String((hsv.h / 360) * 100)}%`, top: '50%', background: hsvToHex({ h: hsv.h, s: 1, v: 1 }) } })),
    el('input', {
      key: 'hex',
      className: 'dsh-theme-hex',
      value: text,
      onChange: (/** @type {ChangeLike} */ event) => {
        setText(event.target.value)
        const parsed = normalizeHex(event.target.value)
        if (parsed !== null) props.onChange(parsed)
      },
    }),
  ]
  // The platform eyedropper is Chromium-only, so it is read once and guarded.
  const EyeDropperCtor = globalThis.EyeDropper
  if (typeof EyeDropperCtor === 'function') {
    controls.push(el('button', {
      key: 'eye',
      className: 'dsh-theme-eye',
      type: 'button',
      title: '从屏幕取色',
      onClick: () => {
        // The platform eyedropper rejects on Esc; a cancelled pick must not throw.
        new EyeDropperCtor().open().then((result) => {
          const parsed = normalizeHex(result.sRGBHex)
          if (parsed !== null) props.onChange(parsed)
        }, () => {})
      },
    }, '\u25c9 取色'))
  }
  return el(Field, { label: props.label }, el('div', { className: 'dsh-theme-row' }, controls))
}

/** @typedef {{ source: string, label: string, active: boolean, onSelect: () => void }} AssetProps */
/** @param {AssetProps} props */
function AssetTile(props) {
  return el('button', {
    className: 'dsh-theme-asset',
    type: 'button',
    'aria-pressed': props.active,
    onClick: props.onSelect,
  },
  el('span', { className: 'dsh-theme-asset-img', style: { backgroundImage: `url(${JSON.stringify(props.source)})` } }),
  el('span', { className: 'dsh-theme-asset-label' }, props.label))
}

/** @typedef {{ palette: import('./palettes.js').Palette, active: boolean, onSelect: () => void }} PaletteButtonProps */
/** @param {PaletteButtonProps} props */
function PaletteButton(props) {
  const tokens = props.palette.tokens
  const swatch = (/** @type {string} */ name) => el('span', {
    key: name,
    className: 'dsh-theme-sw-dot',
    style: { background: tokens[name].light },
  })
  return el('button', {
    className: 'dsh-theme-palette',
    type: 'button',
    'aria-pressed': props.active,
    onClick: props.onSelect,
  },
  el('span', { className: 'dsh-theme-sw' },
    swatch('--dsw-alias-bg-base'),
    swatch('--dsw-alias-bg-layer-2'),
    swatch('--dsw-alias-brand-primary'),
    swatch('--dsw-alias-label-primary')),
  el('span', { className: 'dsh-theme-palette-label' }, props.palette.label))
}

/**
 * A miniature of the application, painted in the theme's own tokens over the artwork
 * drawn for the scheme in force. It follows the live scheme rather than a fixed one,
 * because every theme genuinely has both: showing a light-interface card while the
 * application is dark would advertise something the user cannot get.
 *
 * @typedef {{ theme: import('./themes.js').Theme, scheme: 'light' | 'dark', active: boolean, onSelect: () => void }} ThemeCardProps
 * @param {ThemeCardProps} props
 */
function ThemeCard(props) {
  const tokens = paletteById(props.theme.paletteId).tokens
  const mode = props.scheme
  const at = (/** @type {string} */ name, /** @type {number} */ alpha) => rgba(tokens[name][mode], alpha)
  const source = embeddedBackgrounds[props.theme.background.asset ?? '']?.[mode] ?? ''
  const bar = (/** @type {string} */ key, /** @type {string} */ className, /** @type {string} */ name, /** @type {number} */ alpha) => (
    el('span', { key, className, style: { background: at(name, alpha) } })
  )
  return el('button', {
    className: 'dsh-theme-card',
    type: 'button',
    'aria-pressed': props.active,
    onClick: props.onSelect,
  },
  el('span', { className: 'dsh-theme-shot', style: { backgroundImage: `url(${JSON.stringify(source)})` } },
    el('span', { className: 'dsh-theme-shot-side', style: { background: at('--dsw-specific-sidebar-fill', 0.72) } },
      el('span', { className: 'dsh-theme-shot-mark', style: { background: tokens['--dsw-alias-brand-primary'][mode] } }),
      bar('pill', 'dsh-theme-shot-pill', '--dsw-specific-sidebar-nav-item-active', 0.92),
      bar('nav1', 'dsh-theme-shot-bar', '--dsw-alias-label-tertiary', 0.7),
      bar('nav2', 'dsh-theme-shot-bar', '--dsw-alias-label-tertiary', 0.7)),
    el('span', { className: 'dsh-theme-shot-main' },
      el('span', { className: 'dsh-theme-shot-card', style: { background: at('--dsw-alias-bg-layer-3', 0.84) } },
        bar('title', 'dsh-theme-shot-title', '--dsw-alias-label-primary', 0.85),
        bar('line1', 'dsh-theme-shot-line', '--dsw-alias-label-tertiary', 0.62),
        bar('line2', 'dsh-theme-shot-line', '--dsw-alias-label-tertiary', 0.62)),
      el('span', { className: 'dsh-theme-shot-btn', style: { background: tokens['--dsw-alias-brand-primary'][mode] } }))),
  el('span', { className: 'dsh-theme-card-foot' },
    el('span', { className: 'dsh-theme-card-label' }, props.theme.label)))
}

/**
 * The page. It receives the injected face as props: components never see `ctx`.
 * @param {ThemesFace} props
 */
export function ThemesSection(props) {
  const [, rerender] = React.useState(0)
  const [notice, setNotice] = React.useState('')
  const bump = () => rerender((/** @type {number} */ count) => count + 1)
  // The gallery and the thumbnails show the artwork the current scheme paints, so the
  // page has to re-render when the application switches scheme with this page open.
  React.useEffect(() => props.subscribe(bump), [])
  const scheme = props.scheme()
  /** @param {Record<string, unknown>} patch */
  const applyPatch = (patch) => { props.apply(patch); bump() }
  const current = props.get()
  const background = current.background
  const style = current.style
  const activeTheme = matchTheme(current)
  const isOfficial = current.paletteId === 'official'
    && JSON.stringify(background) === JSON.stringify(DEFAULT_BACKGROUND)
    && JSON.stringify(style) === JSON.stringify(DEFAULT_STYLE)
  const customSource = sanitizeImageUrl(background.url)
  const logoSource = sanitizeImageUrl(style.logoImage)

  /**
   * The colour a transparent upload is composited onto before it becomes a JPEG.
   *
   * JPEG has no alpha channel and a canvas left transparent encodes as black, so this is
   * what stops a PNG with transparency from arriving as a black field. The theme's own
   * surface is the least surprising matte; the official palette has no surface of ours to
   * read, so that case falls back to plain chrome.
   *
   * @returns {string} a CSS colour.
   */
  const matteColour = () => {
    if (current.paletteId !== 'official') return paletteById(current.paletteId).tokens['--dsw-alias-bg-base'][scheme]
    return scheme === 'dark' ? '#0c1016' : '#ffffff'
  }

  /**
   * Read a picked file, and re-encode it when it will not fit.
   *
   * The first version refused anything over the cap and told the user to go and compress
   * it themselves, which put a one-frame canvas job on the wrong side of the screen. The
   * file is already decoded here, so the plugin does it — and says what it did, because a
   * re-encoded upload is still something the user should be told about rather than
   * discover. A file that already fits is stored byte for byte and never touched.
   *
   * @param {'background' | 'logo'} kind - which slot the file fills.
   * @returns {(event: ChangeLike) => void} the change handler.
   */
  const pickFile = (kind) => (event) => {
    const file = event.target.files?.[0]
    if (file === undefined) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setNotice(`图片 ${sizeText(file.size)} 超过 ${sizeText(MAX_UPLOAD_BYTES)}，太大无法自动压缩，请改用图片地址。`)
      bump()
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const original = String(reader.result)
      const stored = original
      /** @param {string} url - the accepted source. @param {string} note - what to tell the user. */
      const accept = (url, note) => {
        setNotice(note)
        // A custom source is an override, not a replacement: the built-in key stays
        // chosen underneath, so clearing the override returns to it.
        applyPatch(kind === 'logo' ? { style: { logoImage: url } } : { background: { url, mode: 'image' } })
      }
      if (!needsShrink(file.size, stored.length, SHRINK_TARGET) && sanitizeImageUrl(stored) !== '') {
        accept(stored, '')
        return
      }
      void shrinkToBudget({
        source: stored,
        maxEdge: kind === 'logo' ? LOGO_MAX_EDGE : BACKGROUND_MAX_EDGE,
        budget: SHRINK_TARGET,
        matte: matteColour(),
      }).then((shrunk) => {
        const url = shrunk === null ? '' : sanitizeImageUrl(shrunk.dataUrl)
        if (shrunk === null || url === '') {
          setNotice(
            `图片 ${sizeText(file.size)} 超过上限，自动压缩也没能放进存储预算，请改用图片地址。`,
          )
          bump()
          return
        }
        accept(url, `已自动压缩：${sizeText(file.size)} → ${sizeText(shrunk.bytes)}（${String(shrunk.width)} × ${String(shrunk.height)}）`)
      })
    }
    reader.readAsDataURL(file)
  }

  /** @type {unknown[]} */
  const panels = []
  if (background.mode === 'theme') {
    panels.push(el('div', { className: 'dsh-theme-hint' }, '背景交给主题：只换配色，不画背景。'))
  }
  if (background.mode === 'color') {
    panels.push(el(ColorField, {
      label: '背景色',
      value: background.color,
      onChange: (/** @type {string} */ color) => { applyPatch({ background: { color } }) },
    }))
  }
  if (background.mode === 'gradient') {
    panels.push(el('div', { className: 'dsh-theme-row' },
      el(ColorField, { label: '起始色', value: background.from, onChange: (/** @type {string} */ from) => { applyPatch({ background: { from } }) } }),
      el(ColorField, { label: '结束色', value: background.to, onChange: (/** @type {string} */ to) => { applyPatch({ background: { to } }) } })))
    panels.push(el(Slider, {
      label: '角度',
      value: background.angle,
      min: 0,
      max: 360,
      suffix: '°',
      onInput: (/** @type {number} */ angle) => { applyPatch({ background: { angle } }) },
    }))
    panels.push(el('div', {
      className: 'dsh-theme-preview',
      style: { backgroundImage: `linear-gradient(${String(background.angle)}deg, ${background.from}, ${background.to})` },
    }))
  }
  if (background.mode === 'image') {
    panels.push(el(Group, { title: '内置背景', sub: true, hint: '点一张图作为背景，配色可以另外换。' },
      el('div', { className: 'dsh-theme-assets' },
        assetKeys.map((key) => el(AssetTile, {
          key,
          source: embeddedBackgrounds[key][scheme],
          label: backgroundLabels[key] ?? key,
          active: background.asset === key && customSource === '',
          onSelect: () => { applyPatch({ background: { asset: key, url: '' } }) },
        })))))
    panels.push(el(Field, { label: '自定义图片（只在本机处理，不会上传）' },
      el('div', { className: 'dsh-theme-row' },
        el('input', {
          className: 'dsh-theme-file',
          type: 'file',
          accept: 'image/*',
          onChange: pickFile('background'),
        }),
        el('input', {
          className: 'dsh-theme-text',
          placeholder: '或粘贴 https / data:image 地址',
          value: customSource,
          onChange: (/** @type {ChangeLike} */ event) => {
            const value = event.target.value.trim()
            if (value === '') {
              applyPatch({ background: { url: '' } })
              return
            }
            if (sanitizeImageUrl(value) === '') {
              // A pasted `data:` address has no file behind it and an https address has no
              // bytes on this side at all, so neither can be re-encoded here. Point at the
              // path that does compress rather than leaving the user at a dead end.
              setNotice(value.startsWith('data:image/') && value.length > MAX_IMAGE_URL
                ? '这个 data: 地址太长，超过存储预算，无法在这里重新编码；请改用文件上传，上传会自动压缩。'
                : '地址不被接受：只支持 https、data:image 和 blob，且不能含引号或反斜杠。')
              bump()
              return
            }
            setNotice('')
            applyPatch({ background: { url: value } })
          },
        }))))
    panels.push(el('div', { className: 'dsh-theme-row' },
      el(Select, {
        label: '铺满方式',
        value: background.size,
        options: IMAGE_SIZES.map((size) => ({ value: size, label: SIZE_LABELS[size] })),
        onChange: (/** @type {string} */ size) => { applyPatch({ background: { size } }) },
      }),
      el(Slider, {
        label: '遮罩浓度（30 为自动）',
        value: background.veil,
        min: 0,
        max: 85,
        suffix: '%',
        onInput: (/** @type {number} */ veil) => { applyPatch({ background: { veil } }) },
      })))
    panels.push(el('div', { className: 'dsh-theme-hint' }, '遮罩会自动适配：按图片明暗决定强度，浅色模式下的深色图自动提亮、深色模式下的浅色图自动压深，所以一张图两种模式都可用。这里是微调，30 表示不干预。'))
  }
  if (isPainted(background)) {
    panels.push(el(Select, {
      label: '透明范围',
      value: background.range,
      options: TRANSPARENCY_RANGES.map((range) => ({ value: range, label: RANGE_LABELS[range] })),
      onChange: (/** @type {string} */ range) => { applyPatch({ background: { range } }) },
    }))
  }

  return el('div', { className: 'dsh-theme-page' },
    el(Group, { title: '主题', hint: '配色 + 背景图 + 风格元素。下面是内置组合，也可以自己换任意一轴。' },
      el('div', { className: 'dsh-theme-gallery' },
        themes.map((theme) => el(ThemeCard, {
          key: theme.id,
          theme,
          scheme,
          active: activeTheme === theme.id,
          onSelect: () => { applyPatch(themeSettings(theme)) },
        })))),
    el(Group, { title: '配色 Palette' },
      el('div', { className: 'dsh-theme-palettes' },
        palettes.map((palette) => el(PaletteButton, {
          key: palette.id,
          palette,
          active: current.paletteId === palette.id,
          onSelect: () => { applyPatch({ paletteId: palette.id }) },
        })),
        el('button', {
          className: 'dsh-theme-palette-official',
          type: 'button',
          'aria-pressed': current.paletteId === 'official',
          onClick: () => { applyPatch({ paletteId: 'official' }) },
        }, el('span', { className: 'dsh-theme-palette-label' }, '官方配色')))),
    el(Group, { title: '背景 Background' },
      el('div', { className: 'dsh-theme-seg' },
        BACKGROUND_MODES.map((mode) => el('button', {
          key: mode,
          className: 'dsh-theme-tab',
          type: 'button',
          'aria-pressed': background.mode === mode,
          onClick: () => { applyPatch({ background: { mode } }) },
        }, MODE_LABELS[mode]))),
      panels),
    el(Group, { title: '风格元素 Elements', hint: '不改变配色的结构性外观。' },
      el(Switch, {
        label: '左上角 Logo 跟随强调色',
        checked: style.tintLogo,
        onChange: (/** @type {boolean} */ tintLogo) => { applyPatch({ style: { tintLogo } }) },
      }),
      el(Switch, {
        label: '隐藏字标（只留 Logo）',
        checked: style.hideWordmark,
        onChange: (/** @type {boolean} */ hideWordmark) => { applyPatch({ style: { hideWordmark } }) },
      }),
      el(Setting, { label: '自定义 Logo（替换左上角图标）' },
        el('div', { className: 'dsh-theme-row' },
          el('input', {
            className: 'dsh-theme-logofile',
            type: 'file',
            accept: 'image/*',
            onChange: pickFile('logo'),
          }),
          logoSource === ''
            ? null
            : el('button', {
              className: 'dsh-theme-eye',
              type: 'button',
              onClick: () => { applyPatch({ style: { logoImage: '' } }) },
            }, '清除'))),
      el(Select, {
        label: '玻璃质感（浮层模糊）',
        value: style.glass,
        options: GLASS_MODES.map((mode) => ({ value: mode, label: GLASS_LABELS[mode] })),
        onChange: (/** @type {string} */ glass) => { applyPatch({ style: { glass } }) },
      }),
      el(Select, {
        label: '阴影',
        value: style.elevation,
        options: ELEVATIONS.map((elevation) => ({ value: elevation, label: ELEVATION_LABELS[elevation] })),
        onChange: (/** @type {string} */ elevation) => { applyPatch({ style: { elevation } }) },
      })),
    notice === '' ? null : el('p', { className: 'dsh-theme-notice' }, notice),
    props.persistFailed() ? el('p', { className: 'dsh-theme-notice' }, '本地存储已满，这套外观本次生效，但重启后不会保留。') : null,
    el('button', {
      className: 'dsh-theme-reset',
      type: 'button',
      disabled: isOfficial,
      onClick: () => { setNotice(''); props.reset(); bump() },
    }, '恢复官方外观 Restore official'))
}
