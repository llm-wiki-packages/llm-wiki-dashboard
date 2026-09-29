// The Ask gear's choices, kept per browser like the theme. Each is checked
// against the lists the server offers, so a stale or edited value falls back
// to the default instead of being sent and refused. The key carries a version:
// the first draft kept a free-text prefix that no longer exists.

import { useCallback, useState } from 'react'
import type { AskOptions } from '@dashboard/shared/types'

export interface AskSettings {
  /** Unset means "default": nothing is passed and the harness uses the person's own. */
  model?: string
  effort?: string
  skill: string
  /** An agent name; only sent when the wiki has it enabled. */
  agent?: string
}

const KEY = 'dashboard.ask.v2'

function read(): Partial<AskSettings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AskSettings>
  } catch {
    return {}
  }
}

export function settle(raw: Partial<AskSettings>, opts: AskOptions): AskSettings {
  return {
    model: raw.model && opts.models.includes(raw.model) ? raw.model : undefined,
    effort: raw.effort && opts.efforts.includes(raw.effort) ? raw.effort : undefined,
    skill: raw.skill && opts.skills.includes(raw.skill) ? raw.skill : opts.defaultSkill,
    agent: typeof raw.agent === 'string' && raw.agent ? raw.agent : undefined,
  }
}

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
