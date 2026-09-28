// Learned: the compounding view. What the wiki took in over a week or a
// month, area by area and day by day, how big it has grown, and which
// channels went quiet. Each area keeps one hue everywhere; marks are thin;
// every chart has its table.

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { LearnedView } from '@dashboard/shared/types'
import { useConfig, useLearned } from '@/lib/api'
import { n, timeAgo } from '@/lib/format'
import { Button, Card, Empty, ErrorNote, SectionLabel, Segmented, Skeleton } from '@/components/ui'

type Search = { days?: 7 | 30; table?: boolean }

export const Route = createFileRoute('/w/$key/learned')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    days: Number(s.days) === 30 ? 30 : undefined,
    table: s.table === true || s.table === 'true' ? true : undefined,
  }),
  component: Learned,
})

/** Each area's hue: its slot in name order, so no two areas share one and a color never moves with a count. */
function hues(v: LearnedView): (name: string) => string {
  const order = [...v.areas.map((a) => a.name)].sort((a, b) => a.localeCompare(b))
  return (name) => `var(--color-ch-${Math.max(0, order.indexOf(name)) % 6})`
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(
      ([e]) => e && setW(Math.max(200, Math.round(e.contentRect.width))),
    )
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const shortDay = (d: string, many: boolean) => {
  const date = new Date(`${d}T12:00:00`)
  return many ? String(date.getDate()) : date.toLocaleDateString([], { weekday: 'short' })
}

function Learned() {
  const { key } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const days = search.days ?? 7
  const view = useLearned(key, days)
  const cfg = useConfig()
  const wikiNoun = cfg.data?.nouns.wiki[0] ?? 'wiki'
  const channelNoun = cfg.data?.nouns.channel ?? (['channel', 'channels'] as const)

  if (view.isPending) return <Skeleton className="mt-6 h-[560px]" />
  if (view.isError)
    return (
      <div className="pt-6">
        <ErrorNote error={view.error} />
      </div>
    )
  const v = view.data
  const learned = v.areas.reduce((a, x) => a + x.total, 0)
  const first = v.size[0] ?? 0
  const last = v.size.at(-1) ?? 0

  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[40px] leading-[1.1]">What your {wikiNoun} learned</h1>
          <p className="text-base text-ink-2">
            <strong className="font-semibold text-ink">{n(learned)} pages</strong>{' '}
            {days === 7 ? 'this week' : 'in 30 days'} across {v.areas.filter((a) => a.total).length}{' '}
            areas. It now holds {n(last)} pages
            {last > first
              ? `, up ${n(last - first)} since ${shortDay(v.days[0] ?? '', false)} ${new Date(`${v.days[0]}T12:00:00`).getDate()}`
              : ''}
            .
          </p>
        </div>
        <div className="flex gap-2">
          <Segmented>
            <Button
              active={days === 7}
              onClick={() => void navigate({ search: (s) => ({ ...s, days: undefined }) })}
            >
              This week
            </Button>
            <Button
              active={days === 30}
              onClick={() => void navigate({ search: (s) => ({ ...s, days: 30 }) })}
            >
              30 days
            </Button>
          </Segmented>
          <Segmented>
            <Button
              active={!search.table}
              onClick={() => void navigate({ search: (s) => ({ ...s, table: undefined }) })}
            >
              Chart
            </Button>
            <Button
              active={Boolean(search.table)}
              onClick={() => void navigate({ search: (s) => ({ ...s, table: true }) })}
            >
              Table
            </Button>
          </Segmented>
        </div>
      </div>

      {learned === 0 && v.size.every((x) => x === last) ? (
        <Empty
          title={`Nothing learned ${days === 7 ? 'this week' : 'in 30 days'}`}
          body="New and distilled pages show up here day by day, grouped by the area they belong to."
        />
      ) : search.table ? (
        <TableView v={v} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-5">
            <Card className="flex flex-col gap-3">
              <SectionLabel>Pages learned, by area</SectionLabel>
              {v.areas.length ? (
                <Multiples v={v} />
              ) : (
                <p className="text-sm text-ink-2">
                  No new or distilled pages in this window. Pages that were only revised are on
                  What's new.
                </p>
              )}
            </Card>
            <Card className="flex flex-col gap-3">
              <SectionLabel>Size of the {wikiNoun}</SectionLabel>
              <SizeLine v={v} />
            </Card>
          </div>
          <Card className="flex flex-col gap-3 self-start">
            <SectionLabel>Gone quiet</SectionLabel>
            {v.quiet.length === 0 ? (
              <p className="text-sm text-ink-2">
                Every {channelNoun[0]} brought something in the last week.
              </p>
            ) : (
              v.quiet.map((q) => (
                <div
                  key={q.id}
                  className="flex items-baseline justify-between gap-3 border-t border-line/60 pt-2 text-sm first:border-0 first:pt-0"
                >
                  <span>{q.name}</span>
                  <span className="whitespace-nowrap text-xs text-ink-2">
                    {q.last ? `last heard ${timeAgo(q.last)}` : 'nothing in this window'}
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/** One strip per area on a shared scale, so a tall bar means the same everywhere. */
function Multiples({ v }: { v: LearnedView }) {
  const CH = hues(v)
  const max = Math.max(1, ...v.areas.flatMap((a) => a.perDay))
  const many = v.days.length > 7
  const W = 100
  const H = 34
  const step = W / v.days.length
  const bar = Math.max(0.6, step * (many ? 0.55 : 0.4))
  return (
    <div className="flex flex-col gap-2.5">
      {v.areas.map((a) => (
        <div key={a.name} className="grid grid-cols-[150px_minmax(0,1fr)_44px] items-end gap-3">
          <span className="flex items-center gap-2 truncate pb-0.5 text-sm" title={a.name}>
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ background: CH(a.name) }}
            />
            {a.name}
          </span>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-[34px] w-full"
            role="img"
            aria-label={`${a.name}: ${a.perDay.join(', ')} pages per day`}
          >
            <line
              x1={0}
              x2={W}
              y1={H - 0.25}
              y2={H - 0.25}
              stroke="var(--color-line)"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
            {a.perDay.map((c, i) =>
              c ? (
                <rect
                  key={i}
                  x={i * step + (step - bar) / 2}
                  y={H - (c / max) * (H - 2)}
                  width={bar}
                  height={(c / max) * (H - 2)}
                  rx={0.4}
                  fill={CH(a.name)}
                />
              ) : null,
            )}
          </svg>
          <span className="pb-0.5 text-right text-sm font-semibold tabular-nums">{n(a.total)}</span>
        </div>
      ))}
      <div className="grid grid-cols-[150px_minmax(0,1fr)_44px] gap-3 text-[11px] text-ink-3">
        <span />
        <div className="flex justify-between">
          <span>{shortDay(v.days[0] ?? '', false)}</span>
          <span>{v.days.length > 7 ? 'today' : shortDay(v.days.at(-1) ?? '', false)}</span>
        </div>
        <span className="text-right">total</span>
      </div>
    </div>
  )
}

function SizeLine({ v }: { v: LearnedView }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const H = 110
  const lo = Math.min(...v.size)
  const hi = Math.max(...v.size)
  const span = Math.max(1, hi - lo)
  const x = (i: number) => (i / Math.max(1, v.size.length - 1)) * (W - 70)
  const y = (s: number) => 8 + (1 - (s - lo) / span) * (H - 24)
  const d = v.size.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s).toFixed(1)}`).join(' ')
  const lastI = v.size.length - 1
  return (
    <div ref={ref} className="w-full">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        role="img"
        aria-label={`From ${n(v.size[0] ?? 0)} to ${n(v.size.at(-1) ?? 0)} pages`}
      >
        <path d={d} fill="none" stroke="var(--color-ink)" strokeWidth={1.5} />
        <circle cx={x(lastI)} cy={y(v.size[lastI] ?? 0)} r={3} fill="var(--color-accent)" />
        <text
          x={x(lastI) + 8}
          y={y(v.size[lastI] ?? 0) + 4}
          fontSize={13}
          fill="var(--color-ink)"
          fontWeight={600}
        >
          {n(v.size[lastI] ?? 0)}
        </text>
        <text x={0} y={H - 2} fontSize={11} fill="var(--color-ink-3)">
          {n(v.size[0] ?? 0)} on {shortDay(v.days[0] ?? '', false)}{' '}
          {new Date(`${v.days[0]}T12:00:00`).getDate()}
        </text>
      </svg>
    </div>
  )
}

function TableView({ v }: { v: LearnedView }) {
  const CH = hues(v)
  const many = v.days.length > 7
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-2">
            <th className="px-4 py-2.5 font-medium">Area</th>
            {v.days.map((d) => (
              <th key={d} className="px-1.5 py-2.5 text-right font-medium">
                {shortDay(d, many)}
              </th>
            ))}
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {v.areas.map((a) => (
            <tr key={a.name} className="border-b border-line/60">
              <td className="px-4 py-2">
                <span
                  className="mr-2 inline-block size-2 rounded-full"
                  style={{ background: CH(a.name) }}
                />
                {a.name}
              </td>
              {a.perDay.map((c, i) => (
                <td key={i} className={`px-1.5 py-2 text-right ${c ? '' : 'text-ink-3'}`}>
                  {c}
                </td>
              ))}
              <td className="px-4 py-2 text-right font-semibold">{a.total}</td>
            </tr>
          ))}
          <tr className="text-ink-2">
            <td className="px-4 py-2">Pages held</td>
            {v.size.map((s, i) => (
              <td key={i} className="px-1.5 py-2 text-right text-xs">
                {many ? '' : n(s)}
              </td>
            ))}
            <td className="px-4 py-2 text-right">{n(v.size.at(-1) ?? 0)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  )
}
