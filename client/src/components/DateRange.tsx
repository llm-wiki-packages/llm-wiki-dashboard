// A date range picker for the capture window: a button showing the range,
// opening a two-month calendar. Dates travel as YYYY-MM-DD strings, the
// engine's own spelling.

import { useEffect, useRef, useState } from 'react'
import { DayPicker, type DateRange as DayRange } from 'react-day-picker'
import { CalendarDays, X } from 'lucide-react'
import 'react-day-picker/style.css'
import { cn } from './ui'

export interface Range {
  from?: string
  to?: string
}

const iso = (d: Date | undefined) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : undefined
const parse = (s: string | undefined) => {
  if (!s) return undefined
  const [y, m, d] = s.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d) : undefined
}
const label = (s: string | undefined) =>
  s ? parse(s)?.toLocaleDateString([], { day: 'numeric', month: 'short' }) : undefined

export function DateRangePicker({
  value,
  onChange,
}: {
  value: Range
  onChange: (r: Range) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected: DayRange | undefined =
    value.from || value.to ? { from: parse(value.from), to: parse(value.to) } : undefined
  const text =
    value.from || value.to
      ? `${label(value.from) ?? '…'} – ${label(value.to) ?? 'today'}`
      : 'Any time'

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-pill border border-line-2 bg-card px-3 text-sm',
          selected ? 'text-ink' : 'text-ink-2',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays className="size-4 shrink-0" />
        <span className="grow text-left">{text}</span>
        {selected && (
          <span
            role="button"
            aria-label="Clear dates"
            className="rounded-full p-0.5 hover:bg-paper-2"
            onClick={(e) => {
              e.stopPropagation()
              onChange({})
            }}
          >
            <X className="size-3.5" />
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Pick a capture window"
          className="absolute left-0 z-20 mt-2 w-max rounded-card border border-line-2 bg-card p-3 shadow-lg"
        >
          <DayPicker
            mode="range"
            numberOfMonths={2}
            selected={selected}
            onSelect={(r) => onChange({ from: iso(r?.from), to: iso(r?.to) })}
            disabled={{ after: new Date() }}
            showOutsideDays
          />
          <div className="flex justify-between border-t border-line pt-2 text-xs text-ink-2">
            <button type="button" className="hover:text-ink" onClick={() => onChange({})}>
              Clear
            </button>
            <div className="flex gap-3">
              {[
                ['7 days', 7],
                ['30 days', 30],
                ['90 days', 90],
              ].map(([l, days]) => (
                <button
                  key={l}
                  type="button"
                  className="hover:text-ink"
                  onClick={() => {
                    const to = new Date()
                    const from = new Date()
                    from.setDate(to.getDate() - Number(days))
                    onChange({ from: iso(from), to: iso(to) })
                  }}
                >
                  last {l}
                </button>
              ))}
            </div>
            <button type="button" className="font-semibold text-ink" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
