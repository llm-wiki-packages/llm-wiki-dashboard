// Briefings: the reports the agents wrote, newest first, and the one selected
// rendered as an article.

import { createFileRoute } from '@tanstack/react-router'
import type { BriefingsView } from '@dashboard/shared/types'
import { useBriefing, useBriefings, useConfig } from '@/lib/api'
import { clock, dayLabel, timeAgo } from '@/lib/format'
import { Card, ErrorNote, Empty, SectionLabel, Skeleton, cn } from '@/components/ui'
import { Brief } from '@/components/Brief'

type Search = { id?: string }

export const Route = createFileRoute('/w/$key/briefings')({
  validateSearch: (s: Record<string, unknown>): Search => ({ id: typeof s.id === 'string' ? s.id : undefined }),
  component: Briefings,
})

/** `1d` reads as "daily", `1h` as "hourly", anything else as "every <period>". */
const cadence = (every: string) => ({ '1d': 'daily', '1h': 'hourly', '7d': 'weekly' })[every] ?? `every ${every}`

/** Which job writes the reports and when. A paused one is a state a fresh wiki ships in, said with the command that resumes it. */
function whoWrites(next: NonNullable<BriefingsView['next']>, key: string, cli?: string): string {
  if (next.paused)
    return `The ${next.job} job writes them${next.every ? ` ${cadence(next.every)}` : ''} once it is resumed${cli ? `: ${cli} wiki ${key} jobs resume ${next.job}` : ''}.`
  return `The ${next.job} job writes the first one${next.at ? `, ${timeAgo(next.at)} (${clock(next.at)})` : next.every ? `; it runs ${cadence(next.every)}` : ''}.`
}

function Briefings() {
  const { key } = Route.useParams()
  const { id } = Route.useSearch()
  const navigate = Route.useNavigate()
  const cfg = useConfig()
  const list = useBriefings(key)
  const selectedId = id ?? list.data?.reports[0]?.id
  const report = useBriefing(key, selectedId)
  const noun = cfg.data?.nouns.briefing ?? (['briefing', 'briefings'] as const)

  if (list.isPending) return <Skeleton className="mt-6 h-[600px]" />
  if (list.isError) return <div className="pt-6"><ErrorNote error={list.error} /></div>

  return (
    <div className="grid gap-8 pt-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <div className="py-2">
          <SectionLabel>Reports</SectionLabel>
        </div>
        {list.data.reports.length === 0 && (
          <Empty
            title={`No ${noun[1]} yet`}
            body={
              list.data.next
                ? `${whoWrites(list.data.next, key, cfg.data?.cli)} Each ${noun[0]} says what changed, what needs you, and links every page it cites.`
                : `Nothing on the schedule writes one yet. A daily ${noun[0]} says what changed, what needs you, and links every page it cites.`
            }
          />
        )}
        {list.data.reports.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => void navigate({ search: { id: r.id } })}
            className={cn('flex flex-col gap-1 rounded-xl border px-3.5 py-3 text-left', r.id === selectedId ? 'border-line-2 bg-card' : 'border-transparent hover:bg-card/60')}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-medium">{r.title}</span>
              <span className="whitespace-nowrap text-xs text-ink-2">{dayLabel(r.when)}</span>
            </div>
            {r.summary && <div className="line-clamp-2 text-[13px] leading-[1.4] text-ink-2">{r.summary}</div>}
          </button>
        ))}
      </div>

      <Card className="min-h-[560px] p-10 lg:px-12">
        {!selectedId ? (
          <div className="text-ink-2">{list.data.reports.length ? 'Pick a report.' : `The first ${noun[0]} will read here.`}</div>
        ) : report.isPending ? (
          <Skeleton className="h-[400px]" />
        ) : report.isError ? (
          <ErrorNote error={report.error} />
        ) : (
          <article className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="text-[13px] uppercase tracking-[0.08em] text-ink-2">
                {report.data.title} · {dayLabel(report.data.when)}
              </div>
              <span className="rounded-pill border border-line-2 px-3 py-1.5 text-[13px] text-ink-2" title={report.data.path}>
                {report.data.path}
              </span>
            </div>
            <Brief wikiKey={key} markdown={report.data.body ?? report.data.summary} />
          </article>
        )}
      </Card>
    </div>
  )
}
