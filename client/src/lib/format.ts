// Small formatting helpers. Times are shown relative when recent and as a
// clock when today, because that is how a person reads "when". "Now" is the
// replay clock while a day is replaying, so every relative time reads as of it.

let override: (() => number) | null = null
/** Replay sets this while it runs; null restores the wall clock. */
export function setClockOverride(fn: (() => number) | null): void {
  override = fn
}
export const nowMs = (): number => (override ? override() : Date.now())
export const nowDate = (): Date => new Date(nowMs())

export function timeAgo(iso: string | null | undefined, now = nowMs()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.round((now - t) / 1000)
  if (s < 0) return inFuture(-s)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function inFuture(s: number): string {
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `in ${Math.round(s / 3600)}h`
  return `in ${Math.round(s / 86400)}d`
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = nowDate()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `today ${clock(iso)}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${clock(iso)}`
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

export function longDate(d = nowDate()): string {
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

export function greeting(d = nowDate()): string {
  const h = d.getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function plural(n: number, [one, many]: readonly [string, string]): string {
  return n === 1 ? one : many
}

export function n(v: number): string {
  return v.toLocaleString()
}

/** A stable hue slot for a channel id: color follows the entity, never its rank. */
export function hueSlot(id: string, slots = 6): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % slots
}
