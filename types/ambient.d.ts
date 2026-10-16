/**
 * Ambient surface for the two things the browser half receives instead of
 * importing: the loader's `require`, and the baseline `react` entry in the
 * loader's module table.
 *
 * The installed profile ships no `@types/react`, and React's own type surface is
 * not what this probe exists to check — the framework APIs are — so `react` is
 * declared as the minimal shape `src/client.js` uses. `createElement` returns
 * `any` so that the probe never fails on JSX.Element subtleties that the real
 * runtime resolves at render time.
 */
declare module 'react' {
  export function createElement(...args: any[]): any
  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}

/** The loader hands the bundle `require`; only the baseline table is reachable. */
declare const require: (id: 'react') => typeof import('react')

/**
 * Chromium's screen eyedropper (Electron has it; other runtimes do not), so the
 * declaration is optional and the plugin guards with a `typeof` check.
 */
interface EyeDropperInstance {
  open(options?: { signal?: AbortSignal }): Promise<{ readonly sRGBHex: string }>
}
declare var EyeDropper: (new () => EyeDropperInstance) | undefined
