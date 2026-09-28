// Search: the engine's question box with every filter it takes. Results open
// in the reader. The URL carries the whole query, so a search is shareable.

import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { SEARCH_FILTER_KINDS, type SearchFilterKind } from '@dashboard/shared/types'
import { useFacets, useSearch } from '@/lib/api'
import { Button, Card, ErrorNote, Empty, Pill, SectionLabel, Segmented, Skeleton, cn } from '@/components/ui'
import { DateRangePicker } from '@/components/DateRange'

type Search = { q?: string; k?: number; from?: string; to?: string } & Partial<Record<SearchFilterKind, string>>

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export const Route = createFileRoute('/w/$key/search')({
  validateSearch: (s: Record<string, unknown>): Search => {
    const out: Search = { q: str(s.q), from: str(s.from), to: str(s.to) }
    const k = Number(s.k)
    if ([10, 25, 50, 100].includes(k)) out.k = k
    for (const kind of SEARCH_FILTER_KINDS) out[kind] = str(s[kind])
    return out
  },
  component: SearchPage,
})

const FILTER_LABELS: Record<SearchFilterKind, string> = {
  area: 'Area',
  tag: 'Tag',
  type: 'Type',
  group: 'Collection',
  group_type: 'Collection kind',
  source_host: 'Source host',
  author: 'Author or channel',
  curation: 'Curation',
  under: 'Directory',
  bundle_id: 'Bundle id',
}

function SearchPage() {
  const { key } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const facets = useFacets(key)
  const [draft, setDraft] = useState(search.q ?? '')
  const set = (patch: Partial<Search>) => void navigate({ search: (s) => ({ ...s, ...patch }) })
  const filters: Partial<Record<SearchFilterKind, string>> = {}
  for (const kind of SEARCH_FILTER_KINDS) if (search[kind]) filters[kind] = search[kind]
  const results = useSearch(key, search.q, { k: search.k, filters, from: search.from, to: search.to })
  const activeCount = Object.keys(filters).length + (search.from || search.to ? 1 : 0)

  const options = (kind: SearchFilterKind): string[] => {
    const f = facets.data
    if (!f) return []
    return {
      area: f.areas, tag: f.tags, type: f.types, group: f.groups, group_type: f.groupTypes,
      source_host: f.hosts, author: f.authors, curation: f.curations, under: f.unders, bundle_id: [],
    }[kind]
  }

  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[40px] leading-[1.1]">Search</h1>
        <p className="text-base text-ink-2">Ask the wiki a question. Filters narrow it; a comma in a value means either, a leading minus means not.</p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          set({ q: draft.trim() || undefined })
        }}
      >
        <label className="flex h-12 grow items-center gap-3 rounded-pill border border-line-2 bg-card px-4">
          <SearchIcon className="size-5 shrink-0 text-ink-2" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What did the client say about renewal terms?"
            className="grow bg-transparent text-base outline-none placeholder:text-ink-3"
            aria-label="Search"
          />
        </label>
        <button type="submit" className="h-12 rounded-pill bg-ink px-6 text-sm font-semibold text-paper">
          Search
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4 self-start">
          <SectionLabel right={activeCount ? <button type="button" className="text-xs text-accent" onClick={() => set({ from: undefined, to: undefined, ...Object.fromEntries(SEARCH_FILTER_KINDS.map((k) => [k, undefined])) })}>Clear {activeCount}</button> : undefined}>
            Filters
          </SectionLabel>
          <Field label="Captured between">
            <DateRangePicker value={{ from: search.from, to: search.to }} onChange={(r) => set({ from: r.from, to: r.to })} />
          </Field>
          {SEARCH_FILTER_KINDS.map((kind) => (
            <Field key={kind} label={FILTER_LABELS[kind]}>
              <input
                list={`facet-${kind}`}
                value={search[kind] ?? ''}
                onChange={(e) => set({ [kind]: e.target.value || undefined })}
                placeholder={options(kind)[0] ? `e.g. ${options(kind)[0]}` : 'any'}
                className="h-9 w-full rounded-pill border border-line-2 bg-card px-3 text-sm outline-none placeholder:text-ink-3 focus:border-ink"
              />
              <datalist id={`facet-${kind}`}>
                {options(kind).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>
          ))}
          <Field label="Results">
            <Segmented>
              {[10, 25, 50, 100].map((n) => (
                <Button key={n} active={(search.k ?? 10) === n} onClick={() => set({ k: n === 10 ? undefined : n })}>{n}</Button>
              ))}
            </Segmented>
          </Field>
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          {!search.q ? (
            <Empty title="Ask something" body="Results show the page, where the match is, and open in the reader." />
          ) : results.isPending ? (
            <Skeleton className="h-[400px]" />
          ) : results.isError ? (
            <ErrorNote error={results.error} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <span>
                  {results.data.count} {results.data.count === 1 ? 'result' : 'results'} for <strong className="font-semibold text-ink">{results.data.q}</strong>
                </span>
                <Pill tone={results.data.degraded ? 'warn' : 'paper'}>{results.data.backend}{results.data.degraded ? ' · degraded' : ''}</Pill>
                {results.data.emulated.length > 0 && <Pill tone="warn">approximate: {results.data.emulated.join(', ')}</Pill>}
              </div>
              {results.data.hits.length === 0 && <Empty title="Nothing matched" body="Loosen a filter or widen the dates." />}
              {results.data.hits.map((h) => (
                <Link
                  key={`${h.rank}-${h.path}`}
                  to="/w/$key/page"
                  params={{ key }}
                  search={{ path: h.path }}
                  className={cn('flex flex-col gap-1.5 rounded-card border border-line bg-card p-4 transition-colors hover:border-line-2')}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] font-semibold">{h.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-3">{h.rank} · {h.score.toFixed(2)}</span>
                  </div>
                  <div className="line-clamp-3 text-sm leading-[1.5] text-ink-2">{h.snippet}</div>
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    <span className="truncate">{h.path}</span>
                    {h.curation && <span>· {h.curation}</span>}
                  </div>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-ink-2">{label}</span>
      {children}
    </label>
  )
}
