import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'ltoc-theme'
const listeners = new Set<() => void>()

/** Saved choice first, then the OS preference. Storage can be blocked, so every access is guarded. */
export function initialTheme(): Theme {
  try { const t = localStorage.getItem(KEY); if (t === 'light' || t === 'dark') return t } catch { /* ignore */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** A theme flip changes colour on nearly every element. Without this, every transition fires at once and the switch smears. */
export function applyTheme(t: Theme) {
  const off = document.createElement('style')
  off.textContent = '*,*::before,*::after{transition:none !important}'
  document.head.appendChild(off)
  document.documentElement.dataset.theme = t
  void document.body.offsetHeight // force a synchronous style flush while transitions are off
  // remove only after the new theme has painted, so nothing starts animating mid-switch
  requestAnimationFrame(() => requestAnimationFrame(() => off.remove()))
  try { localStorage.setItem(KEY, t) } catch { /* ignore */ }
  listeners.forEach(l => l())
}
export const toggleTheme = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark')
export const useTheme = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, currentTheme)
