// Small per-browser switches. Each has a default the caller chooses, and a
// stored choice wins over it once the viewer flips it.

import { useCallback, useState } from 'react'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function useSwitch(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [stored, setStored] = useState(() => read(key))
  const set = useCallback(
    (v: boolean) => {
      setStored(v ? '1' : '0')
      try {
        localStorage.setItem(key, v ? '1' : '0')
      } catch {
        // blocked storage: the choice lasts this page
      }
    },
    [key],
  )
  return [stored === null ? fallback : stored === '1', set]
}
