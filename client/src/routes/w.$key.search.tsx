// Search: the engine's question box with every filter it takes, or an
// answer: an agent runs the configured skill (default `/ask`) over the wiki
// and writes a few paragraphs with citations. Results and citations open in
// the reader. The URL carries the whole query, so either is shareable.

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Search as SearchIcon, Settings2, Sparkles } from 'lucide-react'
import { SEARCH_FILTER_KINDS, type SearchFilterKind } from '@dashboard/shared/types'
import { ApiError, useAsk, useConfig, useFacets, useSearch } from '@/lib/api'
import { useAskSettings, validPrefix, type AskSettings } from '@/lib/askSettings'
import { Brief } from '@/components/Brief'
import {
  Button,
  Card,
  ErrorNote,
  Empty,
  Pill,
  SectionLabel,
  Segmented,
  Skeleton,
  cn,
} from '@/components/ui'
import { DateRangePicker } from '@/components/DateRange'

type Search = {
  q?: string
  k?: number
  from?: string
  to?: string
  mode?: 'answer'
  floor?: boolean
} & Partial<Record<SearchFilterKind, string>>

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export const Route = createFileRoute('/w/$key/search')({
  validateSearch: (s: Record<string, unknown>): Search => {
    const out: Search = {
      q: str(s.q),
      from: str(s.from),
      to: str(s.to),
      mode: s.mode === 'answer' ? 'answer' : undefined,
    }
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
  const cfg = useConfig()
  const [settings, setSettings] = useAskSettings(cfg.data?.ask)
  const [gear, setGear] = useState(false)
  const answering = search.mode === 'answer'
  const [draft, setDraft] = useState(search.q ?? '')
  const set = (patch: Partial<Search>) => void navigate({ search: (s) => ({ ...s, ...patch }) })
  const filters: Partial<Record<SearchFilterKind, string>> = {}
  for (const kind of SEARCH_FILTER_KINDS) if (search[kind]) filters[kind] = search[kind]
  const results = useSearch(key, answering ? undefined : search.q, {
    k: search.k,
    filters,
    from: search.from,
    to: search.to,
  })
  // The floor is relative: engines score on different scales, but a hit a quarter as good as the best is noise in a demo.
  const best = results.data?.hits[0]?.score ?? 0
  const shown = (results.data?.hits ?? []).filter((h) => !search.floor || h.score >= best * 0.25)
  const weak = (results.data?.hits.length ?? 0) - shown.length
  const activeCount = Object.keys(filters).length + (search.from || search.to ? 1 : 0)

  const options = (kind: SearchFilterKind): string[] => {
    const f = facets.data
    if (!f) return []
    return {
      area: f.areas,
      tag: f.tags,
      type: f.types,
      group: f.groups,
      group_type: f.groupTypes,
      source_host: f.hosts,
      author: f.authors,
      curation: f.curations,
      under: f.unders,
      bundle_id: [],
    }[kind]
  }

  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[40px] leading-[1.1]">Search</h1>
          <p className="text-base text-ink-2">
            {answering
              ? 'Ask the wiki. An agent searches it, reads the pages that matter, and answers with sources you can open.'
              : 'Ask the wiki a question. Filters narrow it; a comma in a value means either, a leading minus means not.'}
          </p>
        </div>
        <Segmented>
          <Button active={!answering} onClick={() => set({ mode: undefined })}>
            Results
          </Button>
          <Button active={answering} onClick={() => set({ mode: 'answer' })}>
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5" />
              Answer
            </span>
          </Button>
        </Segmented>
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
            id="search-box"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft('')
                set({ q: undefined })
              }
            }}
            placeholder="What did the client say about renewal terms?"
            className="grow bg-transparent text-base outline-none placeholder:text-ink-3"
            aria-label="Search"
          />
        </label>
        <button
          type="submit"
          className="h-12 rounded-pill bg-ink px-6 text-sm font-semibold text-paper"
        >
          {answering ? 'Ask' : 'Search'}
        </button>
        {answering && (
          <button
            type="button"
            aria-label="Answer settings"
            aria-expanded={gear}
            title="Model, effort and the skill that answers"
            onClick={() => setGear((g) => !g)}
            className={cn(
              'flex size-12 items-center justify-center rounded-full border transition-colors',
              gear
                ? 'border-ink bg-ink text-paper'
                : 'border-line-2 bg-card text-ink-2 hover:text-ink',
            )}
          >
            <Settings2 className="size-5" />
          </button>
        )}
      </form>

      {answering && gear && settings && cfg.data && (
        <AskGear
          settings={settings}
          models={cfg.data.ask.models}
          efforts={cfg.data.ask.efforts}
          onChange={setSettings}
        />
      )}

      {answering ? (
        <AnswerPanel wikiKey={key} q={search.q} settings={settings} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="flex flex-col gap-4 self-start">
            <SectionLabel
              right={
                activeCount ? (
                  <button
                    type="button"
                    className="text-xs text-accent"
                    onClick={() =>
                      set({
                        from: undefined,
                        to: undefined,
                        ...Object.fromEntries(SEARCH_FILTER_KINDS.map((k) => [k, undefined])),
                      })
                    }
                  >
                    Clear {activeCount}
                  </button>
                ) : undefined
              }
            >
              Filters
            </SectionLabel>
            <Field label="Captured between">
              <DateRangePicker
                value={{ from: search.from, to: search.to }}
                onChange={(r) => set({ from: r.from, to: r.to })}
              />
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
                  <Button
                    key={n}
                    active={(search.k ?? 10) === n}
                    onClick={() => set({ k: n === 10 ? undefined : n })}
                  >
                    {n}
                  </Button>
                ))}
              </Segmented>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(search.floor)}
                onChange={(e) => set({ floor: e.target.checked || undefined })}
                className="size-4 accent-[var(--color-accent)]"
              />
              Hide weak matches
            </label>
          </Card>

          <div className="flex min-w-0 flex-col gap-3">
            {!search.q ? (
              <Empty
                title="Ask something"
                body="Results show the page, where the match is, and open in the reader."
              />
            ) : results.isPending ? (
              <Skeleton className="h-[400px]" />
            ) : results.isError ? (
              <ErrorNote error={results.error} />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                  <span>
                    {results.data.count} {results.data.count === 1 ? 'result' : 'results'} for{' '}
                    <strong className="font-semibold text-ink">{results.data.q}</strong>
                  </span>
                  <Pill tone={results.data.degraded ? 'warn' : 'paper'}>
                    {results.data.backend}
                    {results.data.degraded ? ' · degraded' : ''}
                  </Pill>
                  {results.data.emulated.length > 0 && (
                    <Pill tone="warn">approximate: {results.data.emulated.join(', ')}</Pill>
                  )}
                </div>
                {(results.data.degraded || results.data.backend === 'grep') && cfg.data && (
                  <div className="flex flex-col gap-2 rounded-card bg-warn-bg px-4 py-3 text-sm">
                    <span>
                      Search is matching your words exactly right now, so results are unranked and
                      may miss pages that say it differently.
                    </span>
                    <span className="text-warn-ink">
                      Ranked answers come back when the search service runs. This names the fix:{' '}
                      <code className="font-mono">
                        {cfg.data.cli} wiki {key} doctor
                      </code>
                    </span>
                  </div>
                )}
                {results.data.hits.length === 0 && (
                  <Empty title="Nothing matched" body="Loosen a filter or widen the dates." />
                )}
                {weak > 0 && (
                  <div className="text-xs text-ink-3">
                    {weak} weak {weak === 1 ? 'match' : 'matches'} hidden, each under a quarter of
                    the best score.
                  </div>
                )}
                {shown.map((h) => (
                  <Link
                    key={`${h.rank}-${h.path}`}
                    to="/w/$key/page"
                    params={{ key }}
                    search={{ path: h.path }}
                    className={cn(
                      'flex flex-col gap-1.5 rounded-card border border-line bg-card p-4 transition-colors hover:border-line-2',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[15px] font-semibold">{h.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-3">
                        {h.rank} · {h.score.toFixed(2)}
                      </span>
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
      )}
    </div>
  )
}

function AskGear({
  settings,
  models,
  efforts,
  onChange,
}: {
  settings: AskSettings
  models: string[]
  efforts: string[]
  onChange: (p: Partial<AskSettings>) => void
}) {
  const [prefix, setPrefix] = useState(settings.prefix)
  return (
    <Card className="flex flex-wrap items-end gap-5">
      <Field label="Model">
        <Segmented>
          {models.map((m) => (
            <Button key={m} active={settings.model === m} onClick={() => onChange({ model: m })}>
              {m}
            </Button>
          ))}
        </Segmented>
      </Field>
      <Field label="Effort">
        <Segmented>
          {efforts.map((e) => (
            <Button key={e} active={settings.effort === e} onClick={() => onChange({ effort: e })}>
              {e}
            </Button>
          ))}
        </Segmented>
      </Field>
      <Field label="Prompt prefix (the skill that answers)">
        <input
          value={prefix}
          onChange={(e) => {
            setPrefix(e.target.value)
            if (validPrefix(e.target.value)) onChange({ prefix: e.target.value })
          }}
          aria-invalid={!validPrefix(prefix)}
          className={cn(
            'h-9 w-44 rounded-pill border bg-card px-3 font-mono text-sm outline-none',
            validPrefix(prefix) ? 'border-line-2 focus:border-ink' : 'border-bad',
          )}
        />
      </Field>
      <p className="basis-full text-xs text-ink-3">
        Your question runs as <span className="font-mono">{settings.prefix} &lt;question&gt;</span>{' '}
        in one agent session on this wiki, under the read-only floor. Kept in this browser.
      </p>
    </Card>
  )
}

function AnswerPanel({
  wikiKey,
  q,
  settings,
}: {
  wikiKey: string
  q: string | undefined
  settings: AskSettings | undefined
}) {
  const ask = useAsk(wikiKey, q && settings ? { q, ...settings } : undefined)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!ask.isFetching) return
    const started = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [ask.isFetching])

  if (!q)
    return (
      <Empty
        title="Ask the wiki anything"
        body="The answer cites the pages it came from; each citation opens in the reader."
      />
    )
  if (ask.isError) {
    const e = ask.error
    if (e instanceof ApiError && e.kind === 'unsupported')
      return (
        <Empty
          title="This machine cannot answer yet"
          body={`${e.message}. Results still work: switch to Results above.`}
        />
      )
    return <ErrorNote error={e} />
  }
  if (ask.isPending || !ask.data)
    return (
      <Card className="flex items-center gap-4">
        <span className="size-2.5 rounded-full bg-live live-pulse" />
        <div className="flex flex-col">
          <span className="text-[15px]">
            Reading your wiki… <span className="tabular-nums text-ink-2">{elapsed}s</span>
          </span>
          <span className="text-xs text-ink-3 font-mono">
            {settings?.prefix} · {settings?.model} · {settings?.effort} effort
          </span>
        </div>
      </Card>
    )
  const a = ask.data
  return (
    <Card className="flex flex-col gap-3">
      <SectionLabel
        right={
          <span className="text-xs text-ink-3 font-mono">
            /{a.skill} · {a.model} · {a.effort} · {a.elapsedS}s
          </span>
        }
      >
        Answer
      </SectionLabel>
      <Brief wikiKey={wikiKey} markdown={a.answer} />
    </Card>
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
