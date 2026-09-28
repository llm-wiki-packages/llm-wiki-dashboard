// The fleet picture: the wiki at the center, machines on the inner ring, the
// channels each machine pulls on the outer ring, today's counts on the edges,
// and particles moving on the edges that are working right now.

import type { ChannelSummary, Machine } from '@dashboard/shared/types'
import { CH } from './ui'

const W = 960
const H = 700
const CX = 480
const CY = 360
const R_MACHINES = 140
const R_CHANNELS = 290

interface Pt {
  x: number
  y: number
}
const polar = (r: number, deg: number): Pt => ({
  x: CX + r * Math.cos((deg * Math.PI) / 180),
  y: CY + r * Math.sin((deg * Math.PI) / 180),
})

function countLabel(c: ChannelSummary): string {
  const parts: string[] = []
  if (c.counts.new) parts.push(`${c.counts.new} new`)
  if (c.counts.updated) parts.push(`${c.counts.updated} updated`)
  if (c.counts.waiting) parts.push(`${c.counts.waiting} waiting`)
  if (c.counts.distilled) parts.push(`${c.counts.distilled} distilled`)
  if (c.counts.failed) parts.push(`${c.counts.failed} failed`)
  if (!parts.length) return c.stateNote ?? (c.state === 'paused' ? 'paused' : 'quiet today')
  return parts.join(' · ')
}

export function Orbit({ wiki, pages, machines, channels, emptyNote }: { wiki: string; pages: number; machines: Machine[]; channels: ChannelSummary[]; emptyNote?: string }) {
  const ms = machines.length ? machines : [{ name: 'this machine', thisMachine: true, capabilities: [], lastSeen: null, state: 'idle', running: 0, leases: 0 } as Machine]
  const machinePos = new Map<string, Pt>()
  ms.forEach((m, i) => machinePos.set(m.name, polar(R_MACHINES, -90 + (360 / ms.length) * i)))

  // Channels sit near the machine that pulls them; unowned ones share the last slot.
  const byMachine = new Map<string, ChannelSummary[]>()
  for (const c of channels) {
    const owner = c.machine && machinePos.has(c.machine) ? c.machine : (ms[0]?.name ?? '')
    byMachine.set(owner, [...(byMachine.get(owner) ?? []), c])
  }
  const channelPos = new Map<string, Pt>()
  const sector = 360 / ms.length
  ms.forEach((m, i) => {
    const list = byMachine.get(m.name) ?? []
    const base = -90 + sector * i
    const spread = Math.min(sector - 10, 28 * Math.max(1, list.length - 1))
    list.forEach((c, j) => {
      const deg = list.length === 1 ? base : base - spread / 2 + (spread / (list.length - 1)) * j
      channelPos.set(c.id, polar(R_CHANNELS, deg))
    })
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Orbit of ${wiki}: machines and the channels they harvested today`}>
      <circle cx={CX} cy={CY} r={R_MACHINES} fill="none" stroke="var(--color-line)" />
      <circle cx={CX} cy={CY} r={R_CHANNELS} fill="none" stroke="var(--color-line)" strokeDasharray="2 6" />

      {ms.map((m) => {
        const p = machinePos.get(m.name)!
        const live = m.running > 0
        return (
          <g key={m.name}>
            <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={live ? 'var(--color-live)' : 'var(--color-line-2)'} strokeWidth={2} />
          </g>
        )
      })}

      {channels.map((c) => {
        const p = channelPos.get(c.id)
        const m = machinePos.get(c.machine && machinePos.has(c.machine) ? c.machine : (ms[0]?.name ?? ''))
        if (!p || !m) return null
        const live = c.state === 'running'
        const blocked = c.state === 'blocked' || c.state === 'failed'
        const seenOnly = !c.watched
        const hue = CH(c.id)
        // Counts sit nearer the channel than the machine, clear of the machine's ring.
        const mid = { x: m.x + (p.x - m.x) * 0.62, y: m.y + (p.y - m.y) * 0.62 }
        const labelAnchor = p.x < CX - 20 ? 'end' : p.x > CX + 20 ? 'start' : 'middle'
        return (
          <g key={c.id}>
            <line x1={m.x} y1={m.y} x2={p.x} y2={p.y} stroke={blocked ? 'var(--color-warn)' : hue} strokeWidth={1.5} strokeDasharray={blocked || c.state === 'paused' || seenOnly ? '3 5' : undefined} opacity={c.state === 'idle' && !Object.values(c.counts).some(Boolean) ? 0.35 : 0.8} />
            {live && (
              <>
                <circle r={3.5} fill="var(--color-live)">
                  <animateMotion dur="2.4s" repeatCount="indefinite" path={`M${p.x} ${p.y} L${m.x} ${m.y} L${CX} ${CY}`} />
                </circle>
                <circle r={3.5} fill="var(--color-live)">
                  <animateMotion dur="2.4s" begin="1.2s" repeatCount="indefinite" path={`M${p.x} ${p.y} L${m.x} ${m.y} L${CX} ${CY}`} />
                </circle>
              </>
            )}
            <text x={mid.x} y={mid.y - 6} textAnchor="middle" fontSize={11} fill={blocked ? 'var(--color-warn-ink)' : 'var(--color-ink-2)'} style={{ paintOrder: 'stroke', stroke: 'var(--color-card)', strokeWidth: 4 }}>
              {countLabel(c)}
            </text>
            <circle cx={p.x} cy={p.y} r={15} fill={blocked ? 'var(--color-warn-bg)' : 'var(--color-card)'} stroke={blocked ? 'var(--color-warn)' : hue} strokeWidth={seenOnly ? 1.5 : 2.5} strokeDasharray={blocked || seenOnly ? '3 3' : undefined} />
            <text x={p.x} y={p.y < CY ? p.y - 22 : p.y + 34} textAnchor={labelAnchor} fontSize={13} fill="var(--color-ink)">
              {c.name}
            </text>
          </g>
        )
      })}

      {ms.map((m) => {
        const p = machinePos.get(m.name)!
        const live = m.running > 0
        const stale = m.state === 'stale'
        return (
          <g key={m.name} textAnchor="middle">
            <circle cx={p.x} cy={p.y} r={40} fill="var(--color-card)" stroke={live ? 'var(--color-live)' : stale ? 'var(--color-warn)' : 'var(--color-line-2)'} strokeWidth={2} strokeDasharray={stale ? '4 4' : undefined} />
            {live && <circle cx={p.x} cy={p.y} r={48} fill="none" stroke="var(--color-live)" strokeWidth={1} className="live-pulse" />}
            <text x={p.x} y={p.y - 3} fontSize={12} fontWeight={600} fill="var(--color-ink)">
              {m.name.length > 15 ? `${m.name.slice(0, 14)}…` : m.name}
            </text>
            <text x={p.x} y={p.y + 13} fontSize={11} fill={live ? 'var(--color-live)' : stale ? 'var(--color-warn-ink)' : 'var(--color-ink-2)'}>
              {live ? `${m.running} running` : stale ? 'stale' : m.thisMachine ? 'this machine' : 'idle'}
            </text>
          </g>
        )
      })}

      {channels.length === 0 && emptyNote && (
        <text x={CX} y={CY + R_CHANNELS + 24} textAnchor="middle" fontSize={13} fill="var(--color-ink-2)">
          {emptyNote}
        </text>
      )}

      {/* The wiki, as a pill that sizes to its name: HTML inside the SVG so long
          names wrap instead of spilling out of a fixed disc. */}
      <foreignObject x={CX - 140} y={CY - 60} width={280} height={120} style={{ overflow: 'visible' }}>
        <div
          {...{ xmlns: 'http://www.w3.org/1999/xhtml' }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, width: 280, height: 120 }}
        >
          <div
            style={{
              maxWidth: 268,
              padding: '10px 20px',
              borderRadius: 999,
              background: 'var(--color-ink)',
              color: 'var(--color-paper)',
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              lineHeight: 1.15,
              fontWeight: 600,
              textAlign: 'center',
              textWrap: 'balance',
              overflowWrap: 'anywhere',
              boxShadow: '0 0 0 6px var(--color-card)',
            }}
          >
            {wiki}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-ink-2)', background: 'var(--color-card)', padding: '2px 8px', borderRadius: 999 }}>
            {pages ? `+${pages} today` : 'quiet today'}
          </div>
        </div>
      </foreignObject>
    </svg>
  )
}
