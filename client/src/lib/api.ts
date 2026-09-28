// The client's whole view of the server: typed fetchers and the query hooks
// around them. Query keys are ['wiki', key, view] so the event stream can
// invalidate a screen by name.

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import type {
  AppConfig,
  Briefing,
  BriefingsView,
  Facets,
  FleetView,
  NewView,
  PageView,
  Resolved,
  SearchFilterKind,
  SearchView,
  TodayView,
  WikiSummary,
} from '@dashboard/shared/types'
import { useReplayAt } from './replay'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message)
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' })
  if (!res.ok) {
    let body: { error?: string; stderr?: string } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, body.error ?? res.statusText, body.stderr)
  }
  return (await res.json()) as T
}

/** A replayed instant never changes, so its answer is kept; the previous screen shows while the next loads. */
const replayed = (at: string | null | undefined) =>
  at ? { staleTime: Infinity, refetchInterval: false as const, placeholderData: keepPreviousData } : {}
const atParam = (at: string | null | undefined, sep: '?' | '&') => (at ? `${sep}at=${encodeURIComponent(at)}` : '')

export const q = {
  config: () => queryOptions({ queryKey: ['config'], queryFn: () => get<AppConfig>('/config'), staleTime: Infinity }),
  wikis: () => queryOptions({ queryKey: ['wikis'], queryFn: () => get<WikiSummary[]>('/wikis') }),
  today: (key: string, at?: string | null) =>
    queryOptions({
      queryKey: ['wiki', key, 'today', at ?? 'live'],
      queryFn: () => get<TodayView>(`/wikis/${key}/today${atParam(at, '?')}`),
      ...replayed(at),
    }),
  whatsNew: (key: string, since: string, at?: string | null) =>
    queryOptions({
      queryKey: ['wiki', key, 'new', since, at ?? 'live'],
      queryFn: () => get<NewView>(`/wikis/${key}/new?since=${encodeURIComponent(since)}${atParam(at, '&')}`),
      ...replayed(at),
    }),
  fleet: (key: string, at?: string | null) =>
    queryOptions({
      queryKey: ['wiki', key, 'fleet', at ?? 'live'],
      queryFn: () => get<FleetView>(`/wikis/${key}/fleet${atParam(at, '?')}`),
      ...replayed(at),
    }),
  briefings: (key: string) =>
    queryOptions({
      queryKey: ['wiki', key, 'briefings'],
      queryFn: () => get<BriefingsView>(`/wikis/${key}/briefings`),
    }),
  page: (key: string, rel: string) =>
    queryOptions({
      queryKey: ['wiki', key, 'page', rel],
      queryFn: () => get<PageView>(`/wikis/${key}/page?path=${encodeURIComponent(rel)}`),
    }),
  resolve: (key: string, link: string) =>
    queryOptions({
      queryKey: ['wiki', key, 'resolve', link],
      queryFn: () => get<Resolved>(`/wikis/${key}/resolve?link=${encodeURIComponent(link)}`),
      staleTime: 60_000,
      retry: false,
    }),
  facets: (key: string) =>
    queryOptions({ queryKey: ['wiki', key, 'facets'], queryFn: () => get<Facets>(`/wikis/${key}/facets`), staleTime: 300_000 }),
  search: (key: string, q: string, opts: { k?: number; filters?: Partial<Record<SearchFilterKind, string>>; from?: string; to?: string }) => {
    const p = new URLSearchParams({ q })
    if (opts.k) p.set('k', String(opts.k))
    for (const [kind, v] of Object.entries(opts.filters ?? {})) if (v) p.set(kind, v)
    if (opts.from) p.set('captured_from', opts.from)
    if (opts.to) p.set('captured_to', opts.to)
    return queryOptions({
      queryKey: ['wiki', key, 'search', p.toString()],
      queryFn: () => get<SearchView>(`/wikis/${key}/search?${p.toString()}`),
      staleTime: 60_000,
      refetchInterval: false,
    })
  },
  briefing: (key: string, id: string) =>
    queryOptions({
      queryKey: ['wiki', key, 'briefings', id],
      queryFn: () => get<Briefing>(`/wikis/${key}/briefings/${encodeURIComponent(id)}`),
    }),
}

export const useConfig = () => useQuery(q.config())
export const useWikis = () => useQuery(q.wikis())
export const useToday = (key: string) => useQuery(q.today(key, useReplayAt()))
export const useWhatsNew = (key: string, since: string) => useQuery(q.whatsNew(key, since, useReplayAt()))
export const useFleet = (key: string) => useQuery(q.fleet(key, useReplayAt()))
export const useBriefings = (key: string) => useQuery(q.briefings(key))
export const useBriefing = (key: string, id: string | undefined) =>
  useQuery({ ...q.briefing(key, id ?? ''), enabled: Boolean(id) })
export const usePage = (key: string, rel: string | undefined) =>
  useQuery({ ...q.page(key, rel ?? ''), enabled: Boolean(rel) })
export const useResolve = (key: string, link: string | undefined) =>
  useQuery({ ...q.resolve(key, link ?? ''), enabled: Boolean(link) })
export const useFacets = (key: string) => useQuery(q.facets(key))
export const useSearch = (key: string, text: string | undefined, opts: Parameters<typeof q.search>[2]) =>
  useQuery({ ...q.search(key, text ?? '', opts), enabled: Boolean(text) })
