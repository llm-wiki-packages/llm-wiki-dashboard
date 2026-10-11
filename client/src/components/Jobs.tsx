// Every declared job, grouped by kind: a pipeline pulls a source through the
// capture stages, a routines job runs skills in order. Each row says how many
// machines run it, where it is pinned, and what it is doing; opening one reads
// the record's own paragraphs. Paused, a chain part-way through and a first
// run waiting for its window are states, said quietly, never warnings.

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { JobSummary } from '@dashboard/shared/types'
import { useJob } from '@/lib/api'
import { Card, ErrorNote, Pill, SectionLabel, Skeleton, cn } from './ui'

const GROUPS: Array<{ kind: JobSummary['kind']; title: string; sub: string }> = [
  { kind: 'pipeline', title: 'Pipelines', sub: 'pull a source through capture' },
  { kind: 'routines', title: 'Routines', sub: 'run skills in order' },
]

/** How many machines run a job, by its claim. */
const CLAIM: Record<string, string> = { any: 'one machine', sticky: 'one machine, kept', none: 'every machine' }

function stateOf(j: JobSummary): { text: string; tone: string } {
  if (j.state === 'running') return { text: j.note ?? 'running', tone: 'text-live' }
  if (j.state === 'blocked' || j.state === 'failed') return { text: j.note ?? j.state, tone: 'text-warn-ink' }
  if (j.state === 'parked') return { text: j.note ?? 'parked', tone: 'text-ink-2' }
  if (j.state === 'paused') return { text: 'paused', tone: 'text-ink-3' }
  return { text: j.note ?? '', tone: 'text-ink-2' }
}

export function Jobs({ wikiKey, jobs }: { wikiKey: string; jobs: JobSummary[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Card className="flex flex-col gap-4">
      <SectionLabel right={<span className="text-xs text-ink-2">{jobs.filter((j) => j.state !== 'paused').length} of {jobs.length} active</span>}>
        Jobs
      </SectionLabel>
      {GROUPS.map((g) => {
        const rows = jobs.filter((j) => j.kind === g.kind)
        if (!rows.length) return null
        return (
          <div key={g.kind} className="flex flex-col">
            <div className="pb-1.5 text-[13px] font-medium">
              {g.title} <span className="font-normal text-ink-2">· {g.sub}</span>
            </div>
            {rows.map((j) => (
              <JobRow key={j.slug} wikiKey={wikiKey} job={j} open={open === j.slug} onToggle={() => setOpen(open === j.slug ? null : j.slug)} />
            ))}
          </div>
        )
      })}
    </Card>
  )
}

function JobRow({ wikiKey, job: j, open, onToggle }: { wikiKey: string; job: JobSummary; open: boolean; onToggle: () => void }) {
  const state = stateOf(j)
  const cadence = [j.every && `every ${j.every}`, j.window && `window ${j.window}`].filter(Boolean).join(' · ')
  return (
    <div className="border-t border-line/60">
      <button type="button" aria-expanded={open} onClick={onToggle} className="grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-2.5 py-2 text-left">
        <ChevronRight className={cn('mt-1 size-3.5 text-ink-3 transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm">
            <span className={cn('font-medium', j.state === 'paused' && 'text-ink-2')}>{j.slug}</span>
            {j.description && <span className="text-ink-2"> · {j.description}</span>}
          </span>
          <span className="truncate text-xs text-ink-2">
            {[j.kind === 'routines' ? j.skills.join(' → ') : j.host ?? j.skills[0], cadence].filter(Boolean).join(' · ')}
            {state.text && <span className={state.tone}> · {state.text}</span>}
          </span>
        </span>
        <span className="flex flex-wrap justify-end gap-1">
          {j.claim && (
            <span title={`claim: ${j.claim}`}>
              <Pill>{CLAIM[j.claim] ?? j.claim}</Pill>
            </span>
          )}
          {j.machine && <Pill tone="live">pinned to {j.machine}</Pill>}
        </span>
      </button>
      {open && <JobDetail wikiKey={wikiKey} slug={j.slug} />}
    </div>
  )
}

function JobDetail({ wikiKey, slug }: { wikiKey: string; slug: string }) {
  const job = useJob(wikiKey, slug)
  if (job.isPending) return <Skeleton className="mb-3 ml-6 h-16" />
  if (job.isError) return <div className="mb-3 ml-6"><ErrorNote error={job.error} /></div>
  const j = job.data
  return (
    <div className="mb-3 ml-6 flex flex-col gap-2 text-[13px] leading-[1.5]">
      {j.details.map((p, i) => (
        <p key={i} className="text-ink">{p}</p>
      ))}
      {j.routines.length > 0 && (
        <ol className="flex flex-col gap-0.5 text-ink-2">
          {j.routines.map((r, i) => (
            <li key={`${r.skill}-${i}`}>
              <span className="tabular-nums text-ink-3">{i + 1}.</span> <code className="text-ink">{r.skill}</code>
              {r.stages.length > 0 && <span> · {r.stages.join(', ')}</span>}
            </li>
          ))}
        </ol>
      )}
      {j.holder && <div className="text-xs text-ink-2">{j.holder}</div>}
      {!j.details.length && !j.routines.length && !j.holder && <div className="text-xs text-ink-2">The record says nothing more.</div>}
    </div>
  )
}
