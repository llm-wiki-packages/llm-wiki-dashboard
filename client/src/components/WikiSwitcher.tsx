// The wiki switcher: every wiki with its health and size, the current one
// first. A button and a listbox, so the dots and counts show, which a native
// select cannot draw.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown } from 'lucide-react'
import type { WikiSummary } from '@dashboard/shared/types'
import { n } from '@/lib/format'
import { HealthDot, cn } from './ui'

export function WikiSwitcher({
  current,
  wikis,
}: {
  current: string
  wikis: WikiSummary[] | undefined
}) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const here = wikis?.find((w) => w.key === current)
  const list = wikis
    ? [...wikis].sort((a, b) =>
        a.key === current ? -1 : b.key === current ? 1 : a.name.localeCompare(b.name),
      )
    : []

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Wiki"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 max-w-[260px] items-center gap-2 rounded-pill border border-line-2 bg-card pl-3 pr-2.5 text-sm"
      >
        {here && <HealthDot health={here.health} />}
        <span className="truncate">{here?.name ?? current}</span>
        <ChevronDown className="size-3.5 shrink-0 text-ink-2" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Wikis"
          className="absolute right-0 top-11 z-20 flex min-w-[300px] flex-col rounded-card border border-line-2 bg-card p-1.5 shadow-lg"
        >
          {list.map((w) => (
            <li key={w.key} role="option" aria-selected={w.key === current}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (w.key !== current) void navigate({ to: '/w/$key', params: { key: w.key } })
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-paper',
                  w.key === current && 'bg-paper',
                )}
              >
                <HealthDot health={w.health} />
                <span className="grow truncate">{w.name}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-ink-2">
                  {n(w.pages)} pages
                </span>
                <Check
                  className={cn('size-3.5 shrink-0', w.key === current ? 'text-ink' : 'invisible')}
                />
              </button>
              {w.healthNote && w.health !== 'ok' && (
                <div className="px-3 pb-1.5 pl-[34px] text-[11px] text-ink-3">{w.healthNote}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
