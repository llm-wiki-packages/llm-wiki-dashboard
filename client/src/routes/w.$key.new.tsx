// What's new: grouped by area or channel, with the selected group opened into
// its channels and pages.

import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { AreaSummary, ChannelSummary, Counts, NewItem } from '@dashboard/shared/types'
import { useWhatsNew } from '@/lib/api'
import { dayLabel, n, timeAgo } from '@/lib/format'
import { Button, Card, ChannelDot, ErrorNote, Empty, KindBadge, Segmented, Skeleton, cn } from '@/components/ui'

type Search = { since?: '1d' | '7d'; by?: 'area' | 'channel'; area?: string; channel?: string }

export const Route = createFileRoute('/w/$key/new')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    since: s.since === '7d' ? '7d' : '1d',
    by: s.by === 'channel' ? 'channel' : 'area',
    area: typeof s.area === 'string' ? s.area : undefined,
    channel: typeof s.channel === 'string' ? s.channel : undefined,
  }),
  component: WhatsNew,
})

const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0)

function WhatsNew() {
  const { key } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const since = search.since ?? '1d'
  const view = useWhatsNew(key, since)
  const set = (patch: Partial<Search>) => void navigate({ search: (s) => ({ ...s, ...patch }) })

  const channels = useMemo(() => view.data?.areas.flatMap((a) => a.channels) ?? [], [view.data])
  const selectedArea = view.data?.areas.find((a) => a.name === search.area) ?? view.data?.areas[0]
  const selectedChannel = channels.find((c) => c.id === search.channel)

  if (view.isPending) return <Skeleton className="mt-6 h-[600px]" />
  if (view.isError) return <div className="pt-6"><ErrorNote error={view.error} /></div>
  const v = view.data

  const scopeItems: NewItem[] =
    search.by === 'channel' && selectedChannel
      ? v.items.filter((i) => i.channel === selectedChannel.id)
      : selectedArea
        ? v.items.filter((i) => selectedArea.channels.some((c) => c.id === i.channel))
        : v.items

  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[40px] leading-[1.1]">What's new</h1>
          <p className="text-base text-ink-2">
            {n(v.totals.pages)} pages since {since === '1d' ? 'midnight' : 'a week ago'} · {n(v.totals.counts.new)} new,{' '}
            {n(v.totals.counts.updated)} updated, {n(v.totals.counts.distilled)} distilled, {n(v.totals.counts.waiting)} waiting
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Segmented>
            <Button active={since === '1d'} onClick={() => set({ since: '1d' })}>Today</Button>
            <Button active={since === '7d'} onClick={() => set({ since: '7d' })}>This week</Button>
          </Segmented>
          <Segmented>
            <Button active={search.by !== 'channel'} onClick={() => set({ by: 'area' })}>By area</Button>
            <Button active={search.by === 'channel'} onClick={() => set({ by: 'channel' })}>By channel</Button>
          </Segmented>
        </div>
      </div>

      {v.areas.length === 0 ? (
        <Empty
          title={search.since === '7d' ? 'Nothing new this week' : 'Nothing new yet today'}
          body={`When a watch pulls something, it lands here grouped by area: new pages, updated ones, and what was distilled.${v.wiki.nextDue ? ` The next run is ${v.wiki.nextDue.bundle}, ${timeAgo(v.wiki.nextDue.at)}.` : ''}${search.since === '7d' ? '' : ' Or widen to this week.'}`}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {search.by === 'channel'
              ? channels.map((c) => (
                  <GroupRow
                    key={c.id}
                    id={c.id}
                    name={c.name}
                    counts={c.counts}
                    selected={selectedChannel?.id === c.id}
                    onClick={() => set({ channel: c.id })}
                    sub={c.area}
                  />
                ))
              : v.areas.map((a) => (
                  <AreaRow key={a.name} area={a} selected={selectedArea?.name === a.name} onClick={() => set({ area: a.name })} />
                ))}
          </div>

          <div className="flex min-w-0 flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              {selectedArea && search.by !== 'channel' && <ChannelDot id={selectedArea.channels[0]?.id ?? selectedArea.name} />}
              {selectedChannel && search.by === 'channel' && <ChannelDot id={selectedChannel.id} />}
              <span className="text-lg font-semibold">
                {search.by === 'channel' ? (selectedChannel?.name ?? 'Pick a channel') : (selectedArea?.name ?? '')}
              </span>
              <span className="text-sm text-ink-2">
                · {n(scopeItems.length)} {scopeItems.length === 1 ? 'item' : 'items'}
                {search.by !== 'channel' && selectedArea ? ` from ${selectedArea.channels.length} ${selectedArea.channels.length === 1 ? 'channel' : 'channels'}` : ''}
              </span>
            </div>

            {search.by !== 'channel' && selectedArea && (
              <div className="grid gap-3.5 md:grid-cols-2">
                {selectedArea.channels.slice(0, 4).map((c) => (
                  <ChannelCard key={c.id} channel={c} />
                ))}
              </div>
            )}

            <Card className="flex grow flex-col overflow-hidden p-0">
              <div className="grid grid-cols-[76px_1fr_180px_120px] gap-3 border-b border-line px-[18px] py-2.5 text-xs uppercase tracking-[0.06em] text-ink-2">
                <span />
                <span>Page</span>
                <span>From</span>
                <span>When</span>
              </div>
              {scopeItems.length === 0 ? (
                <div className="p-5 text-sm text-ink-2">Nothing in this group yet.</div>
              ) : (
                scopeItems.slice(0, 60).map((p) => <PageRow key={p.path} item={p} channels={channels} />)
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function AreaRow({ area, selected, onClick }: { area: AreaSummary; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex flex-col gap-2 rounded-card border p-3.5 text-left', selected ? 'border-line-2 bg-card' : 'border-transparent hover:bg-card/60')}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ChannelDot id={area.channels[0]?.id ?? area.name} />
          <span className="font-semibold">{area.name}</span>
        </div>
        <span className="text-[13px] text-ink-2">{n(area.count)}</span>
      </div>
      <div className="flex flex-col gap-1 pl-5">
        {area.channels.slice(0, 3).map((c) => (
          <div key={c.id} className="flex justify-between text-[13px]">
            <span className="truncate">{c.name}</span>
            <span className={cn('whitespace-nowrap', c.state === 'blocked' ? 'text-warn-ink' : c.counts.new + c.counts.updated > 0 ? 'font-semibold text-accent' : 'text-ink-2')}>
              {c.state === 'blocked' ? 'needs credential' : shortCounts(c.counts)}
            </span>
          </div>
        ))}
      </div>
    </button>
  )
}

function GroupRow({ id, name, counts, selected, onClick, sub }: { id: string; name: string; counts: Counts; selected: boolean; onClick: () => void; sub?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex items-center justify-between gap-3 rounded-card border p-3.5 text-left', selected ? 'border-line-2 bg-card' : 'border-transparent hover:bg-card/60')}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <ChannelDot id={id} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{name}</span>
          {sub && <span className="text-xs text-ink-2">{sub}</span>}
        </div>
      </div>
      <span className="whitespace-nowrap text-[13px] text-ink-2">{shortCounts(counts) || 'quiet'}</span>
    </button>
  )
}

function shortCounts(c: Counts): string {
  const parts: string[] = []
  if (c.new) parts.push(`${c.new} new`)
  if (c.updated) parts.push(`${c.updated} updated`)
  if (c.waiting) parts.push(`${c.waiting} waiting`)
  if (c.distilled) parts.push(`${c.distilled} distilled`)
  if (c.failed) parts.push(`${c.failed} failed`)
  return parts.join(' · ')
}

function ChannelCard({ channel: c }: { channel: ChannelSummary }) {
  const t = total(c.counts) || 1
  const seg = (k: keyof Counts, color: string) =>
    c.counts[k] ? <span key={k} style={{ flex: c.counts[k], background: color }} /> : null
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[15px] font-semibold">{c.name}</span>
        <span className="whitespace-nowrap text-xs text-ink-2">
          {c.machine ?? ''}
          {c.every ? ` · every ${c.every}` : ''}
        </span>
      </div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]" aria-label={shortCounts(c.counts)}>
        {seg('new', 'var(--color-kind-new-ink)')}
        {seg('updated', 'var(--color-kind-updated-ink)')}
        {seg('distilled', 'var(--color-kind-distilled-ink)')}
        {seg('waiting', 'var(--color-paper-2)')}
        {seg('failed', 'var(--color-bad)')}
        {total(c.counts) === 0 && <span style={{ flex: t, background: 'var(--color-paper-2)' }} />}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-ink-2">
        {(Object.keys(c.counts) as (keyof Counts)[]).filter((k) => c.counts[k]).map((k) => (
          <span key={k}>
            <strong className="font-semibold text-ink">{n(c.counts[k])}</strong> {k}
          </span>
        ))}
        {c.stateNote && <span className={c.state === 'blocked' ? 'text-warn-ink' : ''}>{c.stateNote}</span>}
      </div>
    </Card>
  )
}

function PageRow({ item, channels }: { item: NewItem; channels: ChannelSummary[] }) {
  const ch = channels.find((c) => c.id === item.channel)
  return (
    <a
      href={item.resource ?? '#'}
      target={item.resource ? '_blank' : undefined}
      rel="noreferrer"
      title={item.path}
      className="grid grid-cols-[76px_1fr_180px_120px] items-center gap-3 border-b border-line/60 px-[18px] py-[11px] hover:bg-paper/60"
    >
      <KindBadge kind={item.kind} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{item.title}</span>
        <span className="truncate text-xs text-ink-2">{item.sub ?? item.path}</span>
      </span>
      <span className="truncate text-[13px] text-ink-2">{ch?.name ?? item.channel}</span>
      <span className="text-[13px] text-ink-2">{dayLabel(item.when)}</span>
    </a>
  )
}
