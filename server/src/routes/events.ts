// One SSE stream. It carries trace rows as they land in each wiki's log, a
// `changed` hint so the client refetches the views a run touched, and a
// heartbeat so proxies keep the connection open.

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { DashboardEvent, TraceRow, ViewName } from '@dashboard/shared/types'
import type { Source } from '../data/source.js'
import { TraceTail } from '../data/trace.js'

type Listener = (ev: DashboardEvent) => void

/** Which screens a CLI verb's run can change. */
function viewsTouched(argv: string[]): ViewName[] {
  const [a, b] = argv
  if (a === 'pipeline') return ['today', 'new', 'fleet']
  if (a === 'schedule' || a === 'op') return ['today', 'fleet', 'briefings']
  if (a === 'page' && b !== 'read' && b !== 'ls') return ['today', 'new', 'briefings']
  if (a === 'git' && b !== 'log' && b !== 'changed') return ['today', 'new']
  return []
}

export class EventHub {
  private listeners = new Set<Listener>()
  private tail: TraceTail
  private pending = new Map<string, Set<ViewName>>()
  private flush: NodeJS.Timeout | null = null

  constructor(private readonly source: Source) {
    this.tail = new TraceTail((wiki, row) => this.onTrace(wiki, row))
  }

  async start(): Promise<void> {
    if (this.source.kind !== 'live') return
    for (const r of await this.source.roots()) await this.tail.add(r.key, r.path)
  }

  stop(): void {
    this.tail.close()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(ev: DashboardEvent): void {
    for (const fn of this.listeners) fn(ev)
  }

  private onTrace(wiki: string, row: TraceRow): void {
    this.emit({ type: 'trace', wiki, row })
    const views = viewsTouched(row.argv ?? [])
    if (!views.length) return
    const set = this.pending.get(wiki) ?? new Set<ViewName>()
    for (const v of views) set.add(v)
    this.pending.set(wiki, set)
    // Coalesce: one run dispatches many verbs in a burst.
    if (!this.flush)
      this.flush = setTimeout(() => {
        this.flush = null
        for (const [w, vs] of this.pending)
          this.emit({ type: 'changed', wiki: w, views: [...vs] })
        this.pending.clear()
      }, 1500)
  }
}

export function eventRoutes(hub: EventHub): Hono {
  const app = new Hono()
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const send = (ev: DashboardEvent) => stream.writeSSE({ data: JSON.stringify(ev), event: ev.type })
      await send({ type: 'hello', now: new Date().toISOString(), source: hub['source'].kind })
      const off = hub.subscribe((ev) => void send(ev))
      const beat = setInterval(() => void send({ type: 'heartbeat', now: new Date().toISOString() }), 25_000)
      let open = true
      stream.onAbort(() => {
        open = false
        off()
        clearInterval(beat)
      })
      while (open) await stream.sleep(1000)
    }),
  )
  return app
}
