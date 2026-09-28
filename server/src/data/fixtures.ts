// The demo dataset: a work wiki with a full day of activity, the way the
// mockups drew it. Times are relative to the current day so the screens read
// as "today" whenever they are opened. This is also what `npm run start:mock`
// serves, so a sales demo never depends on a live pipeline being busy.

import type {
  AreaSummary,
  ItemKind,
  ReplayDay,
  ReplayDays,
  ReplayEvent,
  Briefing,
  BriefingsView,
  ChannelSummary,
  Counts,
  FleetView,
  Machine,
  NewItem,
  NewView,
  Facets,
  NowItem,
  PageView,
  PlanItem,
  Resolved,
  SearchView,
  TodayView,
  WikiSummary,
} from '@dashboard/shared/types'
import { NotFound, emptyCounts, linkStem, type Source, type WikiRoot } from './source.js'

const at = (h: number, m = 0, dayOffset = 0): string => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  d.setDate(d.getDate() + dayOffset)
  return d.toISOString()
}
const midnight = () => at(0)
const localDay = (d = new Date()) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const counts = (p: Partial<Counts>): Counts => ({ ...emptyCounts(), ...p })
const sum = (list: Counts[]): Counts =>
  list.reduce((a, c) => {
    for (const k of Object.keys(a) as (keyof Counts)[]) a[k] += c[k]
    return a
  }, emptyCounts())
const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0)

const THIS_MACHINE = 'jmac23-3-local'

const channels: ChannelSummary[] = [
  { id: 'gmail-clients', name: 'Gmail · clients', kind: 'mailbox', host: 'mail.google.com', job: 'gmail-clients', area: 'Customers', machine: THIS_MACHINE, every: '30m', watched: true, state: 'running', stateNote: 'enriching 4 threads', counts: counts({}) },
  { id: 'notion-crm', name: 'Notion · CRM', kind: 'database', host: 'notion.so', job: 'notion-crm', area: 'Customers', machine: THIS_MACHINE, every: '2h', watched: true, state: 'parked', stateNote: 'rate limited · retry in 18m', counts: counts({}) },
  { id: 'youtube-saas-growth', name: 'YouTube · SaaS Growth', kind: 'channel', host: 'youtube.com', job: 'youtube-saas-growth', area: 'Product learning', machine: 'studio-mini', every: '6h', watched: true, state: 'running', stateNote: 'transcribing 11 of 20', counts: counts({}) },
  { id: 'somecourse', name: 'somecourse.com · Pricing Strategy', kind: 'course', host: 'somecourse.com', job: 'somecourse-pricing', area: 'Product learning', machine: 'hetzner-01', every: '1d', watched: true, state: 'idle', counts: counts({}) },
  { id: 'rival-site', name: 'Site watch · rival.com', kind: 'site', host: 'rival.com', job: 'rival-pricing', area: 'Competitors', machine: 'hetzner-01', every: '1d', watched: true, state: 'idle', counts: counts({}) },
  { id: 'rss-industry', name: 'RSS · industry feed', kind: 'feed', host: 'feeds.example.com', job: 'rss-industry', area: 'Industry', machine: 'hetzner-01', every: '3h', watched: true, state: 'idle', counts: counts({}) },
  { id: 'hubspot-pages', name: 'HubSpot · pages', kind: 'site', host: 'app.hubspot.com', job: 'hubspot-pages', area: 'Sales enablement', machine: THIS_MACHINE, every: '1d', watched: true, state: 'blocked', stateNote: 'no credential hubspot-api on this machine', counts: counts({}) },
  { id: 'calendar', name: 'Calendar', kind: 'calendar', host: 'calendar.google.com', job: 'calendar', area: 'Customers', machine: 'studio-mini', every: '1h', watched: true, state: 'idle', stateNote: 'quiet today', counts: counts({}) },
  { id: 'distilled', name: 'Distilled by the wiki', kind: 'wiki', area: 'Sales enablement', watched: false, state: 'idle', counts: counts({}) },
]

const areaOrder = ['Customers', 'Product learning', 'Competitors', 'Industry', 'Sales enablement']
const headlines: Record<string, string> = {
  Customers: 'Two client threads raise Q4 renewal terms; Northwind asked for a security questionnaire.',
  'Product learning': '20 new videos from SaaS Growth; 10 transcribed, 10 waiting. 3 new lessons from somecourse.com.',
  Competitors: 'Rival Inc. changed its pricing page: Team tier up 12%, new usage cap.',
  Industry: '4 articles from the industry feed; one on procurement cycles was distilled into your Sales playbook.',
  'Sales enablement': 'The playbook gained two sections overnight. HubSpot pages were not fetched.',
}

function areas(chans: ChannelSummary[] = channelsWithCounts()): AreaSummary[] {
  return areaOrder.map((name) => {
    const chs = chans.filter((c) => c.area === name)
    const c = sum(chs.map((x) => x.counts))
    return { name, count: total(c), counts: c, channels: chs, headline: headlines[name] }
  })
}

const items: NewItem[] = [
  { path: 'sources/youtube/saas-growth/ep-214-pricing-power.md', title: 'Pricing power in a downturn · SaaS Growth ep. 214', kind: 'new', when: at(19, 40), channel: 'youtube-saas-growth', area: 'Product learning', sub: 'transcript · 38 min · 3 takeaways extracted' },
  { path: 'sources/youtube/saas-growth/ep-213-usage-caps.md', title: 'Why usage caps beat seat limits · ep. 213', kind: 'new', when: at(19, 12), channel: 'youtube-saas-growth', area: 'Product learning', sub: 'transcript · 24 min' },
  { path: 'sources/youtube/saas-growth/ep-212-renewals.md', title: 'Founder Q&A: renewals · ep. 212', kind: 'waiting', when: at(18, 55), channel: 'youtube-saas-growth', area: 'Product learning', sub: 'video captured · transcription queued on studio-mini' },
  { path: 'wiki/playbook/packaging.md', title: 'Lesson 6 — packaging for expansion', kind: 'distilled', when: at(16, 30), channel: 'somecourse', area: 'Product learning', sub: 'merged into Sales playbook › Packaging' },
  { path: 'sources/scrapes/somecourse/lesson-4-anchoring.md', title: 'Lesson 4 — anchoring', kind: 'updated', when: at(16, 28), channel: 'somecourse', area: 'Product learning', sub: 'the course revised this lesson; 1 paragraph changed' },
  { path: 'sources/scrapes/somecourse/lesson-7-discount-discipline.md', title: 'Lesson 7 — discount discipline', kind: 'new', when: at(16, 27), channel: 'somecourse', area: 'Product learning', sub: 'new lesson · 1,900 words' },
  { path: 'sources/gmail/clients/northwind-renewal.md', title: 'Northwind · Q4 renewal terms', kind: 'new', when: at(14, 5), channel: 'gmail-clients', area: 'Customers', sub: '3 messages · asks for the security questionnaire by 10 Oct' },
  { path: 'sources/gmail/clients/contoso-renewal.md', title: 'Contoso · renewal and seat count', kind: 'new', when: at(13, 48), channel: 'gmail-clients', area: 'Customers', sub: '2 messages · references the 2025 price list' },
  { path: 'sources/notion/crm/northwind.md', title: 'Northwind (CRM record)', kind: 'updated', when: at(12, 10), channel: 'notion-crm', area: 'Customers', sub: 'stage moved to Renewal · owner unchanged' },
  { path: 'sources/sites/rival/pricing.md', title: 'Rival Inc. · Pricing', kind: 'updated', when: at(3, 10), channel: 'rival-site', area: 'Competitors', sub: 'Team tier +12% · usage cap added' },
  { path: 'sources/rss/industry/procurement-cycles.md', title: 'Procurement cycles are lengthening again', kind: 'new', when: at(9, 20), channel: 'rss-industry', area: 'Industry', sub: 'distilled into Sales playbook › Timing' },
]

// The rest of the day, so every count on the screens is a page you can open,
// and a replay grows them one landing at a time.
const more: Array<[string, ItemKind, number, number, string, string, string?]> = [
  ['distilled', 'distilled', 0, 40, 'wiki/customers/northwind.md', 'Northwind', 'account page merged from 3 threads'],
  ['distilled', 'distilled', 0, 52, 'wiki/customers/contoso.md', 'Contoso', 'renewal history updated'],
  ['distilled', 'distilled', 1, 5, 'wiki/competitors/rival.md', 'Rival Inc.', 'pricing history table extended'],
  ['distilled', 'distilled', 1, 18, 'wiki/industry/procurement.md', 'Procurement cycles', 'new section from 2 articles'],
  ['distilled', 'distilled', 1, 30, 'wiki/playbook/timing.md', 'Sales playbook: timing', 'quarter-end guidance revised'],
  ['rival-site', 'updated', 3, 12, 'sources/sites/rival/plans-faq.md', 'Rival Inc. · Plans FAQ', 'usage cap explained in a new answer'],
  ['rss-industry', 'new', 6, 15, 'sources/rss/industry/seat-based-pricing.md', 'Is seat-based pricing dying?'],
  ['gmail-clients', 'new', 8, 12, 'sources/gmail/clients/fabrikam-pilot.md', 'Fabrikam · pilot kickoff notes', '4 messages · kickoff on Thursday'],
  ['rss-industry', 'new', 9, 5, 'sources/rss/industry/cfo-survey.md', 'CFO survey: software budgets flat for 2027'],
  ['gmail-clients', 'new', 9, 40, 'sources/gmail/clients/tailspin-invoice.md', 'Tailspin · invoice question', '1 message · PO number missing'],
  ['rss-industry', 'distilled', 9, 50, 'wiki/industry/budgets.md', 'Industry: software budgets', 'merged from the CFO survey'],
  ['gmail-clients', 'updated', 10, 55, 'sources/gmail/clients/northwind-security.md', 'Northwind · security questionnaire', 'the thread gained a deadline'],
  ['gmail-clients', 'new', 11, 30, 'sources/gmail/clients/litware-expansion.md', 'Litware · expansion to the EU team', '2 messages · 40 seats'],
  ['rss-industry', 'new', 12, 30, 'sources/rss/industry/usage-billing.md', 'Usage billing, two years in'],
  ['notion-crm', 'updated', 12, 40, 'sources/notion/crm/contoso.md', 'Contoso (CRM record)', 'seat count corrected'],
  ['distilled', 'distilled', 13, 10, 'wiki/customers/renewals-q4.md', 'Q4 renewals', 'two accounts added to the list'],
  ['gmail-clients', 'updated', 15, 20, 'sources/gmail/clients/contoso-seats.md', 'Contoso · seat count follow-up', 'reply from procurement'],
  ['somecourse', 'new', 16, 20, 'sources/scrapes/somecourse/lesson-5-price-fences.md', 'Lesson 5 — price fences', 'new lesson · 1,400 words'],
  ['somecourse', 'new', 16, 31, 'sources/scrapes/somecourse/lesson-8-raising-prices.md', 'Lesson 8 — raising prices', 'new lesson · 2,100 words'],
  ['somecourse', 'distilled', 16, 40, 'wiki/playbook/discounting.md', 'Sales playbook: discounting', 'merged from lesson 7'],
  ['distilled', 'distilled', 16, 45, 'wiki/playbook/pricing-power.md', 'Sales playbook: pricing power', 'merged from ep. 214 and lesson 8'],
  ['gmail-clients', 'new', 17, 45, 'sources/gmail/clients/adventure-works-intro.md', 'Adventure Works · intro from a partner', '1 message · wants a demo next week'],
  ['distilled', 'distilled', 20, 10, 'wiki/learning/saas-growth.md', 'SaaS Growth: what we took from it', '6 episodes summarized'],
]
const episodes = ['Land and expand, revisited', 'The first sales hire', 'Churn is a pricing problem', 'Annual vs monthly', 'Pricing pages that convert', 'Free trials without regret', 'Expansion revenue math', 'When to raise prices', 'Enterprise without the enterprise team', 'Selling to finance', 'The renewal calendar', 'Discounts that do not stick', 'Packaging for PLG', 'Board metrics that matter', 'Hiring your first CSM', 'The pricing committee', 'Reference customers']
episodes.forEach((title, i) => {
  const ep = 195 + i
  const waiting = i < 9
  // The backlog arrives in the evening: 8 transcribed in the afternoon, 9 still queued after 19:45.
  const minute = waiting ? 19 * 60 + 45 + i * 8 : 17 * 60 + 5 + (i - 9) * 13
  more.push(['youtube-saas-growth', waiting ? 'waiting' : 'new', Math.floor(minute / 60), minute % 60, `sources/youtube/saas-growth/ep-${ep}.md`, `${title} · ep. ${ep}`, waiting ? 'video captured · transcription queued on studio-mini' : 'transcript'])
})
for (const [channel, kind, h, m, path, title, sub] of more) {
  const area = channels.find((c) => c.id === channel)?.area
  items.push({ path, title, kind, when: at(h, m), channel, area, sub })
}
items.sort((a, b) => b.when.localeCompare(a.when))

/** Channel counts are the items' own, up to an instant when replaying. */
function channelsWithCounts(upTo?: string): ChannelSummary[] {
  return channels.map((c) => {
    const n = counts({})
    for (const it of items) if (it.channel === c.id && (!upTo || it.when <= upTo)) n[it.kind] += 1
    return { ...c, counts: n }
  })
}

const now: NowItem[] = [
  { id: 't-8f21', what: 'Enriching 4 client threads', who: 'Gmail · clients', machine: THIS_MACHINE, stage: 'enrich', state: 'running', since: at(21, 2) },
  { id: 't-91aa', what: 'Transcribing video 11 of 20', who: 'YouTube · SaaS Growth', machine: 'studio-mini', stage: 'transcribe', state: 'running', since: at(20, 58) },
  { id: 't-7c02', what: 'Notion CRM paused, retrying', who: 'Notion · CRM', machine: THIS_MACHINE, stage: 'harvest', state: 'parked', since: at(20, 46), note: 'rate limited · retry in 18m' },
  { id: 't-6b40', what: 'HubSpot pages not fetched', who: 'HubSpot · pages', machine: THIS_MACHINE, stage: 'harvest', state: 'blocked', since: at(7, 0, -2), note: 'no credential hubspot-api' },
]

const plan: PlanItem[] = [
  { time: at(2, 0), bundle: 'maintenance', text: 'Maintenance · doctor + reindex', status: 'done', machine: 'hetzner-01' },
  { time: at(4, 0), bundle: 'improve', text: 'Improve pass · failed, retries tomorrow', status: 'failed', machine: THIS_MACHINE },
  { time: at(7, 0), bundle: 'morning', text: 'Morning briefing · delivered', status: 'done', machine: THIS_MACHINE },
  { time: at(16, 30), bundle: 'somecourse-pricing', text: 'somecourse.com · 3 lessons', status: 'done', machine: 'hetzner-01' },
  { time: at(21, 2), bundle: 'hourly', text: 'Curate new pages · 22 runs today', status: 'running', machine: THIS_MACHINE },
  { time: at(22, 0), bundle: 'nightly', text: 'Nightly dream · merges today into the wiki', status: 'upcoming', machine: THIS_MACHINE },
  { time: at(22, 0), bundle: 'nightly-index', text: 'Rebuild search index', status: 'upcoming', machine: 'hetzner-01' },
  { time: at(23, 0), bundle: 'hourly', text: 'Curate · last hourly run of the day', status: 'upcoming', machine: THIS_MACHINE },
]

const machines: Machine[] = [
  { name: THIS_MACHINE, thisMachine: true, capabilities: ['harvest', 'index', 'process', 'transcribe'], lastSeen: at(21, 4), state: 'live', running: 1, leases: 3 },
  { name: 'studio-mini', thisMachine: false, capabilities: ['harvest', 'transcribe'], lastSeen: at(21, 2), state: 'live', running: 1, leases: 1 },
  { name: 'hetzner-01', thisMachine: false, capabilities: ['index', 'process'], lastSeen: at(16, 30), state: 'idle', running: 0, leases: 0 },
]

const reports: Briefing[] = [
  { id: 'morning-today', kind: 'morning', title: 'Morning briefing', when: at(7, 2), path: 'wiki/reports/morning/today.md', summary: 'Renewals are the theme this week, and a competitor just moved on price.' },
  { id: 'weekly', kind: 'wiki-report', title: 'Weekly wiki report', when: at(7, 0, -5), path: 'wiki/reports/weekly/last.md', summary: '312 pages distilled · 3 areas grew · 1 stale watch' },
  { id: 'morning-1', kind: 'morning', title: 'Morning briefing', when: at(7, 1, -1), path: 'wiki/reports/morning/yesterday.md', summary: 'Quiet day; two competitor blog posts worth reading' },
  { id: 'improve-1', kind: 'improve', title: 'Improve pass', when: at(4, 12, -1), path: 'wiki/reports/improve/last.md', summary: 'Curate prompt tightened; 4 rejected pages explained' },
  { id: 'morning-2', kind: 'morning', title: 'Morning briefing', when: at(7, 3, -2), path: 'wiki/reports/morning/two-days-ago.md', summary: 'HubSpot pages stopped fetching; credential expired' },
  { id: 'denials-2', kind: 'denials', title: 'Sandbox denials', when: at(1, 0, -2), path: 'wiki/reports/denials/last.md', summary: 'Nothing unexpected · 0 new hosts asked for' },
]

const morningBody = `# Renewals are the theme this week, and a competitor just moved on price.

## Worth your attention

1. **Two clients asked about Q4 renewal terms.** Northwind and Contoso, within a day of each other. Both threads reference the 2025 price list; the current one differs on the Team tier. *(Gmail · clients)*
2. **Rival Inc. raised its Team tier 12% and added a usage cap.** Their pricing page changed at 03:10. The diff is one paragraph and a table row; your positioning note on unlimited seats still holds. *(Site watch · rival.com)*
3. **10 SaaS Growth videos are waiting to be transcribed.** studio-mini is working through them, about 6 minutes each. Episode 214 on pricing power is already in, with 3 takeaways extracted. *(YouTube · SaaS Growth)*

## Customers

Northwind and Contoso both opened renewal threads yesterday. Northwind wants the security questionnaire before 10 October; the wiki has last year's answers under [[Security › Questionnaires]], 14 of 22 still current.

## Learning

The pricing course revised its anchoring lesson, and the SaaS Growth episode on usage caps makes the same argument. Both were distilled into the [[Sales playbook › Packaging]] section overnight.

---
*Written by the morning bundle from 47 pages captured since yesterday's report · 12 sources cited.*
`

const pagesByStem: Record<string, PageView> = {
  'security › questionnaires': { path: 'wiki/security/questionnaires.md', title: 'Security questionnaires', kind: 'topic', when: at(7, 0, -40), areas: ['Customers'], body: `# Security questionnaires\n\nLast year's answers to the Northwind and Contoso questionnaires, 22 questions. 14 still describe the product; the 8 marked *revisit* changed with the SSO rollout.\n\n## Still current\n\n- Data residency: EU (Frankfurt) and US (Oregon), chosen per workspace.\n- Encryption at rest and in transit; keys rotated quarterly.\n\n## Revisit\n\n- SSO: now SAML and OIDC, not SAML only.\n- Audit log retention: 400 days, was 90.\n\nSee [[Sales playbook › Packaging]] for how the security tier is priced.` },
  'sales playbook › packaging': { path: 'wiki/playbook/packaging.md', title: 'Sales playbook: packaging', kind: 'playbook', when: at(16, 30), areas: ['Sales enablement'], body: `# Packaging\n\nHow the tiers are cut and where the expansion path runs.\n\n## Anchor on the outcome\n\nOpen on the value of the outcome, then the annual price; monthly is never shown before annual. *(Distilled from [[Lesson 4 — anchoring]] and SaaS Growth ep. 213.)*\n\n## Usage caps beat seat limits\n\nA cap on usage grows with the customer; a cap on seats fights their org chart.` },
  'lesson 4 — anchoring': { path: 'sources/scrapes/somecourse/lesson-4-anchoring.md', title: 'Lesson 4 — anchoring', kind: 'lesson', when: at(16, 28), areas: ['Product learning'], resource: 'https://somecourse.com/pricing/lesson-4', body: `# Lesson 4 — anchoring\n\nAnchor on the value of the outcome first; the annual price is the second anchor, and monthly is never shown before it.` },
}
const stemOf = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

const wikiList: WikiSummary[] = [
  { key: 'acme-sales', name: 'Acme · Sales', path: '/Users/demo/wikis/acme-sales', pages: 3880, channels: 8, bundlesEnabled: 9, bundlesTotal: 10, health: 'attention', healthNote: '1 channel needs a credential', machines: 3, running: 2, lastRun: { op: 'hourly', outcome: 'ok', when: at(21, 2), actor: `agent@${THIS_MACHINE}`, summary: 'curate: 6 accepted, 0 rejected' }, nextDue: { bundle: 'nightly', at: at(22, 0) } },
  { key: 'life', name: 'Life', path: '/Users/demo/wikis/life', pages: 1204, channels: 5, bundlesEnabled: 9, bundlesTotal: 10, health: 'ok', machines: 1, running: 0, lastRun: { op: 'hourly', outcome: 'ok', when: at(20, 50), actor: 'agent@studio-mini', summary: 'curate: nothing staged' }, nextDue: { bundle: 'nightly', at: at(22, 0) } },
  { key: 'research', name: 'Research', path: '/Users/demo/wikis/research', pages: 640, channels: 2, bundlesEnabled: 6, bundlesTotal: 8, health: 'failing', healthNote: 'search engine unreachable · serving grep', machines: 2, running: 0, lastRun: { op: 'maintenance', outcome: 'failed', when: at(2, 0), actor: 'agent@hetzner-01', summary: 'reindex: engine unreachable' } },
]

function wiki(key: string): WikiSummary {
  const w = wikiList.find((x) => x.key === key)
  if (!w) throw new NotFound(`wiki ${key}`)
  return w
}

const RECENT_MS = 15 * 60_000
const areaWord = (k: number) => `${k} area${k === 1 ? '' : 's'}`
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** The canned day as it stood at `at`: pages that had landed, channels working while theirs land, the plan split at the instant. */
/** The canned day replays as yesterday, so the whole of it lies in the past. */
const DAY_MS = 86_400_000
const back = (iso: string) => (iso ? new Date(new Date(iso).getTime() - DAY_MS).toISOString() : iso)
const yesterday = () => localDay(new Date(Date.now() - DAY_MS))

function dayAt(replayAt: string) {
  // Work in the canned day's own times, then move every answer back a day.
  const at = new Date(new Date(replayAt).getTime() + DAY_MS).toISOString()
  const from = new Date(new Date(at).getTime() - RECENT_MS).toISOString()
  const recent = new Map<string, number>()
  for (const it of items) if (it.when <= at && it.when > from) recent.set(it.channel, (recent.get(it.channel) ?? 0) + 1)
  const chans = channelsWithCounts(at).map<ChannelSummary>((c) => {
    const n = recent.get(c.id) ?? 0
    if (n) return { ...c, state: 'running', stateNote: `${n} captured in the last 15 minutes` }
    return { ...c, state: c.state === 'blocked' ? 'blocked' : 'idle', stateNote: c.state === 'blocked' ? c.stateNote : undefined }
  })
  const dayPlan = plan.map<PlanItem>((p) => {
    if (p.time > at) return { ...p, status: 'upcoming' }
    return p.status === 'upcoming' ? { ...p, status: 'done' } : p
  })
  const nowRows: NowItem[] = chans
    .filter((c) => c.state === 'running')
    .map((c) => ({ id: `ch-${c.id}`, what: `Capturing · ${c.name}`, who: c.name, machine: c.machine ?? '', stage: 'harvest', state: 'running', since: at, note: c.stateNote }))
  for (const p of dayPlan) if (p.status === 'running') nowRows.unshift({ id: `run-${p.bundle}`, what: p.text, who: p.bundle, machine: p.machine ?? '', stage: p.bundle, state: 'running', since: p.time })
  const a = areas(chans).filter((x) => x.count > 0 || x.channels.some((c) => c.state === 'running'))
  const c = sum(a.map((x) => x.counts))
  const runningBy = new Map<string, number>()
  for (const r of nowRows) runningBy.set(r.machine, (runningBy.get(r.machine) ?? 0) + 1)
  return {
    chans,
    dayPlan: dayPlan.map((p) => ({ ...p, time: back(p.time) })),
    nowRows: nowRows.map((r) => ({ ...r, since: back(r.since) })),
    areas: a,
    counts: c,
    runningBy,
    items: items.filter((it) => it.when <= at).map((it) => ({ ...it, when: back(it.when) })),
    briefing: reports[0] && reports[0].when <= at ? { ...reports[0], when: back(reports[0].when) } : undefined,
  }
}

export function fixturesSource(): Source {
  const a = areas()
  const totalCounts = sum(a.map((x) => x.counts))
  const whatsNewNow = (key: string): NewView => ({
    wiki: wiki(key),
    since: midnight(),
    totals: { pages: total(totalCounts), counts: totalCounts },
    areas: a,
    items,
  })
  const fleetNow = (key: string): FleetView => ({
    wiki: wiki(key),
    machines,
    channels: channelsWithCounts(),
    health: { machinesSeen: 3, machinesTotal: 3, runsOk: 90, runsTotal: 91, attention: 1 },
    attention: [
      { id: 'hubspot-cred', title: 'HubSpot needs a credential on jmac23-3', detail: 'llm-wiki-cli wiki acme-sales credential set hubspot-api', severity: 'attention', action: { label: 'Add it', href: '#' } },
    ],
    plan,
  })
  return {
    kind: 'fixtures',
    opsVersion: async () => '0.3.7',
    roots: async (): Promise<WikiRoot[]> => wikiList.map(({ key, name, path }) => ({ key, name, path })),
    wikis: async () => wikiList,
    replayDays: async (key): Promise<ReplayDays> => {
      wiki(key)
      return { days: [{ date: yesterday(), commits: items.length + plan.length }] }
    },
    replayDay: async (key, date): Promise<ReplayDay> => {
      wiki(key)
      const events: ReplayEvent[] = [
        ...items.map<ReplayEvent>((it) => ({ at: it.when, kind: 'page', title: it.title, detail: it.kind, path: it.path, channel: channels.find((c) => c.id === it.channel)?.name })),
        ...plan.filter((p) => p.status !== 'upcoming').map<ReplayEvent>((p) => ({ at: p.time, kind: p.status === 'running' ? 'run-start' : 'run-end', title: p.text, detail: p.status === 'failed' ? 'failed' : 'ok', machine: p.machine })),
      ]
        .map((e) => ({ ...e, at: back(e.at) }))
        .sort((x, y) => x.at.localeCompare(y.at))
      return { date, start: back(midnight()), end: midnight(), events: date === yesterday() ? events : [] }
    },
    today: async (key, when): Promise<TodayView> => {
      const w = wiki(key)
      if (when) {
        const d = dayAt(when)
        const n = total(d.counts)
        return {
          wiki: { ...w, running: d.nowRows.length, nextDue: undefined },
          since: back(midnight()),
          totals: { pages: n, areas: d.areas.filter((x) => x.count > 0).length, counts: d.counts },
          lede: n ? `By ${hhmm(when)} your wiki had gained ${n} page${n === 1 ? '' : 's'} across ${areaWord(d.areas.filter((x) => x.count > 0).length)}.` : `Nothing new yet by ${hhmm(when)}.`,
          areas: d.areas,
          now: d.nowRows,
          plan: d.dayPlan,
          attention: d.dayPlan.filter((p) => p.status === 'failed').map((p) => ({ id: `run-${p.bundle}`, title: p.text, detail: `on ${p.machine ?? 'a machine'}`, severity: 'failing' as const })),
          briefing: d.briefing,
        }
      }
      return {
        wiki: w,
        since: midnight(),
        totals: { pages: total(totalCounts), areas: a.filter((x) => x.count > 0).length, counts: totalCounts },
        lede: `Since this morning your wiki gained ${total(totalCounts)} pages across ${a.filter((x) => x.count > 0).length} areas. Three things are worth a look, and one channel needs a credential.`,
        areas: a,
        now: now.slice(0, 3),
        plan,
        attention: [
          { id: 'hubspot-cred', title: "HubSpot pages can't be fetched", detail: `no credential on ${THIS_MACHINE} · since Thursday`, severity: 'attention', action: { label: 'Fix', href: '/fleet' } },
        ],
        briefing: reports[0],
      }
    },
    whatsNew: async (key, _since, when): Promise<NewView> => {
      if (!when) return whatsNewNow(key)
      const d = dayAt(when)
      return { wiki: { ...wiki(key), running: d.nowRows.length, nextDue: undefined }, since: back(midnight()), totals: { pages: total(d.counts), counts: d.counts }, areas: d.areas, items: d.items }
    },
    fleet: async (key, when): Promise<FleetView> => {
      if (!when) return fleetNow(key)
      const d = dayAt(when)
      const done = d.dayPlan.filter((p) => p.status === 'done' || p.status === 'failed')
      return {
        wiki: { ...wiki(key), running: d.nowRows.length, nextDue: undefined },
        machines: machines.map((m) => ({ ...m, running: d.runningBy.get(m.name) ?? 0, state: d.runningBy.get(m.name) ? 'live' : 'idle' })),
        channels: d.chans,
        health: { machinesSeen: 3, machinesTotal: 3, runsOk: done.filter((p) => p.status === 'done').length, runsTotal: done.length, attention: d.chans.filter((c) => c.state === 'blocked').length },
        attention: [],
        plan: d.dayPlan,
      }
    },
    briefings: async (key): Promise<BriefingsView> => ({ wiki: wiki(key), reports }),
    briefing: async (key, id) => {
      wiki(key)
      const r = reports.find((x) => x.id === id)
      return r ? { ...r, body: r.id === 'morning-today' ? morningBody : `# ${r.title}\n\n${r.summary}\n` } : null
    },
    page: async (key, rel) => {
      wiki(key)
      return Object.values(pagesByStem).find((p) => p.path === rel) ?? null
    },
    resolve: async (key, link): Promise<Resolved | null> => {
      wiki(key)
      const full = stemOf(link.split('|')[0] ?? '')
      const page = pagesByStem[full] ?? Object.entries(pagesByStem).find(([k]) => k.split('›')[0]?.trim() === linkStem(link))?.[1]
      return page ? { link, path: page.path } : null
    },
    search: async (key, params): Promise<SearchView> => {
      wiki(key)
      const words = params.q.toLowerCase().split(/\s+/).filter(Boolean)
      const wantArea = params.filters?.area?.toLowerCase()
      const wantUnder = params.filters?.under
      const hits = Object.values(pagesByStem)
        .filter((p) => !wantArea || p.areas.some((a) => a.toLowerCase() === wantArea))
        .filter((p) => !wantUnder || p.path.startsWith(`${wantUnder}/`))
        .map((p) => {
          const hay = `${p.title} ${p.body}`.toLowerCase()
          const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) / Math.max(1, words.length)
          return { p, score }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, params.k ?? 10)
        .map((x, i) => ({
          rank: i + 1,
          score: x.score,
          path: x.p.path,
          title: x.p.title,
          snippet: x.p.body.replace(/^#.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 240),
          curation: 'curated',
        }))
      return { q: params.q, backend: 'fixtures', degraded: false, count: hits.length, hits, emulated: [], degradations: [] }
    },
    facets: async (key): Promise<Facets> => {
      wiki(key)
      return {
        areas: areaOrder,
        tags: ['renewal', 'pricing', 'security', 'competitor', 'transcript'],
        types: ['lesson', 'topic', 'playbook', 'thread', 'transcript', 'report'],
        groups: ['Pricing Strategy', 'SaaS Growth', 'clients'],
        groupTypes: ['course', 'channel', 'mailbox'],
        hosts: ['mail.google.com', 'notion.so', 'youtube.com', 'somecourse.com', 'rival.com'],
        authors: ['Northwind', 'Contoso', 'SaaS Growth'],
        curations: ['curated', 'staged', 'uncurated'],
        unders: ['wiki', 'sources', 'research'],
      }
    },
  }
}
