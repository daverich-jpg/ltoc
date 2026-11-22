// Incident timeline, after the moodboard:
// 1. Units: a small Gantt. Callsign and status on the left, one bar per unit on a shared time axis
//    (hatched until acknowledged, green once on scene), with a Now line.
// 2. Log: events grouped under the phase they happened in, newest phase first, on one connector line.
//    Finished phases fold to a count; the current phase stays open. Rows stay quiet until hovered.
import { useState } from 'react'
import { Ambulance, ArrowsSplit, BellRinging, Broadcast, CaretDown, Car, ClipboardText, FireTruck, Flag, Lifebuoy, Lightning, Megaphone, NotePencil, Siren, Sparkle, Truck, WarningCircle } from './icons'
import type { Incident, TimelineEvent, UnitType } from '../sim/types'
import { assignmentOverdue, lastConf } from '../sim/derive'
import { fmtTime } from './bits'
import { useSim } from './store'

const short = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} m` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} m` }
const UNIT_ICON: Record<UnitType, typeof Car> = { patrol: Car, rescue: Lifebuoy, ambulance: Ambulance, fire: FireTruck, police: Siren, recovery: Truck }

type Cat = { key: string; label: string; icon: typeof Car }
function categoryOf(e: TimelineEvent): Cat | null {
  if (e.kind === 'state') return null // phases are the headings
  if (e.actor.includes('AI suggestion')) return { key: 'ai', label: 'AI assist', icon: Sparkle }
  switch (e.kind) {
    case 'note': return { key: 'note', label: 'Note', icon: NotePencil }
    case 'message': return { key: 'message', label: 'Public message', icon: Megaphone }
    case 'assess': return { key: 'assess', label: 'Assessment', icon: ClipboardText }
    case 'diversion': return { key: 'diversion', label: 'Diversion', icon: ArrowsSplit }
    case 'notify': return /acknowledged/.test(e.text) ? null : { key: 'notify', label: 'Agency notified', icon: BellRinging }
    case 'failure': return { key: 'failure', label: 'Failed command', icon: WarningCircle }
    case 'source': return { key: 'source', label: 'Report', icon: Broadcast }
    // unit progress lives in the lanes above; the log keeps only dispatches and anything unusual
    case 'assign': case 'unit': return /position report|acknowledged|en route|on scene\. Confirmed/i.test(e.text) ? null : { key: 'unit', label: 'Units', icon: Truck }
    case 'system': return /overdue|Raised to Act now/.test(e.text) ? { key: 'alert', label: 'Escalation', icon: Lightning } : { key: 'system', label: 'Field request', icon: Flag }
    default: return null
  }
}

export function TimelineTrack({ inc }: { inc: Incident }) {
  return <div className="tlx">{inc.assignments.length > 0 && <UnitLanes inc={inc} />}<PhaseLog inc={inc} /></div>
}

// ---------- 1. Units ----------
function UnitLanes({ inc }: { inc: Incident }) {
  const S = useSim()
  const live = !inc.closedAt
  const t0 = Math.min(...inc.assignments.map(a => a.history[0].at))
  const t1 = Math.max(inc.closedAt ?? S.now, t0 + 120000)
  const pct = (t: number) => ((t - t0) / (t1 - t0)) * 100
  const span = t1 - t0
  const step = [60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3].find(s => span / s <= 4) ?? 7200e3
  const ticks: number[] = []
  for (let t = Math.ceil(t0 / step) * step; t < t1; t += step) if (pct(t) > 20 && pct(t) < 82) ticks.push(t)
  const grid = <>{ticks.map(t => <i key={t} className="tlx-grid" style={{ left: `${pct(t)}%` }} />)}{live && <i className="tlx-now" style={{ left: '100%' }} />}</>

  return (
    <div className="tlx-lanes" role="table" aria-label="Units over time">
      <div className="tlx-lane-label tlx-axis-label" role="columnheader">Units</div>
      <div className="tlx-axis" role="columnheader" aria-hidden>
        <span style={{ left: 0 }}>{fmtTime(t0, false)}</span>
        {ticks.map(t => <span key={t} className="mid" style={{ left: `${pct(t)}%` }}>{fmtTime(t, false)}</span>)}
        <span className={`end ${live ? 'now' : ''}`} style={{ left: '100%' }}>{live ? 'Now' : fmtTime(t1, false)}</span>
      </div>
      {inc.assignments.map(a => {
        const u = S.units[a.unitId]
        const at = (st: string) => a.history.find(h => h.state === st)?.at
        const start = a.history[0].at, ack = at('Acknowledged'), onScene = at('On scene')
        const end = onScene ?? t1
        const overdue = !a.released && assignmentOverdue(a, S)
        const status = onScene ? `On scene in ${short(onScene - start)}` : a.released ? 'Released' : overdue ? 'No acknowledgement' : ack ? 'En route' : 'Dispatched'
        const Icon = UNIT_ICON[u.type]
        const w = Math.max(pct(end) - pct(start), 0.5)
        const ackPct = ack ? ((ack - start) / Math.max(end - start, 1)) * 100 : 100
        return (
          <div key={a.id} className="tlx-row" role="row">
            <div className="tlx-lane-label" role="cell">
              <Icon size={16} weight="bold" className="tlx-unit-ic" aria-hidden />
              <span className="tlx-unit"><span className="tlx-callsign">{u.callsign}</span><span className={`tlx-status ${overdue ? 'late' : ''}`}>{status}</span></span>
            </div>
            <div className="tlx-track" role="cell" aria-label={`${u.callsign}: ${a.history.map(h => `${h.state} ${fmtTime(h.at, false)}`).join(', ')}`}>
              {grid}
              <span className={`tlx-bar ${onScene ? 'arrived' : ''} ${overdue ? 'late' : ''}`} style={{ left: `${pct(start)}%`, width: `${w}%`, ['--ack' as string]: `${ackPct}%` }}
                title={a.history.map(h => `${fmtTime(h.at)}  ${h.state} · ${h.channel}`).join('\n')} />
              {onScene && <span className="tlx-pin" style={{ left: `${pct(onScene)}%` }} aria-hidden />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- 2. Log ----------
type Phase = { name: string; start: number; end?: number; reason?: string; items: { e: TimelineEvent; c: Cat }[] }
function phasesOf(inc: Incident): Phase[] {
  const out: Phase[] = [{ name: 'Reported', start: inc.createdAt, items: [] }]
  for (const e of inc.timeline) {
    if (e.kind === 'state' && e.text.startsWith('State →')) {
      const name = e.text.slice(8).split('.')[0], reason = e.text.replace(/^State → [^.]+\.\s*/, '') || undefined
      const last = out[out.length - 1]
      if (last.name === name) { last.reason = reason ?? last.reason; continue } // same phase re-announced: keep one heading
      if (out.length === 1 && last.items.length === 0) { out[0] = { name, start: last.start, reason, items: [] }; continue }
      last.end = e.at
      out.push({ name, start: e.at, reason, items: [] })
      continue
    }
    const c = categoryOf(e)
    if (c) out[out.length - 1].items.push({ e, c })
  }
  return out
}

function PhaseLog({ inc }: { inc: Incident }) {
  const S = useSim()
  const phases = phasesOf(inc).reverse()
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const closed = !!inc.closedAt
  // Open by default: newest phases until at least 3 events are visible, so a phase that just began never opens onto nothing.
  const openByDefault = new Set<number>()
  for (let n = 0, i = 0; i < phases.length && (i === 0 || n < 3); i++) { openByDefault.add(phases[i].start); n += phases[i].items.length }
  return (
    <ol className="tlx-log" aria-label="Incident log, newest first">
      {phases.map((p, i) => {
        const current = i === 0 && !closed
        const isOpen = open[p.start] ?? openByDefault.has(p.start)
        const dur = (p.end ?? inc.closedAt ?? S.now) - p.start
        return (
          <li key={p.start} className={`tlx-phase ${current ? 'is-current' : ''}`}>
            <button className="tlx-ph-head" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [p.start]: !isOpen }))} disabled={!p.items.length && !p.reason}>
              <span className="tlx-dot" aria-hidden />
              <span className="tlx-ph-name">{p.name}</span>
              <span className="tlx-ph-meta num">{fmtTime(p.start, false)}{p.name !== 'Closed' && ` · ${short(dur)}`}</span>
              <span className="spacer" />
              {!isOpen && p.items.length > 0 && <span className="tlx-ph-count">{p.items.length} event{p.items.length > 1 ? 's' : ''}</span>}
              {(p.items.length > 0 || p.reason) && <CaretDown size={12} weight="bold" className="tlx-caret" aria-hidden />}
            </button>
            {isOpen && <>
              {p.reason && <p className="tlx-reason">{p.reason}</p>}
              {p.items.length > 0 && <ul className="tlx-evs">
                {[...p.items].reverse().map(({ e, c }) => (
                  <li key={e.id} className={`tlx-ev c-${c.key}`} tabIndex={0} aria-label={`${fmtTime(e.at)} ${c.label}: ${e.text} (${e.actor})`}>
                    <span className="tlx-ev-ic" aria-hidden><c.icon size={14} weight={c.key === 'alert' || c.key === 'failure' || c.key === 'ai' ? 'fill' : 'bold'} /></span>
                    <span className="tlx-ev-txt">{e.text}<span className="tlx-ev-who"> · {e.actor}</span></span>
                    <span className="tlx-ev-when num">{fmtTime(e.at, false)}</span>
                  </li>
                ))}
              </ul>}
            </>}
          </li>
        )
      })}
    </ol>
  )
}
