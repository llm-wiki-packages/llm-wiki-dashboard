// The trail under a page's title: where it was captured, on which machine,
// what made it, and the pages it came from or went into. Every hop links:
// the channel to What's new, the machine to Fleet, a page to the reader.

import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Provenance } from '@dashboard/shared/types'
import { dayLabel } from '@/lib/format'

const STAGE: Record<string, string> = { distill: 'Distilled', process: 'Processed', revise: 'Revised', enrich: 'Enriched', harvest: 'Captured', migrate: 'Imported' }

export function ProvenanceTrail({ wikiKey, p }: { wikiKey: string; p: Provenance }) {
  const hops: ReactNode[] = []
  if (p.channel)
    hops.push(
      <Hop key="ch" label="Captured from">
        <Link to="/w/$key/new" params={{ key: wikiKey }} search={{ since: '7d', by: 'channel', channel: p.channel.id }} className="text-accent hover:underline">
          {p.channel.name}
        </Link>
        {p.host && !p.channel.name.includes(p.host) && <span className="text-ink-3"> · {p.host}</span>}
      </Hop>,
    )
  if (p.captured?.machine || p.captured?.at)
    hops.push(
      <Hop key="cap" label={p.captured.machine ? 'On' : 'At'}>
        {p.captured.machine && (
          <Link to="/w/$key/fleet" params={{ key: wikiKey }} className="text-accent hover:underline">
            {p.captured.machine}
          </Link>
        )}
        {p.captured.at && <span className="text-ink-2"> {dayLabel(p.captured.at)}</span>}
      </Hop>,
    )
  if (p.generated?.stage || p.generated?.at)
    hops.push(
      <Hop key="gen" label={STAGE[p.generated.stage ?? ''] ?? 'Written'}>
        {p.generated.by && <span>{p.generated.by.split('/')[0]}</span>}
        {p.generated.at && <span className="text-ink-2"> {dayLabel(p.generated.at)}</span>}
      </Hop>,
    )
  if (p.from.length)
    hops.push(
      <Hop key="from" label="Distilled from">
        <Pages wikiKey={wikiKey} pages={p.from} />
      </Hop>,
    )
  if (p.into.length)
    hops.push(
      <Hop key="into" label="Distilled into">
        <Pages wikiKey={wikiKey} pages={p.into} />
      </Hop>,
    )
  if (!hops.length) return null
  return (
    <nav aria-label="Where this page came from" className="flex flex-wrap items-stretch gap-x-2 gap-y-3 rounded-xl bg-paper px-4 py-3">
      {hops.flatMap((h, i) => (i ? [<ChevronRight key={`sep-${i}`} aria-hidden className="size-4 self-center text-ink-3" />, h] : [h]))}
    </nav>
  )
}

function Hop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

function Pages({ wikiKey, pages }: { wikiKey: string; pages: Array<{ title: string; path?: string; resource?: string }> }) {
  return (
    <span className="flex flex-wrap gap-x-3">
      {pages.map((pg, i) =>
        pg.path ? (
          <Link key={i} to="/w/$key/page" params={{ key: wikiKey }} search={{ path: pg.path }} className="text-accent hover:underline">
            {pg.title}
          </Link>
        ) : pg.resource ? (
          <a key={i} href={pg.resource} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {pg.title}
          </a>
        ) : (
          <span key={i} className="text-ink-2">
            {pg.title}
          </span>
        ),
      )}
    </span>
  )
}
