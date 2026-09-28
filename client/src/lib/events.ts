// The SSE stream: when a run touches a wiki, the screens it changed refetch.
// Everything else (the trace rows) is kept in a small ring for a future log
// panel; nothing renders it yet.

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DashboardEvent, TraceRow } from '@dashboard/shared/types'

export interface LiveState {
  connected: boolean
  lastEventAt: string | null
  recent: Array<{ wiki: string; row: TraceRow }>
}

/** While `paused` (a replay is running), a run's `changed` hint does not refetch the screens. */
export function useLiveEvents(paused = false): LiveState {
  const qc = useQueryClient()
  const [state, setState] = useState<LiveState>({ connected: false, lastEventAt: null, recent: [] })
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    const es = new EventSource('/api/events', { withCredentials: true })
    const onAny = (e: MessageEvent<string>) => {
      const ev = JSON.parse(e.data) as DashboardEvent
      setState((s) => {
        const next: LiveState = { ...s, connected: true, lastEventAt: new Date().toISOString() }
        if (ev.type === 'trace') next.recent = [{ wiki: ev.wiki, row: ev.row }, ...s.recent].slice(0, 50)
        return next
      })
      if (ev.type === 'changed' && !pausedRef.current) {
        for (const view of ev.views) void qc.invalidateQueries({ queryKey: ['wiki', ev.wiki, view] })
        void qc.invalidateQueries({ queryKey: ['wikis'] })
      }
    }
    for (const t of ['hello', 'trace', 'changed', 'heartbeat']) es.addEventListener(t, onAny as EventListener)
    es.onerror = () => setState((s) => ({ ...s, connected: false }))
    return () => es.close()
  }, [qc])

  return state
}
