// The Ask gear's choices, kept per browser like the theme. Each is checked
// against the lists the server offers, so a stale or edited value falls back
// to the default instead of being sent and refused.

import { useCallback, useState } from 'react'
import type { AskOptions } from '@dashboard/shared/types'

export interface AskSettings {
  model: string
  effort: string
  prefix: string
}

const KEY = 'dashboard.ask'
const PREFIX = /^\/[a-z0-9][a-z0-9-]{0,63}$/

function read(): Partial<AskSettings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AskSettings>
  } catch {
    return {}
  }
}

export function settle(raw: Partial<AskSettings>, opts: AskOptions): AskSettings {
  return {
    model: raw.model && opts.models.includes(raw.model) ? raw.model : opts.defaultModel,
    effort: raw.effort && opts.efforts.includes(raw.effort) ? raw.effort : opts.defaultEffort,
    prefix: raw.prefix && PREFIX.test(raw.prefix) ? raw.prefix : opts.defaultPrefix,
  }
}

export const validPrefix = (v: string) => PREFIX.test(v)

export function useAskSettings(opts: AskOptions | undefined): [AskSettings | undefined, (patch: Partial<AskSettings>) => void] {
  const [raw, setRaw] = useState<Partial<AskSettings>>(read)
  const update = useCallback((patch: Partial<AskSettings>) => {
    setRaw((r) => {
      const next = { ...r, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // blocked storage: the choice lasts this page
      }
      return next
    })
  }, [])
  return [opts ? settle(raw, opts) : undefined, update]
}
