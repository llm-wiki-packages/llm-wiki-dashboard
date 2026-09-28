// The replay controls: the day, play and speed, the clock, a scrubber with a
// tick per event, and the last thing that happened. The screens below it
// follow the clock on their own.

import { Pause, Play, RotateCcw, X } from 'lucide-react'
import type { ReplayEvent } from '@dashboard/shared/types'
import { SPEEDS, useReplay } from '@/lib/replay'
import { clock } from '@/lib/format'
import { Button, Pill, Segmented, cn } from './ui'

const dayName = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

const tickColor = (e: ReplayEvent) =>
  e.kind === 'page'
    ? 'var(--color-accent)'
    : e.kind === 'run-start'
      ? 'var(--color-live)'
      : e.detail === 'ok'
        ? 'var(--color-good)'
        : 'var(--color-bad)'

export function ReplayBar() {
  const r = useReplay()
  if (!r?.active) return null
  const day = r.day
  const start = day ? new Date(day.start).getTime() : 0
  const span = day ? new Date(day.end).getTime() - start : 1
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100))
  const last = r.crossed[0]

  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10">
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line-2 bg-card px-4 py-2.5">
        <Pill tone="accent">Replay</Pill>
        <label className="text-sm">
          <span className="sr-only">Day</span>
          <select
            className="rounded-pill border border-line-2 bg-card px-3 py-1.5 text-sm"
            value={r.date ?? ''}
            onChange={(e) => r.setDate(e.target.value)}
          >
            {r.days.length === 0 && <option value="">no recorded days</option>}
            {r.days.map((d) => (
              <option key={d.date} value={d.date}>
                {dayName(d.date)} · {d.commits} {d.commits === 1 ? 'change' : 'changes'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label={r.playing ? 'Pause' : 'Play'}
          onClick={() => (r.playing ? r.pause() : r.play())}
          className="flex size-9 items-center justify-center rounded-full bg-ink text-paper"
        >
          {r.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <button
          type="button"
          aria-label="Back to the start of the day"
          title="Back to the start of the day"
          onClick={() =>
            day &&
            r.seek(r.day?.events[0] ? new Date(r.day.events[0].at).getTime() - 10 * 60_000 : start)
          }
          className="flex size-9 items-center justify-center rounded-full border border-line-2 text-ink-2 hover:text-ink"
        >
          <RotateCcw className="size-4" />
        </button>
        <Segmented>
          {SPEEDS.map((s) => (
            <Button
              key={s.x}
              active={r.speed === s.x}
              onClick={() => r.setSpeed(s.x)}
              className="h-[30px] px-2.5 text-xs"
            >
              {s.label}
            </Button>
          ))}
        </Segmented>
        <div className="display w-[68px] text-center text-[26px] tabular-nums" aria-live="off">
          {day ? clock(new Date(r.clock).toISOString()) : '--:--'}
        </div>
        <div className="relative h-9 min-w-[240px] flex-1">
          <div className="absolute inset-x-0 top-[16px] h-1 rounded-sm bg-paper-2" />
          <div
            className="absolute left-0 top-[16px] h-1 rounded-sm bg-ink"
            style={{ width: `${pct(r.clock)}%` }}
          />
          {day?.events.map((e, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute top-[10px] h-4 w-[2px] rounded-sm opacity-70"
              style={{ left: `${pct(new Date(e.at).getTime())}%`, background: tickColor(e) }}
            />
          ))}
          <input
            type="range"
            aria-label="Replay time"
            className="replay-scrub absolute inset-0 w-full"
            min={start}
            max={start + span}
            step={60_000}
            value={r.clock}
            onChange={(e) => r.seek(Number(e.target.value))}
          />
        </div>
        <button
          type="button"
          aria-label="Leave replay"
          title="Back to live"
          onClick={r.stop}
          className="flex size-9 items-center justify-center rounded-full text-ink-2 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
      <div
        className={cn(
          'flex h-7 items-center gap-2 px-2 text-[13px] text-ink-2',
          !last && 'opacity-0',
        )}
      >
        {last && (
          <span key={`${last.at}-${r.crossed.length}`} className="replay-ticker truncate">
            <span className="tabular-nums text-ink-3">{clock(last.at)}</span>
            <span
              className="mx-2 inline-block size-2 rounded-full align-middle"
              style={{ background: tickColor(last) }}
            />
            <span className="text-ink">{last.title}</span>
            {last.channel && <span> · {last.channel}</span>}
            {last.kind !== 'page' && last.machine && <span> · {last.machine}</span>}
          </span>
        )}
      </div>
    </div>
  )
}
