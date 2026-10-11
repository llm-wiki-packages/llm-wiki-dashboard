# llm-wiki Mission Control — design brief

Standalone dashboard (node server + browser) that reads the llm-wiki CLI's
`--json` output and shows what the system is doing to a person's "life":
which sources are being pulled, by which wiki, on which machine, and what
came out of it. Two audiences: the operator watching their own machine, and
a prospect watching a demo. It must be visually convincing to the second.

## Information architecture — two screens, one drill-down chain

1. **Home (machine view)** — every wiki registered on this machine, and the
   machines joined to each wiki. This machine is the vantage point.
2. **Wiki view** — one wiki's activity: sources → pipeline stages → wiki,
   jobs running on a timeline, and drill-down to job → ticket → logs.

Home ➜ click a wiki ➜ Wiki view ➜ click a job/edge ➜ tickets ➜ click a
ticket ➜ record + logs (side panel, not a new page).

## Home screen — content

Layout: a graph, not a table. Wikis are the large nodes; machines are the
small nodes joined to them. A machine joined to two wikis has two edges.
This machine is highlighted. Live work pulses along the wiki↔machine edge.

Per wiki node:
- name, key                                (`machine wikis ls`)
- pages in corpus (e.g. 103)               (`search status`.corpus_files)
- sources watched (pipeline jobs)          (`jobs ls`, kind pipeline)
- jobs active / total (14/15)              (`jobs ls` states)
- search state: engine | grep fallback     (`search status`.serving)
- last run: op, outcome, when              (`op since`.runs[0])
- next due                                 (`jobs due`.jobs: window, due, due_since)
- health dot: ok / attention / failing     (`doctor`)
- git: unpushed, behind, dirty             (`status`.git)

Per machine node:
- machine name (e.g. jmac23-3-local), this-machine badge
- capabilities: harvest, index, process, transcribe   (`status --peers`)
- last seen (relative), state (no-cadence / live / stale)
- what it currently holds: N running tickets, N leases

Top strip, big numerals: pages captured today · distilled this week ·
sources watched · runs in the last 24h. These sell "compounding".

Header right: LIVE ● / REPLAY ▶ toggle with a speed chip (1x 10x 50x) and a
time scrubber. Replay is first-class; demos happen when nothing is running.

## Wiki screen — content

### Hero: the flow map
Three columns, left to right:
- **Sources** — one node per distinct source host across the wiki's jobs
  (Gmail, Notion, YouTube, RSS feed, website, dropped files). One hue each,
  brand-neutral, not brand colors.
- **Stages** — five vertical lanes, fixed order:
  harvest → transcribe → enrich → process → handoff.
  Each lane shows cap and active (e.g. enrich 1/2) from `pipeline due`.caps.
- **Wiki** — the destination node, with the corpus page count.
Edges are jobs. A running ticket = particles moving along the edge through
its current lane. Idle edges dim threads. States that need a color:
running · pending · review · parked (amber) · blocked (amber, with reason)
· failed (red) · done (brief green flash, then dims) · paused job (dashed).

### Second: activity strip
Horizontal time axis (24h default, 7d option). One swimlane per **machine**
joined to this wiki. Bars are job runs: name (ops-hourly, ops-hourly-host,
ops-nightly, ops-nightly-host, ops-morning, ops-denials, ops-synthesize, and
the watches), duration, outcome color. Running bars pulse at the right edge.
Job windows (e.g. ops-nightly 22:00–06:00) are faint bands behind the lane.
Data: `op since`, `jobs due`, `tickets ls`.

### Side panel drill-down (slides in from the right)
- Job card: target, source host, dest, every, skill, state holders per
  stage, blocked reason. (`pipeline jobs show`)
- Ticket list: stage, state, attempts, not_before, machine.
  (`pipeline tickets ls`)
- Ticket record: everything it carries incl. the egress its slice was
  minted with — sandbox name + allowed hosts. Show this; it is the security
  story. (`pipeline tickets show`)
- Logs: a dense filterable table over the trace log rows
  {at, kind, argv, rc, elapsed_s, signal, stderr_tail}. Filters: since,
  kind, event, rc≠0, text. Plain and fast. (`op logs`, trace jsonl tail)

## Visual direction
- Dark, sparse, "operations room". Large canvas, thin type, generous space.
- Motion only where work is live. Nothing bounces when idle.
- One hue per source; stages neutral; outcomes use amber/red/green sparingly.
- Numbers are large where they sell (top strip) and small everywhere else.
- Must also read at laptop width in a meeting room projector: high contrast,
  no 10px labels on the hero.
- Light mode is optional; dark is the demo mode.

## States to design (not just the happy path)
- Home with 3 wikis × 2 machines, one wiki failing, one machine stale.
- Wiki view with 6 sources, 2 running tickets, 1 parked, 1 blocked
  (missing credential), one paused job.
- Wiki view with nothing running (the honest default): what makes it not
  look dead? Answer: the activity strip and the counters, plus "next due in
  42m".
- Replay mode active at 10x with the scrubber mid-way.
- Empty machine: one wiki, no jobs, one machine (this is the real state of
  the dev box today; see real-shapes below).

## Real JSON shapes (from this machine, 2026-09-27, wiki `knowledgebase`)
As captured then. Since retired: `schedule ls` and `status.schedules` (the
bundles became jobs), and the `pipeline` and `schedule` groups (now `jobs`,
`tickets`, `denylist` and `tick`).
```json
// machine wikis ls
{"count":1,"wikis":[{"key":"knowledgebase","name":"llm-wiki-knowledgebase","path":"/Users/joe/Development/ai-tools/llm-wiki-knowledgebase"}]}
// status --peers (trimmed)
{"name":"llm-wiki-knowledgebase","key":"knowledgebase","machine":"jmac23-3-local","ops_version":"0.3.7",
 "git":{"branch":"main","head":"5da078c1","dirty":0,"unpushed":0,"behind":0},
 "schedules":{"total":10,"enabled":["denials","hourly","hourly-host","improve","maintenance","morning","nightly","nightly-index","wiki-report"]},
 "peers":[{"machine":"jmac23-3-local","capabilities":["harvest","index","process","transcribe"],"last_seen":"2026-09-26T19:55:08+00:00","state":"no-cadence"}]}
// pipeline due
{"running":[],"pending":[],"review":[],"parked":[],"jobs":[],
 "caps":{"harvest":{"cap":1,"active":0},"transcribe":{"cap":1,"active":0},"enrich":{"cap":2,"active":0},"process":{"cap":2,"active":0},"handoff":{"cap":1,"active":0}},
 "handoffs":{"outgoing":[],"incoming":[],"shipping":[],"problems":[]}}
// schedule ls (one bundle)
{"name":"nightly","enabled":true,"every":"1d","window":"22:00-06:00","stages":["/llm-wiki:dream"],"sandbox":"wiki-write","error":null}
// op since filter=since:7d (one run)
{"op":"grill","outcome":"ok","summary":"grill setup: CLAUDE.md purpose/scope section, grill overlay","when":"2026-09-26T14:53:38-07:00","actor":"agent@jmac23-3-local","session":"ccc0abd3-…"}
// op logs / trace jsonl (one row)
{"argv":["doctor","--statusline","--json"],"at":"2026-09-27T20:04:11.116Z","elapsed_s":0,"kind":"dispatch","rc":130,"stderr_tail":"…"}
// search status (trimmed)
{"serving":"grep","engine_configured":true,"realm_ready":false,"realm_reason":"unreachable","corpus_files":103}
```

## Illustrative dataset for the mockups (invented, plausible)
Wikis: `life` (Joe's personal, 1,204 pages), `acme-sales` (2 machines,
3,880 pages), `research` (failing: search engine unreachable, 2 parked).
Machines: `jmac23-3-local` (this machine, harvest/index/process/transcribe),
`studio-mini` (harvest/transcribe), `hetzner-01` (index/process, stale 3d).
Sources for `acme-sales`: Gmail (2 mailboxes), Notion (2 databases), a
YouTube channel, an RSS feed, hubspot.com pages, a dropped-files inbox.
Live: Gmail→enrich running, YouTube→transcribe running, Notion→harvest
parked (rate limited, not_before +18m), hubspot→harvest blocked (missing
credential `hubspot-api`), RSS paused.
Last 24h runs on `acme-sales`: hourly ×22 ok, hourly-host ×22 ok (one 40s
outlier), morning ok, nightly ok, nightly-index ok, maintenance ok,
improve failed (rc 1), denials ok, wiki-report ok.

## Out of scope for the design
Auth, multi-tenant, mobile. It runs on the operator's machine or a demo box.
