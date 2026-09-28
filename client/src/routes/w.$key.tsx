// The shell around one wiki: the header with the product name, the four
// screens, the wiki switcher, and the live/mode badges. The screens render
// into the outlet.

import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useConfig, useWikis } from '@/lib/api'
import { useLiveEvents } from '@/lib/events'
import { longDate } from '@/lib/format'
import { Dot, HealthDot, Pill, cn } from '@/components/ui'

export const Route = createFileRoute('/w/$key')({ component: Shell })

function Shell() {
  const { key } = Route.useParams()
  const cfg = useConfig()
  const wikis = useWikis()
  const live = useLiveEvents()
  const navigate = useNavigate()
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
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {cfg.data && cfg.data.source === 'fixtures' && <Pill tone="warn">demo data</Pill>}
          {cfg.data && cfg.data.mode === 'write' && <Pill tone="accent">write mode</Pill>}
          <span className="hidden text-sm text-ink-2 md:inline">{longDate()}</span>
          <label className="relative flex h-9 items-center gap-2 rounded-pill border border-line-2 bg-card pl-3 pr-8 text-sm">
            {wiki && <HealthDot health={wiki.health} />}
            <select
              aria-label="Wiki"
              className="appearance-none bg-transparent pr-2 outline-none"
              value={key}
              onChange={(e) => void navigate({ to: '/w/$key', params: { key: e.target.value } })}
            >
              {(wikis.data ?? [{ key, name: key }]).map((w) => (
                <option key={w.key} value={w.key}>
                  {w.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-ink-2" />
          </label>
          <span title={live.connected ? 'live updates connected' : 'live updates reconnecting'} className="flex items-center">
            <Dot color={live.connected ? 'var(--color-live)' : 'var(--color-ink-3)'} live={live.connected} className="size-2" />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-6 pb-12 lg:px-10">
        <Outlet />
      </main>
    </div>
  )
}

function Tab({ to, params, label, exact }: { to: string; params: { key: string }; label: string; exact?: boolean }) {
  return (
    <Link
      to={to}
      params={params}
      activeOptions={{ exact: Boolean(exact) }}
      className={cn('border-b-2 border-transparent pb-0.5 text-ink-2 transition-colors hover:text-ink')}
      activeProps={{ className: 'border-ink! font-semibold text-ink!' }}
    >
      {label}
    </Link>
  )
}
