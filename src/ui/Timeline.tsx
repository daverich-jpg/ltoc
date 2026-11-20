// Incident timeline as a time track (after the "workflow plan" moodboard):
// state bars on top, one bar per unit, and small icon markers for everything else.
// The detail lives in a hover/focus card, so the track itself stays quiet.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Ambulance, ArrowsSplit, BellRinging, Broadcast, Car, ClipboardText, FireTruck, Flag, Lifebuoy, Megaphone, NotePencil, Siren, Sparkle, Truck, WarningCircle, Lightning } from '@phosphor-icons/react'
import type { Incident, TimelineEvent, UnitType } from '../sim/types'
import { lastConf } from '../sim/derive'
import { fmtTime } from './bits'
import { useSim } from './store'

const short = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` }
const UNIT_ICON: Record<UnitType, typeof Car> = { patrol: Car, rescue: Lifebuoy, ambulance: Ambulance, fire: FireTruck, police: Siren, recovery: Truck }

type Cat = { key: string; label: string; icon: typeof Car }
function categoryOf(e: TimelineEvent): Cat | null {
  if (e.kind === 'state' || e.kind === 'unit' || e.kind === 'assign') return null // drawn as bars
  if (e.actor.includes('AI suggestion')) return { key: 'ai', label: 'AI assist', icon: Sparkle }
  switch (e.kind) {
    case 'note': return { key: 'note', label: 'Note', icon: NotePencil }
    case 'message': return { key: 'message', label: 'Public message', icon: Megaphone }
    case 'assess': return { key: 'assess', label: 'Assessment', icon: ClipboardText }
    case 'diversion': return { key: 'diversion', label: 'Diversion', icon: ArrowsSplit }
    case 'notify': return /acknowledged/.test(e.text) ? null : { key: 'notify', label: 'Agency notified', icon: BellRinging }
    case 'failure': return { key: 'failure', label: 'Failed command', icon: WarningCircle }
    case 'source': return { key: 'source', label: 'Report', icon: Broadcast }
    case 'system': return /overdue|Raised to Act now/.test(e.text) ? { key: 'alert', label: 'Escalation', icon: Lightning } : { key: 'system', label: 'Field request', icon: Flag }
    default: return null
  }
}

interface Tip { x: number; y: number; title: string; time: string; body: ReactNode }

export function TimelineTrack({ inc }: { inc: Incident }) {
  const S = useSim()
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  const [tip, setTip] = useState<Tip | null>(null)
  const lastClose = useRef(0)
  const timer = useRef<number>(0)
  useLayoutEffect(() => {
    const el = ref.current!; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const t0 = inc.createdAt
  const live = !inc.closedAt
  const t1 = Math.max(inc.closedAt ?? S.now, t0 + 60000)
  const pad = 8
  const X = (t: number) => pad + ((t - t0) / (t1 - t0)) * (w - pad * 2)

  // tooltip: short delay for the first one, instant while moving between markers
  const show = (t: Tip) => { clearTimeout(timer.current); const warm = Date.now() - lastClose.current < 400; if (warm || tip) setTip(t); else timer.current = window.setTimeout(() => setTip(t), 140) }
  const hide = () => { clearTimeout(timer.current); if (tip) lastClose.current = Date.now(); setTip(null) }
  const hov = (t: Omit<Tip, 'x' | 'y'>, x: number, y: number) => ({
    onMouseEnter: () => show({ ...t, x, y }), onMouseLeave: hide, onFocus: () => setTip({ ...t, x, y }), onBlur: hide,
  })

  // state bars
  const states = inc.timeline.filter(e => e.kind === 'state' && e.text.startsWith('State →')).map(e => ({ e, name: e.text.slice(8).split('.')[0] }))
  const stateBars = states.map((s, i) => ({ ...s, start: s.e.at, end: states[i + 1]?.e.at ?? t1, current: i === states.length - 1 })).filter(b => b.name !== 'Closed' || b.end > b.start)

  // unit bars
  const units = inc.assignments.map(a => {
    const u = S.units[a.unitId]
    const at = (st: string) => a.history.find(h => h.state === st)?.at
    const start = a.history[0].at, ack = at('Acknowledged'), onScene = at('On scene')
    return { a, u, start, ack, onScene, end: onScene ?? t1, last: lastConf(a) }
  })

  // event markers, packed into rows so they never overlap
  const marks = inc.timeline.map(e => ({ e, c: categoryOf(e) })).filter((m): m is { e: TimelineEvent; c: Cat } => !!m.c)
  // Events within ~26px of each other share one marker (icon of the first, a count, all of them in the hover card).
  // Two rows at most, so a busy minute never makes the track tall.
  type Group = { x: number; r: number; items: { e: TimelineEvent; c: Cat }[] }
  const groups: Group[] = []
  const rowEnd = [-Infinity, -Infinity]
  for (const m of marks) {
    const x = X(m.e.at)
    const r = rowEnd.findIndex(end => x - end > 26)
    if (r !== -1) { groups.push({ x, r, items: [m] }); rowEnd[r] = x; continue }
    const near = groups.filter(g => Math.abs(g.x - x) <= 26).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0] ?? groups[groups.length - 1]
    near.items.push(m)
  }
  const rows = [0, 1].filter(r => groups.some(g => g.r === r))

  const LANE = 34, top = 30
  const unitTop = top + LANE + 6
  const markTop = unitTop + units.length * LANE + (units.length ? 10 : 0)
  const height = markTop + Math.max(1, rows.length) * 28 + 6

  // axis ticks
  const span = t1 - t0
  const step = [60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3].find(s => span / s <= 5) ?? 7200e3
  const ticks: number[] = []
  for (let t = Math.ceil(t0 / step) * step; t < t1 - step * 0.35; t += step) ticks.push(t)

  return (
    <div className="track" ref={ref} style={{ height }} onMouseLeave={hide}>
      <div className="track-axis">
        <span className="tick" style={{ left: X(t0) }}>{fmtTime(t0, false)}</span>
        {ticks.filter(t => X(t) - X(t0) > 46 && X(t1) - X(t) > 46).map(t => <span key={t} className="tick" style={{ left: X(t) }}>{fmtTime(t, false)}</span>)}
        <span className={`tick end ${live ? 'now' : ''}`} style={{ left: X(t1) }}>{live ? 'Now' : fmtTime(t1, false)}</span>
      </div>
      {live && <div className="now-line" style={{ left: X(t1) }} aria-hidden />}
      {ticks.map(t => <div key={t} className="grid-line" style={{ left: X(t) }} aria-hidden />)}

      {stateBars.map(b => {
        const x = X(b.start), bw = Math.max(10, X(b.end) - x - 2), roomy = bw > 92
        return <button key={b.e.id} className={`bar state ${b.current ? 'current' : ''}`} style={{ left: x, top, width: bw }}
          aria-label={`${b.name}, ${short(b.end - b.start)}`} {...hov({ title: b.name, time: `${fmtTime(b.start)} · ${short(b.end - b.start)}`, body: <>{b.e.text.replace(/^State → [^.]+\.\s*/, '') || 'State change'}<span className="tip-who">{b.e.actor}</span></> }, x + bw / 2, top)}>
          {roomy && <span className="bar-label">{b.name}</span>}
          {bw > 150 && <span className="badge">{short(b.end - b.start)}</span>}
        </button>
      })}

      {units.map((r, i) => {
        const y = unitTop + i * LANE, x = X(r.start), bw = Math.max(14, X(r.end) - x - 2)
        const ackX = r.ack ? Math.min(bw, X(r.ack) - x) : bw
        const Icon = UNIT_ICON[r.u.type]
        return <button key={r.a.id} className={`bar unit ${r.onScene ? 'arrived' : ''}`} style={{ left: x, top: y, width: bw, ['--ack' as string]: `${(ackX / bw) * 100}%` }}
          aria-label={`${r.u.callsign}, ${r.last.state}`} {...hov({ title: `${r.u.callsign} · ${r.a.role}`, time: r.onScene ? `On scene after ${short(r.onScene - r.start)}` : r.last.state, body: <ul className="tip-list">{r.a.history.map(h => <li key={h.state}><span>{fmtTime(h.at)}</span>{h.state} · {h.channel}</li>)}</ul> }, x + bw / 2, y)}>
          <Icon size={14} weight="bold" className="bar-icon" />
          {bw > 64 && <span className="bar-label">{r.u.callsign}</span>}
          {bw > 140 && <span className="badge">{r.onScene ? short(r.onScene - r.start) : r.last.state === 'Dispatched' ? 'no ack' : r.last.state.toLowerCase()}</span>}
        </button>
      })}

      {groups.map(g => {
        const lead = g.items.find(i => i.c.key === 'alert' || i.c.key === 'failure') ?? g.items[0]
        const Icon = lead.c.icon
        const y = markTop + g.r * 28
        const many = g.items.length > 1
        return <button key={lead.e.id} className={`mark c-${lead.c.key} ${many ? 'many' : ''}`} style={{ left: g.x - 11, top: y }} aria-label={many ? `${g.items.length} events around ${fmtTime(lead.e.at)}` : `${lead.c.label} at ${fmtTime(lead.e.at)}`}
          {...hov(many
            ? { title: `${g.items.length} events`, time: `${fmtTime(g.items[0].e.at, false)}–${fmtTime(g.items[g.items.length - 1].e.at, false)}`, body: <ul className="tip-list">{g.items.map(i => <li key={i.e.id}><span>{fmtTime(i.e.at)}</span>{i.c.label}: {i.e.text.length > 70 ? i.e.text.slice(0, 68) + '…' : i.e.text}</li>)}</ul> }
            : { title: lead.c.label, time: fmtTime(lead.e.at), body: <>{lead.e.text}<span className="tip-who">{lead.e.actor}</span></> }, g.x, y)}>
          <Icon size={13} weight={lead.c.key === 'alert' || lead.c.key === 'failure' ? 'fill' : 'bold'} />
          {many && <span className="count">{g.items.length}</span>}
        </button>
      })}

      {tip && <div className="tip" role="tooltip" style={{ left: Math.min(Math.max(tip.x, 150), w - 150), top: tip.y - 8 }}>
        <div className="tip-head"><b>{tip.title}</b><span>{tip.time}</span></div>
        <div className="tip-body">{tip.body}</div>
      </div>}
    </div>
  )
}
