// The shell around one wiki: the header with the product name, the four
// screens, the wiki switcher, and the live/mode badges. The screens render
// into the outlet.

import { useEffect } from 'react'
import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronDown, History, Monitor, Moon, Sun } from 'lucide-react'
import { useConfig, useWikis } from '@/lib/api'
import { useLiveEvents } from '@/lib/events'
import { longDate } from '@/lib/format'
import { ReplayProvider, useReplay } from '@/lib/replay'
import { ReplayBar } from '@/components/ReplayBar'
import { WikiSwitcher } from '@/components/WikiSwitcher'
import { useSwitch } from '@/lib/prefs'
import { THEMES, useTheme, type Mode } from '@/lib/theme'
import { Dot, HealthDot, Pill, cn } from '@/components/ui'

export const Route = createFileRoute('/w/$key')({ component: Shell })

function Shell() {
  const { key } = Route.useParams()
  return (
    <ReplayProvider key={key} wikiKey={key}>
      <ShellInner />
    </ReplayProvider>
  )
}

function ShellInner() {
  const { key } = Route.useParams()
  const cfg = useConfig()
  const wikis = useWikis()
  const replay = useReplay()
  const replaying = Boolean(replay?.active)
  const live = useLiveEvents(replaying)
  const navigate = useNavigate()
  const [showDemoChip, setShowDemoChip] = useSwitch('dashboard.demoChip', true)

  // `/` goes to Search from any screen; `d` brings the demo label back. Neither fires while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))
      )
        return
      if (e.key === '/') {
        e.preventDefault()
        void navigate({ to: '/w/$key/search', params: { key } }).then(() =>
          document.getElementById('search-box')?.focus(),
        )
      } else if (e.key === 'd') setShowDemoChip(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, navigate, setShowDemoChip])
  const look = useTheme()
  const wiki = wikis.data?.find((w) => w.key === key)
  const name = cfg.data?.productName ?? ''

  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6 lg:px-10">
        <div className="flex items-center gap-7">
          <Link to="/" className="display text-[22px]" title={cfg.data?.tagline}>
            {name}
          </Link>
          <nav className="flex gap-5 text-sm">
            <Tab to="/w/$key" params={{ key }} exact label="Today" />
            <Tab to="/w/$key/new" params={{ key }} label="What's new" />
            <Tab to="/w/$key/fleet" params={{ key }} label="Fleet" />
            <Tab to="/w/$key/briefings" params={{ key }} label="Briefings" />
            <Tab to="/w/$key/learned" params={{ key }} label="Learned" />
            <Tab to="/w/$key/search" params={{ key }} label="Search" />
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {cfg.data && cfg.data.source === 'fixtures' && showDemoChip && (
            <Pill tone="warn">
              demo data
              <button
                type="button"
                aria-label="Hide the demo data label"
                title="Hide (press D to bring it back)"
                onClick={() => setShowDemoChip(false)}
                className="-mr-1 opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </Pill>
          )}
          {cfg.data && cfg.data.mode === 'write' && <Pill tone="accent">write mode</Pill>}
          <span className="hidden text-sm text-ink-2 md:inline">
            {replaying && replay?.day ? longDate(new Date(replay.clock)) : longDate()}
          </span>
          <button
            type="button"
            onClick={() => (replaying ? replay?.stop() : replay?.start())}
            aria-pressed={replaying}
            title={replaying ? 'Back to live' : 'Replay a recorded day'}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-pill border px-3 text-sm transition-colors',
              replaying
                ? 'border-ink bg-ink text-paper'
                : 'border-line-2 bg-card text-ink-2 hover:text-ink',
            )}
          >
            <History className="size-4" />
            Replay
          </button>
          <WikiSwitcher current={key} wikis={wikis.data} />
          <label className="relative flex h-9 items-center rounded-pill border border-line-2 bg-card pl-3 pr-7 text-sm">
            <select
              aria-label="Theme"
              className="appearance-none bg-transparent outline-none"
              value={look.theme}
              onChange={(e) => look.setTheme(e.target.value as (typeof THEMES)[number]['id'])}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-ink-2" />
          </label>
          <div
            role="radiogroup"
            aria-label="Light or dark"
            className="flex h-9 overflow-hidden rounded-pill border border-line-2 bg-card"
          >
            {(
              [
                ['system', Monitor, 'Follow the system'],
                ['light', Sun, 'Light'],
                ['dark', Moon, 'Dark'],
              ] as const
            ).map(([m, Icon, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={look.mode === m}
                aria-label={label}
                title={label}
                onClick={() => look.setMode(m as Mode)}
                className={cn(
                  'flex w-9 items-center justify-center transition-colors',
                  look.mode === m ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink',
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          <span
            title={live.connected ? 'live updates connected' : 'live updates reconnecting'}
            className="flex items-center"
          >
            <Dot
              color={live.connected ? 'var(--color-live)' : 'var(--color-ink-3)'}
              live={live.connected}
              className="size-2"
            />
          </span>
        </div>
      </header>
      <ReplayBar />
      <main className="mx-auto max-w-[1440px] px-6 pb-12 lg:px-10">
        <Outlet />
      </main>
    </div>
  )
}

function Tab({
  to,
  params,
  label,
  exact,
}: {
  to: string
  params: { key: string }
  label: string
  exact?: boolean
}) {
  return (
    <Link
      to={to}
      params={params}
      activeOptions={{ exact: Boolean(exact) }}
      className={cn(
        'border-b-2 border-transparent pb-0.5 text-ink-2 transition-colors hover:text-ink',
      )}
      activeProps={{ className: 'border-ink! font-semibold text-ink!' }}
    >
      {label}
    </Link>
  )
}
