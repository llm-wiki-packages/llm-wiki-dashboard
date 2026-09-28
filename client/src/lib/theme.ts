// Theme and mode, kept per browser. A theme is a block of token overrides in
// theme.css; a mode is light or dark, or "system" which follows the OS. The
// resolved mode is what lands on <html>, so CSS never has to ask the OS.
// index.html applies the stored choice before the first paint.

import { useEffect, useState } from 'react'

export const THEMES = [
  { id: 'paper', name: 'Paper', hint: 'warm, serif headings' },
  { id: 'slate', name: 'Slate', hint: 'cool, sans headings' },
  { id: 'sage', name: 'Sage', hint: 'green paper, terracotta' },
] as const
export type ThemeId = (typeof THEMES)[number]['id']
export type Mode = 'system' | 'light' | 'dark'

const THEME_KEY = 'dashboard.theme'
const MODE_KEY = 'dashboard.mode'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private window or blocked storage: the choice lasts the session
  }
}

const isTheme = (v: string | null): v is ThemeId => THEMES.some((t) => t.id === v)
const isMode = (v: string | null): v is Mode => v === 'system' || v === 'light' || v === 'dark'

export function resolveMode(mode: Mode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function apply(theme: ThemeId, mode: Mode): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.mode = resolveMode(mode)
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const v = read(THEME_KEY)
    return isTheme(v) ? v : 'paper'
  })
  const [mode, setModeState] = useState<Mode>(() => {
    const v = read(MODE_KEY)
    return isMode(v) ? v : 'system'
  })

  useEffect(() => {
    apply(theme, mode)
    if (mode !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => apply(theme, mode)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme, mode])

  return {
    theme,
    mode,
    resolved: resolveMode(mode),
    setTheme: (t: ThemeId) => {
      write(THEME_KEY, t)
      setThemeState(t)
    },
    setMode: (m: Mode) => {
      write(MODE_KEY, m)
      setModeState(m)
    },
  }
}
