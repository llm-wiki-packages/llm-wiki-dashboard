// Today: the landing screen. What's new by area, the briefing, what is
// running right now, the plan for the day, and what needs the person.

import { Link, createFileRoute } from '@tanstack/react-router'
import { FileText, AlertCircle } from 'lucide-react'
import type { AreaSummary, Counts, NowItem, PlanItem } from '@dashboard/shared/types'
import { useConfig, useToday } from '@/lib/api'
import { clock, greeting, n, nowDate, plural, timeAgo } from '@/lib/format'
import { Card, ChannelDot, Dot, ErrorNote, Empty, Pill, SectionLabel, Skeleton } from '@/components/ui'

export const Route = createFileRoute('/w/$key/')({ component: Today })

function Today() {
  const { key } = Route.useParams()
  const view = useToday(key)
  const cfg = useConfig()
  const wikiNoun = cfg.data?.nouns.wiki ?? (['wiki', 'wikis'] as const)

  if (view.isPending)
    return (
      <div className="grid gap-6 pt-6 lg:grid-cols-[1fr_400px]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>
    )
  if (view.isError) return <div className="pt-6"><ErrorNote error={view.error} /></div>
  const v = view.data
  const running = v.now.filter((x) => x.state === 'running').length
  const needs = v.attention.filter((a) => a.severity !== 'info').length

  return (
    <div className="flex flex-col gap-6 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[44px] leading-[1.1]">{greeting()}.</h1>
          <p className="max-w-[760px] text-[17px] text-ink-2">{v.lede}</p>
        </div>
        <div className="flex gap-2 text-[13px]">
          {running > 0 && (
            <Pill tone="live">
              <Dot color="var(--color-live)" live className="size-2" />
              {running} {running === 1 ? 'agent' : 'agents'} working now
            </Pill>
          )}
          {needs > 0 && <Pill tone="warn">{needs} {needs === 1 ? 'needs' : 'need'} you</Pill>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-4">
          <SectionLabel
            right={
              <Link to="/w/$key/new" params={{ key }} className="text-sm text-accent">
                See everything new
              </Link>
            }
          >
            What's new, by area
          </SectionLabel>
          {v.areas.length === 0 ? (
            <Empty title={`Nothing new in this ${wikiNoun[0]} since midnight`} body="The plan on the right says what runs next." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {v.areas.map((a) => (
                <AreaCard key={a.name} area={a} wikiKey={key} />
              ))}
            </div>
          )}

          {v.briefing && (
            <Link
              to="/w/$key/briefings"
              params={{ key }}
              search={{ id: v.briefing.id }}
              className="flex items-center gap-5 rounded-card bg-ink p-5 text-paper"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <FileText className="size-5" />
              </div>
              <div className="flex grow flex-col gap-1">
                <div className="text-[13px] uppercase tracking-[0.08em] text-paper/65">
                  {v.briefing.title} · {clock(v.briefing.when)}
                </div>
                <div className="display text-[22px] leading-[1.25]">{v.briefing.summary || 'Read today’s report.'}</div>
              </div>
              <span className="whitespace-nowrap text-sm text-paper/80">Read the report →</span>
            </Link>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <SectionLabel
              right={
                <Link to="/w/$key/fleet" params={{ key }} className="text-[13px] text-accent">
                  Fleet
                </Link>
              }
            >
              Right now
            </SectionLabel>
            {v.now.length === 0 ? (
              <div className="text-sm text-ink-2">Nothing is running. {v.wiki.nextDue ? `Next: ${v.wiki.nextDue.bundle} ${timeAgo(v.wiki.nextDue.at)}.` : ''}</div>
            ) : (
              v.now.slice(0, 4).map((x) => <NowRow key={x.id} item={x} />)
            )}
          </Card>

          <Card className="flex grow flex-col gap-3">
            <SectionLabel right={<span className="text-xs text-ink-2">{clock(nowDate().toISOString())}</span>}>Today's plan</SectionLabel>
            {v.plan.length === 0 ? (
              <div className="text-sm text-ink-2">No runs recorded today and nothing scheduled.</div>
            ) : (
              <div className="flex flex-col">
                {v.plan.slice(0, 8).map((p, i) => (
                  <PlanRow key={`${p.bundle}-${p.time}-${i}`} item={p} />
                ))}
              </div>
            )}
          </Card>

          {v.attention
            .filter((a) => a.severity !== 'info')
            .slice(0, 2)
            .map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-card bg-warn-bg px-5 py-3.5">
                <AlertCircle className="size-[18px] shrink-0 text-warn-ink" />
                <div className="flex grow flex-col gap-0.5">
                  <span className="text-sm">{a.title}</span>
                  <span className="text-xs text-warn-ink">{a.detail}</span>
                </div>
                {a.action && (
                  <Link to="/w/$key/fleet" params={{ key }} className="text-[13px] font-semibold text-warn-ink">
                    {a.action.label}
                  </Link>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

function AreaCard({ area, wikiKey }: { area: AreaSummary; wikiKey: string }) {
  const hot = area.counts.new + area.counts.updated > 0
  const first = area.channels[0]
  return (
    <Link
      to="/w/$key/new"
      params={{ key: wikiKey }}
      search={{ area: area.name }}
      className="flex flex-col gap-3 rounded-card border border-line bg-card p-5 transition-colors hover:border-line-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {first && <ChannelDot id={first.id} />}
          <span className="text-lg font-semibold">{area.name}</span>
        </div>
        <Pill tone={hot ? 'accent' : 'paper'}>{countText(area)}</Pill>
      </div>
      <div className="text-[15px] leading-[1.45]">{area.headline ?? fallbackHeadline(area)}</div>
      <div className="flex flex-wrap gap-1.5">
        {area.channels.slice(0, 4).map((c) => (
          <span key={c.id} className="rounded-pill bg-paper px-2.5 py-1 text-xs text-ink-2">
            {c.name}
          </span>
        ))}
      </div>
    </Link>
  )
}

function countText(a: AreaSummary): string {
  const parts: string[] = []
  if (a.counts.new) parts.push(`${n(a.counts.new)} new`)
  if (a.counts.updated) parts.push(`${n(a.counts.updated)} updated`)
  if (a.counts.waiting) parts.push(`${n(a.counts.waiting)} waiting`)
  if (a.counts.distilled) parts.push(`${n(a.counts.distilled)} distilled`)
  if (a.counts.failed) parts.push(`${n(a.counts.failed)} failed`)
  return parts.join(' · ') || 'quiet'
}

function fallbackHeadline(a: AreaSummary): string {
  const top = [...a.channels].sort((x, y) => sum(y) - sum(x))[0]
  if (!top) return 'Nothing new here today.'
  return `${countText({ ...a, counts: top.counts })} from ${top.name}${a.channels.length > 1 ? `, and ${a.channels.length - 1} more ${plural(a.channels.length - 1, ['channel', 'channels'])}` : ''}.`
}

const sum = (c: { counts: Counts }) => Object.values(c.counts).reduce((x, y) => x + y, 0)

function NowRow({ item }: { item: NowItem }) {
  const color = item.state === 'running' ? 'var(--color-live)' : item.state === 'blocked' || item.state === 'parked' ? 'var(--color-warn)' : 'var(--color-ink-3)'
  return (
    <div className="flex items-center gap-3">
      <Dot color={color} live={item.state === 'running'} />
      <div className="flex grow flex-col">
        <span className="text-sm">{item.what}</span>
        <span className="text-xs text-ink-2">
          {item.machine}
          {item.note ? ` · ${item.note}` : ''}
        </span>
      </div>
      <span className="whitespace-nowrap text-xs text-ink-2">{timeAgo(item.since)}</span>
    </div>
  )
}

function PlanRow({ item }: { item: PlanItem }) {
  const done = item.status === 'done' || item.status === 'failed'
  const mark =
    item.status === 'done'
      ? 'bg-good'
      : item.status === 'failed'
        ? 'bg-bad'
        : item.status === 'running'
          ? 'bg-live live-pulse'
          : 'border-[1.5px] border-ink bg-transparent'
  return (
    <div className="grid grid-cols-[44px_14px_1fr] items-center gap-2.5 py-[7px]">
      <span className={`text-[13px] tabular-nums ${done ? 'text-ink-3' : 'text-ink'}`}>{item.status === 'running' ? 'now' : item.time ? clock(item.time) : 'due'}</span>
      <span className={`inline-block size-2.5 rounded-full ${mark}`} />
      <span className={`truncate text-sm ${done ? 'text-ink-2' : 'text-ink'}`}>{item.text}</span>
    </div>
  )
}
