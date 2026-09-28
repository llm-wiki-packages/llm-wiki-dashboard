// Replay: a clock that walks a recorded day. The screens do not know about
// it; the query hooks read the instant from here and ask the server for the
// view as of then, so a replayed screen is the same screen with older data.
// Two contexts, because the clock ticks ten times a second and only the bar
// needs that; the instant the queries use moves only when an event is crossed.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ReplayDay, ReplayDays, ReplayEvent } from '@dashboard/shared/types'
import { setClockOverride } from './format'

export const SPEEDS = [
  { x: 60, label: '1 min/s' },
  { x: 300, label: '5 min/s' },
  { x: 1200, label: '20 min/s' },
  { x: 3600, label: '1 h/s' },
] as const

const TICK_MS = 100
/** A quiet stretch longer than this is skipped, landing a minute before the next event. */
const SKIP_MS = 20 * 60_000
/** The screens refresh at least this often in replay time, so "working now" can wind down. */
const STEP_MS = 15 * 60_000

export interface ReplayControls {
  active: boolean
  days: ReplayDays['days']
  date: string | null
  day: ReplayDay | undefined
  clock: number
  playing: boolean
  speed: number
  /** The events crossed so far, newest first. */
  crossed: ReplayEvent[]
  start(date?: string): void
  stop(): void
  setDate(date: string): void
  play(): void
  pause(): void
  seek(ms: number): void
  setSpeed(x: number): void
}

const AtContext = createContext<string | null>(null)
const ControlsContext = createContext<ReplayControls | null>(null)

/** The instant the views are asked for, or null when live. */
export const useReplayAt = () => useContext(AtContext)
export const useReplay = () => useContext(ControlsContext)

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

/** The index of the last event at or before `t`, or -1. */
function lastAt(events: ReplayEvent[], t: number): number {
  let lo = 0
  let hi = events.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (new Date(events[mid]!.at).getTime() <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export function ReplayProvider({ wikiKey, children }: { wikiKey: string; children: ReactNode }) {
  const boot = useMemo(() => new URLSearchParams(window.location.search), [])
  const [active, setActive] = useState(boot.has('replay'))
  const [date, setDateState] = useState<string | null>(() => {
    const d = boot.get('replay')
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
  })
  const [clock, setClock] = useState(0)
  const [playing, setPlaying] = useState(boot.get('autoplay') === '1')
  const [speed, setSpeed] = useState(() => {
    const x = Number(boot.get('speed'))
    return SPEEDS.some((s) => s.x === x) ? x : 1200
  })

  const days = useQuery({
    queryKey: ['wiki', wikiKey, 'replay'],
    queryFn: () => getJson<ReplayDays>(`/wikis/${wikiKey}/replay`),
    enabled: active,
    staleTime: 60_000,
    refetchInterval: false,
  })
  const chosen = date ?? days.data?.days[0]?.date ?? null
  const day = useQuery({
    queryKey: ['wiki', wikiKey, 'replay', chosen],
    queryFn: () => getJson<ReplayDay>(`/wikis/${wikiKey}/replay/${chosen}`),
    enabled: active && Boolean(chosen),
    staleTime: Infinity,
    refetchInterval: false,
  })
  const events = useMemo(() => day.data?.events ?? [], [day.data])
  const bounds = useMemo(() => {
    if (!day.data) return null
    const start = new Date(day.data.start).getTime()
    // Today ends now: the server answers nothing past the wall clock.
    const end = Math.min(new Date(day.data.end).getTime() - 1, Date.now() - 60_000)
    const first = events[0] ? new Date(events[0].at).getTime() - 10 * 60_000 : start
    return { start, end, first: Math.max(start, Math.min(first, end)) }
  }, [day.data, events])

  // A new day starts its clock just before the first event.
  useEffect(() => {
    if (bounds) setClock(bounds.first)
  }, [bounds])

  const clockRef = useRef(clock)
  clockRef.current = clock
  useEffect(() => {
    setClockOverride(active && bounds ? () => clockRef.current : null)
    return () => setClockOverride(null)
  }, [active, bounds])

  useEffect(() => {
    if (!active || !playing || !bounds) return
    // Advance by wall time elapsed, not by ticks: a background tab's timers are throttled.
    let last = performance.now()
    const id = setInterval(() => {
      const t = performance.now()
      const dt = t - last
      last = t
      setClock((c) => {
        let next = c + dt * speed
        const i = lastAt(events, c) + 1
        const upcoming = events[i] ? new Date(events[i].at).getTime() : null
        if (upcoming !== null && upcoming - c > SKIP_MS) next = Math.max(next, upcoming - 60_000)
        if (next >= bounds.end) {
          setPlaying(false)
          return bounds.end
        }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [active, playing, bounds, events, speed])

  const idx = lastAt(events, clock)
  // The clock matters to the views only through the last event crossed and the whole step it is in.
  const step = bounds ? Math.floor((clock - bounds.start) / STEP_MS) : 0
  const at = useMemo(() => {
    if (!active || !bounds) return null
    const lastEvent = idx >= 0 ? new Date(events[idx]!.at).getTime() : bounds.start
    return new Date(Math.max(lastEvent, bounds.start + step * STEP_MS)).toISOString()
  }, [active, bounds, idx, events, step])

  const crossed = useMemo(() => events.slice(0, idx + 1).reverse(), [events, idx])

  const start = useCallback((d?: string) => {
    if (d) setDateState(d)
    setActive(true)
    setPlaying(true)
  }, [])
  const stop = useCallback(() => {
    setActive(false)
    setPlaying(false)
    const url = new URL(window.location.href)
    for (const k of ['replay', 'autoplay', 'speed']) url.searchParams.delete(k)
    window.history.replaceState(null, '', url)
  }, [])

  const controls = useMemo<ReplayControls>(
    () => ({
      active,
      days: days.data?.days ?? [],
      date: chosen,
      day: day.data,
      clock,
      playing,
      speed,
      crossed,
      start,
      stop,
      setDate: (d) => {
        setDateState(d)
        setPlaying(false)
      },
      play: () => {
        if (bounds && clockRef.current >= bounds.end) setClock(bounds.first)
        setPlaying(true)
      },
      pause: () => setPlaying(false),
      seek: (ms) => setClock(bounds ? Math.min(bounds.end, Math.max(bounds.start, ms)) : ms),
      setSpeed,
    }),
    [active, days.data, chosen, day.data, clock, playing, speed, crossed, start, stop, bounds],
  )

  return (
    <ControlsContext.Provider value={controls}>
      <AtContext.Provider value={at}>{children}</AtContext.Provider>
    </ControlsContext.Provider>
  )
}
