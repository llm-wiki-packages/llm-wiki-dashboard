// The small pieces every screen is made of. They only name theme tokens, so
// the look changes in theme.css, not here.

import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Health, ItemKind } from '@dashboard/shared/types'
import { hueSlot } from '@/lib/format'

export const cn = (...v: Parameters<typeof clsx>) => twMerge(clsx(...v))

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-card border border-line bg-card p-5', className)}>{children}</div>
  )
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="text-[13px] uppercase tracking-[0.08em] text-ink-2">{children}</div>
      {right}
    </div>
  )
}

export function Dot({ color, live, className }: { color: string; live?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-full', live && 'live-pulse', className)}
      style={{ background: color }}
    />
  )
}

export const CH = (id: string) => `var(--color-ch-${hueSlot(id)})`

export function ChannelDot({ id, live }: { id: string; live?: boolean }) {
  return <Dot color={CH(id)} live={live} />
}

export function HealthDot({ health }: { health: Health }) {
  const color =
    health === 'ok' ? 'var(--color-good)' : health === 'attention' ? 'var(--color-warn)' : 'var(--color-bad)'
  return <Dot color={color} />
}

export function Pill({ children, className, tone = 'paper' }: { children: ReactNode; className?: string; tone?: 'paper' | 'accent' | 'warn' | 'live' | 'ink' }) {
  const tones = {
    paper: 'bg-paper text-ink-2',
    accent: 'bg-accent text-accent-ink',
    warn: 'bg-warn-bg text-warn-ink',
    live: 'bg-card text-ink border border-line',
    ink: 'bg-ink text-paper',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

const KIND_LABEL: Record<ItemKind, string> = {
  new: 'New',
  updated: 'Updated',
  waiting: 'Waiting',
  distilled: 'Distilled',
  failed: 'Failed',
}

export function KindBadge({ kind }: { kind: ItemKind }) {
  return (
    <span
      className="inline-block rounded-pill px-2 py-0.5 text-center text-[11px] font-semibold"
      style={{ background: `var(--color-kind-${kind}-bg)`, color: `var(--color-kind-${kind}-ink)` }}
    >
      {KIND_LABEL[kind]}
    </span>
  )
}

export function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: 'warn' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn('text-2xl font-semibold tabular-nums', tone === 'warn' && 'text-warn-ink')}>{value}</span>
      <span className="text-xs text-ink-2">{label}</span>
    </div>
  )
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-card border border-dashed border-line-2 p-5">
      <div className="text-[15px] font-medium">{title}</div>
      {body && <div className="text-sm text-ink-2">{body}</div>}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  const e = error as { message?: string; status?: number; detail?: string }
  return (
    <div className="rounded-card bg-bad-bg p-4 text-sm text-bad-ink">
      <div className="font-semibold">Could not load this.</div>
      <div>{e?.message ?? 'unknown error'}</div>
      {e?.detail && <pre className="mt-2 overflow-auto text-xs whitespace-pre-wrap">{e.detail}</pre>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-card bg-paper-2', className)} />
}

export function Button({ children, active, onClick, className }: { children: ReactNode; active?: boolean; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-[34px] px-3.5 text-[13px] transition-colors',
        active ? 'bg-ink text-paper' : 'bg-transparent text-ink-2 hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Segmented({ children }: { children: ReactNode }) {
  return <div className="flex overflow-hidden rounded-pill border border-line-2 bg-card">{children}</div>
}
