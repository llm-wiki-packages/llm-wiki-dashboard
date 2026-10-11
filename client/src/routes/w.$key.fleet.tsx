// Fleet: who harvested what today, in orbit; health in three numbers; the
// day hour by hour; and every job, grouped by kind.

import { createFileRoute } from '@tanstack/react-router'
import type { PlanItem } from '@dashboard/shared/types'
import { useConfig, useFleet } from '@/lib/api'
import { clock, n, nowDate } from '@/lib/format'
import { Card, ErrorNote, SectionLabel, Skeleton, Stat } from '@/components/ui'
import { Orbit } from '@/components/Orbit'
import { Starters } from '@/components/Starters'
import { Jobs } from '@/components/Jobs'

export const Route = createFileRoute('/w/$key/fleet')({ component: Fleet })

function Fleet() {
  const { key } = Route.useParams()
  const view = useFleet(key)
  const cfg = useConfig()
  if (view.isPending) return <Skeleton className="mt-6 h-[640px]" />
  if (view.isError) return <div className="pt-6"><ErrorNote error={view.error} /></div>
  const v = view.data
  const pagesToday = v.channels.reduce((a, c) => a + c.counts.new + c.counts.updated, 0)
  const working = v.machines.filter((m) => m.running > 0).length
  const machineNoun = cfg.data?.nouns.machine ?? (['machine', 'machines'] as const)
  const channelNoun = cfg.data?.nouns.channel ?? (['channel', 'channels'] as const)
  const active = v.channels.filter((c) => Object.values(c.counts).some(Boolean)).length
  const rings = v.channels.length
  const watched = v.channels.filter((c) => c.watched).length
  const ringsNoun = rings === 1 ? channelNoun[0] : channelNoun[1]

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[40px] leading-[1.1]">Your fleet today</h1>
        <p className="text-base text-ink-2">
          {pagesToday === 0 ? (
            <>
              No new pages from <strong className="font-semibold text-ink">{rings} {ringsNoun}</strong> today
            </>
          ) : (
            <>
              <strong className="font-semibold text-ink">{n(pagesToday)} new {pagesToday === 1 ? 'page' : 'pages'}</strong> from{' '}
              <strong className="font-semibold text-ink">{active} of {rings} {ringsNoun}</strong> today
            </>
          )}
          {` · ${v.machines.length} ${v.machines.length === 1 ? machineNoun[0] : machineNoun[1]}`}
          {working ? ` · ${working} working right now` : ''}
          {v.health.attention ? ` · ${v.health.attention} ${v.health.attention === 1 ? 'needs' : 'need'} you` : ''}.
        </p>
      </div>

      {cfg.data && watched === 0 && <Starters wikiKey={key} cli={cfg.data.cli} channelNoun={channelNoun[0]} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="flex flex-col overflow-hidden p-2">
          <Orbit
            wiki={v.wiki.name}
            pages={pagesToday}
            machines={v.machines}
            channels={v.channels}
            emptyNote={`No ${channelNoun[1]} watched yet, and nothing captured in the last 30 days. Add a watch and it appears here.`}
          />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pb-3 pt-1 text-xs text-ink-2">
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-full border-[2.5px] border-ink-3" /> watched by a job · {watched}
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-full border-[1.5px] border-dashed border-ink-3" /> seen in pages only · {rings - watched}
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-full border-[2px] border-dashed border-warn bg-warn-bg" /> blocked
            </span>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Health</SectionLabel>
            <div className="grid grid-cols-3 gap-3">
              <Stat value={<>{v.health.machinesSeen}<span className="font-normal text-ink-2">/{v.health.machinesTotal}</span></>} label={`${machineNoun[1]} seen today`} />
              <Stat value={<>{v.health.runsOk}<span className="font-normal text-ink-2">/{v.health.runsTotal}</span></>} label="runs succeeded" />
              <Stat value={v.health.attention} label={v.health.attention === 1 ? `${channelNoun[0]} needs you` : `${channelNoun[1]} need you`} tone={v.health.attention ? 'warn' : undefined} />
            </div>
            {v.attention
              .filter((a) => a.severity !== 'info')
              .map((a) =>
                a.fromReport ? (
                  <div key={a.id} className="flex flex-col gap-0.5 rounded-[10px] bg-warn-bg px-3 py-2.5 text-[13px]">
                    <span className="font-medium">{a.title}</span>
                    {a.detail && <span className="text-xs text-warn-ink">{a.detail}</span>}
                  </div>
                ) : (
                  <div key={a.id} className="flex items-center gap-2.5 rounded-[10px] bg-warn-bg px-3 py-2.5 text-[13px]">
                    <span className="grow">{a.title}</span>
                    <code className="truncate text-xs text-warn-ink" title={a.detail}>
                      {a.detail}
                    </code>
                  </div>
                ),
              )}
            {v.attention
              .filter((a) => a.severity === 'info')
              .map((a) => (
                <div key={a.id} className="text-xs text-ink-2">
                  {a.title} · {a.detail}
                </div>
              ))}
          </Card>

          <Card className="flex grow flex-col gap-3">
            <SectionLabel right={<span className="text-xs text-ink-2">now {clock(nowDate().toISOString())}</span>}>Today, hour by hour</SectionLabel>
            <Timeline plan={v.plan} />
            <div className="flex flex-col overflow-hidden">
              {v.plan.slice(0, 10).map((p, i) => (
                <div key={`${p.job}-${p.time}-${i}`} className="grid grid-cols-[44px_12px_1fr_auto] items-center gap-2.5 border-t border-line/60 py-[7px]">
                  <span className={`text-[13px] tabular-nums ${p.status === 'upcoming' ? 'text-ink' : p.status === 'running' ? 'text-live' : 'text-ink-3'}`}>
                    {p.status === 'running' ? 'now' : p.time ? clock(p.time) : 'due'}
                  </span>
                  <Mark status={p.status} />
                  <span className={`truncate text-sm ${p.status === 'upcoming' || p.status === 'running' ? 'text-ink' : 'text-ink-2'}`}>{p.text}</span>
                  <span className="text-xs text-ink-3">{p.machine ?? ''}</span>
                </div>
              ))}
              {v.plan.length === 0 && <div className="text-sm text-ink-2">No runs recorded today and nothing scheduled.</div>}
            </div>
          </Card>
        </div>
      </div>

      {v.jobs.length > 0 && <Jobs wikiKey={key} jobs={v.jobs} />}
    </div>
  )
}

function Mark({ status }: { status: PlanItem['status'] }) {
  const cls =
    status === 'done' ? 'bg-good' : status === 'failed' ? 'bg-bad' : status === 'running' ? 'bg-live live-pulse' : 'border-[1.5px] border-ink'
  return <span className={`inline-block size-2.5 rounded-full ${cls}`} />
}

function Timeline({ plan }: { plan: PlanItem[] }) {
  const start = nowDate()
  start.setHours(0, 0, 0, 0)
  const pct = (iso: string) => Math.min(100, Math.max(0, ((new Date(iso).getTime() - start.getTime()) / 86_400_000) * 100))
  const nowPct = pct(nowDate().toISOString())
  return (
    <div className="relative h-[34px]">
      <div className="absolute inset-x-0 top-[15px] h-1 rounded-sm bg-paper-2" />
      <div className="absolute left-0 top-[15px] h-1 rounded-sm bg-ink" style={{ width: `${nowPct}%` }} />
      {plan
        .filter((p) => p.time)
        .map((p, i) => {
          const color = p.status === 'done' ? 'var(--color-good)' : p.status === 'failed' ? 'var(--color-bad)' : p.status === 'running' ? 'var(--color-live)' : 'var(--color-ink)'
          return (
            <span
              key={`${p.job}-${i}`}
              title={`${clock(p.time)} ${p.text}`}
              className="absolute top-3 size-2.5 rounded-full border-2"
              style={{ left: `calc(${pct(p.time)}% - 5px)`, borderColor: color, background: p.status === 'upcoming' ? 'var(--color-card)' : color }}
            />
          )
        })}
      <span className="absolute top-1.5 h-[22px] w-0.5 bg-accent" style={{ left: `${nowPct}%` }} />
      <span className="absolute left-0 top-6 text-[11px] text-ink-3">00:00</span>
      <span className="absolute right-0 top-6 text-[11px] text-ink-3">24:00</span>
    </div>
  )
}
