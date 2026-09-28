// The client's whole view of the server: typed fetchers and the query hooks
// around them. Query keys are ['wiki', key, view] so the event stream can
// invalidate a screen by name.

import { queryOptions, useQuery } from '@tanstack/react-query'
import type {
  AppConfig,
  Briefing,
  BriefingsView,
  FleetView,
  NewView,
  TodayView,
  WikiSummary,
} from '@dashboard/shared/types'

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

export const q = {
  config: () => queryOptions({ queryKey: ['config'], queryFn: () => get<AppConfig>('/config'), staleTime: Infinity }),
  wikis: () => queryOptions({ queryKey: ['wikis'], queryFn: () => get<WikiSummary[]>('/wikis') }),
  today: (key: string) =>
    queryOptions({ queryKey: ['wiki', key, 'today'], queryFn: () => get<TodayView>(`/wikis/${key}/today`) }),
  whatsNew: (key: string, since: string) =>
    queryOptions({
      queryKey: ['wiki', key, 'new', since],
      queryFn: () => get<NewView>(`/wikis/${key}/new?since=${encodeURIComponent(since)}`),
    }),
  fleet: (key: string) =>
    queryOptions({ queryKey: ['wiki', key, 'fleet'], queryFn: () => get<FleetView>(`/wikis/${key}/fleet`) }),
  briefings: (key: string) =>
    queryOptions({
      queryKey: ['wiki', key, 'briefings'],
      queryFn: () => get<BriefingsView>(`/wikis/${key}/briefings`),
    }),
  briefing: (key: string, id: string) =>
    queryOptions({
      queryKey: ['wiki', key, 'briefings', id],
      queryFn: () => get<Briefing>(`/wikis/${key}/briefings/${encodeURIComponent(id)}`),
    }),
}

export const useConfig = () => useQuery(q.config())
export const useWikis = () => useQuery(q.wikis())
export const useToday = (key: string) => useQuery(q.today(key))
export const useWhatsNew = (key: string, since: string) => useQuery(q.whatsNew(key, since))
export const useFleet = (key: string) => useQuery(q.fleet(key))
export const useBriefings = (key: string) => useQuery(q.briefings(key))
export const useBriefing = (key: string, id: string | undefined) =>
  useQuery({ ...q.briefing(key, id ?? ''), enabled: Boolean(id) })
