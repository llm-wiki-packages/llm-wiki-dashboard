// Search: the engine's question box with every filter it takes, or an
// answer: a jailed agent session runs the configured skill (default
// `llm-wiki:ask`) over the wiki, and its answer streams in with citations.
// Results and citations open in the reader. The URL carries the whole query,
// so either is shareable; an answer runs only when Ask is pressed.

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Search as SearchIcon, Settings2, Sparkles } from 'lucide-react'
import { SEARCH_FILTER_KINDS, type AskRequest, type AskStatus, type SearchFilterKind } from '@dashboard/shared/types'
import { ApiError, useAskStatus, useConfig, useFacets, useSearch } from '@/lib/api'
import { useAskSettings, type AskSettings } from '@/lib/askSettings'
import { useAskStream } from '@/lib/askStream'
import { settledMarkdown } from '@/lib/sse'
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
  const askStatus = useAskStatus(key, answering)
  const asker = useAskStream(key)
  const [draft, setDraft] = useState(search.q ?? '')
  /** The request a question would run as: an agent is sent only when this wiki has it enabled. */
  const requestFor = (q: string): AskRequest | undefined => {
    if (!settings) return undefined
    const { agent, ...rest } = settings
    return { q, ...rest, ...(agent && askStatus.data?.agents.includes(agent) ? { agent } : {}) }
  }
  const canAsk = askStatus.data?.available === true
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
          const q = draft.trim()
          set({ q: q || undefined })
          const req = q && answering && canAsk ? requestFor(q) : undefined
          if (req) void asker.ask(req)
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
          disabled={answering && !canAsk}
          className="h-12 rounded-pill bg-ink px-6 text-sm font-semibold text-paper disabled:opacity-40"
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
          skills={cfg.data.ask.skills}
          agents={askStatus.data?.agents ?? []}
          onChange={setSettings}
        />
      )}

      {answering ? (
        <AnswerPanel
          wikiKey={key}
          req={search.q ? requestFor(search.q) : undefined}
          status={askStatus.data}
          statusError={askStatus.error}
          asker={asker}
          cli={cfg.data?.cli ?? 'llm-wiki-cli'}
        />
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
  skills,
  agents,
  onChange,
}: {
  settings: AskSettings
  models: string[]
  efforts: string[]
  skills: string[]
  agents: string[]
  onChange: (p: Partial<AskSettings>) => void
}) {
  const agent = settings.agent && agents.includes(settings.agent) ? settings.agent : undefined
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
      {skills.length > 1 && (
        <Field label="Skill">
          <Segmented>
            {skills.map((k) => (
              <Button key={k} active={settings.skill === k} onClick={() => onChange({ skill: k })}>
                <span className="font-mono">{k}</span>
              </Button>
            ))}
          </Segmented>
        </Field>
      )}
      {agents.length > 0 && (
        <Field label="Agent">
          <Segmented>
            <Button active={!agent} onClick={() => onChange({ agent: undefined })}>
              default
            </Button>
            {agents.map((a) => (
              <Button key={a} active={agent === a} onClick={() => onChange({ agent: a })}>
                {a}
              </Button>
            ))}
          </Segmented>
        </Field>
      )}
      <p className="basis-full text-xs text-ink-3">
        Your question runs through <span className="font-mono">{settings.skill}</span>
        {agent ? (
          <>
            {' '}as the <span className="font-mono">{agent}</span> agent
          </>
        ) : null}{' '}
        in one jailed agent session that can read the wiki and its search, and write nothing. Kept
        in this browser.
      </p>
    </Card>
  )
}

function AnswerPanel({
  wikiKey,
  req,
  status,
  statusError,
  asker,
  cli,
}: {
  wikiKey: string
  req: AskRequest | undefined
  status: AskStatus | undefined
  statusError: unknown
  asker: ReturnType<typeof useAskStream>
  cli: string
}) {
  const { run } = asker
  const streaming = run.state === 'streaming'
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!streaming || !run.startedAt) return
    const started = run.startedAt
    const tick = () => setElapsed(Math.round((Date.now() - started) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [streaming, run.startedAt])

  if (statusError) return <ErrorNote error={statusError} />
  if (status && !status.available) return <AskOff reason={status.reason} fix={status.fix} />
  if (!req)
    return (
      <Empty
        title="Ask the wiki anything"
        body="The answer streams in as the agent reads, and cites the pages it came from; each citation opens in the reader."
      />
    )

  const mine = run.req?.q === req.q ? run : undefined
  const kept = !mine ? asker.cached(req) : undefined
  const ran = mine?.req ?? req
  const meta = (s?: number) => (
    <span className="font-mono text-xs text-ink-3">
      {ran.skill}
      {ran.agent ? ` · ${ran.agent}` : ''} · {ran.model} · {ran.effort}
      {s !== undefined ? ` · ${s}s` : ''}
    </span>
  )
  const again = (label: string) => (
    <button
      type="button"
      className="text-xs font-semibold text-accent"
      onClick={() => void asker.ask(req, true)}
    >
      {label}
    </button>
  )

  if (mine?.state === 'error') {
    const e = mine.error
    return (
      <div className="flex flex-col gap-3">
        {e instanceof ApiError && e.kind === 'unsupported' ? (
          <AskOff reason={e.message} fix={e.fix} cli={cli} />
        ) : (
          <ErrorNote error={e} />
        )}
        {mine.text && (
          <Card className="flex flex-col gap-3 opacity-70">
            <SectionLabel right={again('Ask again')}>Partial answer</SectionLabel>
            <Brief wikiKey={wikiKey} markdown={settledMarkdown(mine.text)} />
          </Card>
        )}
      </div>
    )
  }

  if (streaming && mine)
    return (
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-3" aria-live="polite">
          <span className="size-2.5 shrink-0 rounded-full bg-live live-pulse" />
          <span className="min-w-0 grow truncate text-[15px]">
            {mine.tool ? (
              <>
                {mine.tool.name}
                {mine.tool.detail && <span className="text-ink-2"> · {mine.tool.detail}</span>}
              </>
            ) : (
              'Starting a session…'
            )}
          </span>
          <span className="shrink-0 tabular-nums text-sm text-ink-2">{elapsed}s</span>
          <button type="button" className="shrink-0 text-xs font-semibold text-accent" onClick={asker.cancel}>
            Stop
          </button>
        </div>
        {meta()}
        {mine.text && <Brief wikiKey={wikiKey} markdown={settledMarkdown(mine.text)} />}
      </Card>
    )

  const answer = mine?.state === 'done' ? mine.answer : kept
  if (answer)
    return (
      <Card className="flex flex-col gap-3">
        <SectionLabel
          right={
            <span className="flex items-center gap-3">
              {meta(answer.elapsedS)}
              {again('Ask again')}
            </span>
          }
        >
          Answer
        </SectionLabel>
        <Brief wikiKey={wikiKey} markdown={answer.answer} />
      </Card>
    )

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[15px]">
          {mine?.state === 'idle' ? 'Stopped. ' : ''}Ready to ask: <strong className="font-semibold">{req.q}</strong>
        </span>
        {meta()}
      </div>
      <button
        type="button"
        disabled={!status?.available}
        onClick={() => void asker.ask(req, true)}
        className="h-10 rounded-pill bg-ink px-5 text-sm font-semibold text-paper disabled:opacity-40"
      >
        Ask
      </button>
    </Card>
  )
}

function AskOff({ reason, fix, cli }: { reason?: string; fix?: string; cli?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-card bg-warn-bg px-4 py-3 text-sm">
      <span className="font-semibold">This machine cannot answer here yet</span>
      <span>{reason ?? 'Ask is off.'}. Results still work: switch to Results above.</span>
      {fix && (
        <span className="text-warn-ink">
          This turns it on: <code className="font-mono">{fix}</code>
        </span>
      )}
      {!fix && cli && reason && /run-harness/.test(reason) && (
        <span className="text-warn-ink">
          Update the llm-wiki plugins, then check with{' '}
          <code className="font-mono">{cli} machine version</code>
        </span>
      )}
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
