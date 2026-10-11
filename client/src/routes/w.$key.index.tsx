// Today: the landing screen. What's new by area, the briefing, what is
// running right now, the plan for the day, and what needs the person.

import { Link, createFileRoute } from '@tanstack/react-router'
import { FileText, AlertCircle, ArrowRight, Newspaper } from 'lucide-react'
import type {
  AreaSummary,
  Attention,
  Briefing,
  Counts,
  NowItem,
  PlanItem,
} from '@dashboard/shared/types'
import { useConfig, useToday } from '@/lib/api'
import { clock, greeting, n, nowDate, plural, timeAgo } from '@/lib/format'
import { useSwitch } from '@/lib/prefs'
import {
  Card,
  ChannelDot,
  Dot,
  ErrorNote,
  Empty,
  Pill,
  SectionLabel,
  Skeleton,
} from '@/components/ui'

export const Route = createFileRoute('/w/$key/')({ component: Today })

function Today() {
  const { key } = Route.useParams()
  const view = useToday(key)
  const cfg = useConfig()
  const wikiNoun = cfg.data?.nouns.wiki ?? (['wiki', 'wikis'] as const)
  // The briefing leads by default in demo mode; live data leads with the areas until the viewer asks otherwise.
  const [briefFirst, setBriefFirst] = useSwitch(
    'dashboard.briefFirst',
    cfg.data?.source === 'fixtures',
  )

  if (view.isPending)
    return (
      <div className="grid gap-6 pt-6 lg:grid-cols-[1fr_400px]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>
    )
  if (view.isError)
    return (
      <div className="pt-6">
        <ErrorNote error={view.error} />
      </div>
    )
  const v = view.data
  const running = v.now.filter((x) => x.state === 'running').length
  const needs = v.attention.filter((a) => a.severity !== 'info').length
  const hero = briefFirst && v.briefing?.head ? v.briefing : undefined

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
          {needs > 0 && (
            <Pill tone="warn">
              {needs} {needs === 1 ? 'needs' : 'need'} you
            </Pill>
          )}
          {v.briefing?.head && (
            <button
              type="button"
              aria-pressed={briefFirst}
              onClick={() => setBriefFirst(!briefFirst)}
              title={briefFirst ? 'Lead with the areas' : 'Lead with the briefing'}
              className="inline-flex items-center gap-1.5 rounded-pill border border-line-2 bg-card px-2.5 py-1 text-xs text-ink-2 hover:text-ink"
            >
              <Newspaper className="size-3.5" />
              {briefFirst ? 'Areas first' : 'Briefing first'}
            </button>
          )}
        </div>
      </div>

      {hero && <BriefingHero briefing={hero} wikiKey={key} />}

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
            <Empty
              title={`Nothing new in this ${wikiNoun[0]} since midnight`}
              body="The plan on the right says what runs next."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {v.areas.map((a) => (
                <AreaCard key={a.name} area={a} wikiKey={key} />
              ))}
            </div>
          )}

          {v.briefing && !hero && (
            <Link
              to="/w/$key/briefings"
              params={{ key }}
              search={{ id: v.briefing.id }}
              className="flex items-center gap-5 rounded-card bg-ink p-5 text-paper"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-paper/15">
                <FileText className="size-5" />
              </div>
              <div className="flex grow flex-col gap-1">
                <div className="text-[13px] uppercase tracking-[0.08em] text-paper/65">
                  {v.briefing.title} · {clock(v.briefing.when)}
                </div>
                <div className="display text-[22px] leading-[1.25]">
                  {v.briefing.summary || 'Read today’s report.'}
                </div>
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
              <div className="text-sm text-ink-2">
                Nothing is running.{' '}
                {v.wiki.nextDue
                  ? `Next: ${v.wiki.nextDue.job} ${timeAgo(v.wiki.nextDue.at)}.`
                  : ''}
              </div>
            ) : (
              v.now.slice(0, 4).map((x) => <NowRow key={x.id} item={x} />)
            )}
          </Card>

          <Card className="flex grow flex-col gap-3">
            <SectionLabel
              right={<span className="text-xs text-ink-2">{clock(nowDate().toISOString())}</span>}
            >
              Today's plan
            </SectionLabel>
            {v.plan.length === 0 ? (
              <div className="text-sm text-ink-2">
                No runs recorded today and nothing scheduled.
              </div>
            ) : (
              <div className="flex flex-col">
                {v.plan.slice(0, 8).map((p, i) => (
                  <PlanRow key={`${p.job}-${p.time}-${i}`} item={p} />
                ))}
              </div>
            )}
          </Card>

          {v.attention
            .filter((a) => a.fromReport || a.severity !== 'info')
            .slice(0, 3)
            .map((a) => (
              <AttentionCard key={a.id} item={a} wikiKey={key} />
            ))}
        </div>
      </div>
    </div>
  )
}

function AttentionCard({ item, wikiKey }: { item: Attention; wikiKey: string }) {
  const tone = item.severity === 'info' ? 'bg-card border border-line' : 'bg-warn-bg'
  return (
    <div className={`flex items-start gap-3 rounded-card px-5 py-3.5 ${tone}`}>
      <AlertCircle
        className={`mt-0.5 size-[18px] shrink-0 ${item.severity === 'info' ? 'text-ink-2' : 'text-warn-ink'}`}
      />
      <div className="flex grow flex-col gap-1">
        <span className="text-sm font-medium leading-snug">{item.title}</span>
        {item.detail && <span className="text-xs leading-[1.45] text-ink-2">{item.detail}</span>}
        {item.next && (
          <span className="text-xs leading-[1.45]">
            <span className="font-semibold">Next:</span> {item.next}
          </span>
        )}
        {(item.fromReport || item.source) && (
          <span className="text-[11px] text-ink-3">
            {item.fromReport ? 'From the briefing' : 'Found on this machine'}
            {item.source ? ` · ${item.source}` : ''}
          </span>
        )}
      </div>
      {item.page ? (
        <Link
          to="/w/$key/page"
          params={{ key: wikiKey }}
          search={{ path: item.page }}
          className="whitespace-nowrap text-[13px] font-semibold text-accent"
        >
          Open
        </Link>
      ) : (
        item.action && (
          <Link
            to="/w/$key/fleet"
            params={{ key: wikiKey }}
            className="whitespace-nowrap text-[13px] font-semibold text-warn-ink"
          >
            {item.action.label}
          </Link>
        )
      )}
    </div>
  )
}

function BriefingHero({ briefing, wikiKey }: { briefing: Briefing; wikiKey: string }) {
  const head = briefing.head!
  return (
    <section className="flex flex-col gap-5 rounded-card bg-ink p-7 text-paper lg:p-9">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-[13px] uppercase tracking-[0.08em] text-paper/65">
          <FileText className="size-4" />
          {briefing.title} · {clock(briefing.when)}
        </div>
        <Link
          to="/w/$key/briefings"
          params={{ key: wikiKey }}
          search={{ id: briefing.id }}
          className="inline-flex items-center gap-1.5 rounded-pill bg-paper px-4 py-2 text-sm font-semibold text-ink"
        >
          Read the report <ArrowRight className="size-4" />
        </Link>
      </div>
      {head.lede && (
        <h2 className="display max-w-[980px] text-[34px] leading-[1.15] lg:text-[40px]">
          {head.lede}
        </h2>
      )}
      {head.items.length > 0 && (
        <ol className="grid gap-4 md:grid-cols-3">
          {head.items.map((it, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-xl bg-paper/[0.08] p-4">
              <div className="flex items-baseline gap-2.5">
                <span className="display text-[22px] leading-none text-paper/50">{i + 1}</span>
                <span className="text-[15px] font-semibold leading-snug">{it.title}</span>
              </div>
              {it.detail && (
                <p className="line-clamp-4 text-sm leading-[1.5] text-paper/75">{it.detail}</p>
              )}
              {it.source && (
                <span className="mt-auto self-start rounded-pill bg-paper/15 px-2.5 py-1 text-xs text-paper/80">
                  {it.source}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
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
  const color =
    item.state === 'running'
      ? 'var(--color-live)'
      : item.state === 'blocked' || item.state === 'parked'
        ? 'var(--color-warn)'
        : 'var(--color-ink-3)'
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
      <span className={`text-[13px] tabular-nums ${done ? 'text-ink-3' : 'text-ink'}`}>
        {item.status === 'running' ? 'now' : item.time ? clock(item.time) : 'due'}
      </span>
      <span className={`inline-block size-2.5 rounded-full ${mark}`} />
      <span className={`truncate text-sm ${done ? 'text-ink-2' : 'text-ink'}`}>{item.text}</span>
    </div>
  )
}
