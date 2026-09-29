// The reader: one wiki page, reached by a wikilink or a path. Wikilinks in
// it keep working, so a reader can follow a chain without leaving.

import { createFileRoute, Link } from '@tanstack/react-router'
import { useConfig, usePage, useResolve } from '@/lib/api'
import { dayLabel } from '@/lib/format'
import { Card, Empty, ErrorNote, Skeleton } from '@/components/ui'
import { Brief } from '@/components/Brief'
import { ProvenanceTrail } from '@/components/Provenance'

type Search = { link?: string; path?: string }

export const Route = createFileRoute('/w/$key/page')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    link: typeof s.link === 'string' ? s.link : undefined,
    path: typeof s.path === 'string' ? s.path : undefined,
  }),
  component: PageReader,
})

function PageReader() {
  const { key } = Route.useParams()
  const { link, path } = Route.useSearch()
  const cfg = useConfig()
  const resolved = useResolve(key, path ? undefined : link)
  const rel = path ?? resolved.data?.path
  const page = usePage(key, rel)
  const wikiNoun = cfg.data?.nouns.wiki[0] ?? 'wiki'

  if (!path && link && resolved.isPending) return <Skeleton className="mt-6 h-[400px]" />
  if (!path && link && resolved.isError)
    return (
      <div className="mx-auto max-w-3xl pt-8">
        <Empty title={`No page for [[${link.split('|')[0]}]]`} body={`Nothing in this ${wikiNoun} has that name yet. The link may point at a page a later run will write.`} />
        <p className="mt-4 text-sm text-ink-2">
          <Link to="/w/$key/briefings" params={{ key }} className="text-accent">
            Back to briefings
          </Link>
        </p>
      </div>
    )
  if (!rel) return <div className="pt-8 text-ink-2">Name a page.</div>

  return (
    <div className="mx-auto max-w-4xl pt-6">
      {page.isPending ? (
        <Skeleton className="h-[500px]" />
      ) : page.isError ? (
        <ErrorNote error={page.error} />
      ) : (
        <Card className="p-10 lg:px-12">
          <article className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="text-[13px] uppercase tracking-[0.08em] text-ink-2">
                {page.data.kind} · {dayLabel(page.data.when)}
                {page.data.areas.length ? ` · ${page.data.areas.join(', ')}` : ''}
              </div>
              <div className="flex gap-2">
                {page.data.resource && (
                  <a href={page.data.resource} target="_blank" rel="noreferrer" className="rounded-pill border border-line-2 px-3 py-1.5 text-[13px] text-ink-2">
                    Source
                  </a>
                )}
                <span className="rounded-pill border border-line-2 px-3 py-1.5 text-[13px] text-ink-2" title={page.data.path}>
                  {page.data.path}
                </span>
              </div>
            </div>
            {page.data.provenance && <ProvenanceTrail wikiKey={key} p={page.data.provenance} />}
            <Brief wikiKey={key} markdown={page.data.body} />
          </article>
        </Card>
      )}
    </div>
  )
}
