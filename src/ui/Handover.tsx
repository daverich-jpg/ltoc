// Shift handover. Control rooms run around the clock; the moment one operator hands the desk to the
// next is where context gets lost. Three views share one briefing layout:
//   compose  : the outgoing operator sees what's open, adds shift-wide notes and hands over
//   take over: the incoming operator must read it and confirm before the desk is theirs; anything that
//              changed or arrived since the handover is flagged, because the briefing is frozen
//   read     : any past handover, read-only, from the Overview shift line
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import * as E from '../sim/engine'
import type { State } from '../sim/engine'
import { isOpen, nextAction, tierOf } from '../sim/derive'
import type { Handover, HandoverItem } from '../sim/types'
import { TierGlyph, fmtAge, fmtTime } from './bits'
import { openIncident, setUI, useSim, useUI } from './store'

const TIER_RANK = { act: 0, watch: 1, ambient: 2, none: 3 } as const

/** Freeze every open incident as it stands now, most urgent first, with its own notes. */
function snapshot(S: State): HandoverItem[] {
  return Object.values(S.incidents)
    .filter(i => isOpen(i) && i.verif !== 'Disproved')
    .map(i => ({ inc: i, tier: tierOf(i, S).tier }))
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.inc.createdAt - a.inc.createdAt)
    .map(({ inc, tier }) => ({
      incId: inc.id, title: inc.title, state: inc.state, tier, next: nextAction(inc, S),
      notes: inc.timeline.filter(e => e.kind === 'note').slice(-2).map(e => `${e.text} (${e.actor}, ${fmtTime(e.at, false)})`),
    }))
}

const dialogMotion = {
  initial: { opacity: 0, transform: 'scale(0.97)' },
  animate: { opacity: 1, transform: 'scale(1)' },
  exit: { opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12, ease: [0.7, 0, 0.84, 0] } },
  transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] },
} as const

export function HandoverLayer() {
  const S = useSim()
  const U = useUI()
  const pending = E.pendingHandover(S)
  // the incoming operator can't use the desk until they take over; other seats just see it on Overview
  if (pending && S.role === 'operator') return <TakeOver h={pending} />
  if (U.handover === 'compose') return <Compose />
  if (U.handover && typeof U.handover === 'object') { const h = S.handovers.find(x => x.id === (U.handover as { read: string }).read); if (h) return <Read h={h} /> }
  return null
}

function Shell({ label, onClose, children }: { label: string; onClose?: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!onClose) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <motion.div className="dialog ho" role="dialog" aria-modal="true" aria-label={label} onMouseDown={e => e.stopPropagation()} {...dialogMotion}>{children}</motion.div>
    </div>
  )
}

function Items({ items, S, since }: { items: HandoverItem[]; S: State; since?: number }) {
  return (
    <ul className="ho-list">
      {items.map(it => {
        const inc = S.incidents[it.incId]
        const now = inc ? inc.state : it.state
        const changed = since != null && inc && now !== it.state
        const gone = since != null && inc && !isOpen(inc)
        return (
          <li key={it.incId}>
            <span className="ho-glyph"><TierGlyph tier={it.tier} /></span>
            <button className="ho-id num" onClick={() => { setUI({ handover: undefined }); openIncident(it.incId) }} disabled={since != null}>{it.incId}</button>
            <span className="ho-txt">
              <span className="ho-title">{it.title}</span>
              <span className="ho-next">{gone ? `Now ${now.toLowerCase()}` : it.next}</span>
              {changed && <span className="chip accent ho-chg">{it.state} → {now}</span>}
              {it.notes.map((n, i) => <span key={i} className="ho-inote">{n}</span>)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Compose() {
  const S = useSim()
  const items = snapshot(S)
  const close = () => setUI({ handover: undefined })
  const to = E.incomingOperator()
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ta.current?.focus() }, [])
  return (
    <Shell label="Hand over shift" onClose={close}>
      <div className="ho-head">
        <h2>Hand over shift</h2>
        <p className="ho-meta">{S.shift.operator} to {to} · on shift since {fmtTime(S.shift.since, false)} ({fmtAge(S.now - S.shift.since)})</p>
      </div>
      <div className="ho-body">
        <div className="ho-label"><span className="sq" aria-hidden />Open incidents<span className="num">{items.length}</span></div>
        {items.length ? <Items items={items} S={S} /> : <p className="small muted">Nothing open.</p>}
        <label className="ho-label" htmlFor="ho-notes"><span className="sq" aria-hidden />Notes for {to}</label>
        <textarea id="ho-notes" ref={ta} value={S.handoverDraft} onChange={e => E.setHandoverDraft(e.target.value)} rows={4}
          placeholder="What the system can't know: a camera that's down, a unit that's slow to answer, a queue that builds again at nine…" />
        <p className="small muted" style={{ marginTop: 6 }}>Notes about one incident belong on that incident; they come along above.</p>
      </div>
      <div className="ho-foot">
        <span className="small muted">{to} reads this and confirms before the desk is theirs.</span>
        <span className="spacer" />
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={() => { E.handOverShift(items); close() }}>Hand over to {to}</button>
      </div>
    </Shell>
  )
}

function Briefing({ h, S, live }: { h: Handover; S: State; live: boolean }) {
  const fresh = live ? Object.values(S.incidents).filter(i => isOpen(i) && i.createdAt > h.at && !h.items.some(x => x.incId === i.id)) : []
  return (
    <div className="ho-body">
      {h.notes ? <div className="ho-note"><span className="ho-note-who">{h.from} · {fmtTime(h.at, false)}</span>{h.notes}</div>
        : <p className="small muted" style={{ marginBottom: 4 }}>No shift notes.</p>}
      {fresh.length > 0 && <>
        <div className="ho-label act"><span className="sq" aria-hidden />New since the handover<span className="num">{fresh.length}</span></div>
        <Items items={fresh.map(i => ({ incId: i.id, title: i.title, state: i.state, tier: tierOf(i, S).tier, next: nextAction(i, S), notes: [] }))} S={S} />
      </>}
      <div className="ho-label"><span className="sq" aria-hidden />Open at handover<span className="num">{h.items.length}</span></div>
      {h.items.length ? <Items items={h.items} S={S} since={live ? h.at : undefined} /> : <p className="small muted">Nothing was open.</p>}
    </div>
  )
}

function TakeOver({ h }: { h: Handover }) {
  const S = useSim()
  const to = E.incomingOperator()
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => { btn.current?.focus() }, [])
  return (
    <Shell label={`Take over from ${h.from}`}>
      <div className="ho-head">
        <span className="ho-kicker">Shift change</span>
        <h2>Take over from {h.from}</h2>
        <p className="ho-meta">Handed over {fmtTime(h.at, false)} · {fmtAge(S.now - h.at)} ago · read this before the desk is yours</p>
      </div>
      <Briefing h={h} S={S} live />
      <div className="ho-foot">
        <button className="btn ghost sm" onClick={E.cancelHandover}>Cancel handover, back to {h.from}</button>
        <span className="spacer" />
        <button ref={btn} className="btn primary" onClick={E.takeOverShift}>I've read it, take over as {to}</button>
      </div>
    </Shell>
  )
}

function Read({ h }: { h: Handover }) {
  const S = useSim()
  const close = () => setUI({ handover: undefined })
  return (
    <Shell label="Shift handover" onClose={close}>
      <div className="ho-head">
        <h2>{h.from} to {h.to}</h2>
        <p className="ho-meta">Handed over {fmtTime(h.at, false)} · taken over {h.acceptedAt ? fmtTime(h.acceptedAt, false) : '—'}</p>
      </div>
      <Briefing h={h} S={S} live={false} />
      <div className="ho-foot"><span className="spacer" /><button className="btn" onClick={close}>Done</button></div>
    </Shell>
  )
}

/** Overview's slim shift line: who has the desk, the last handover, and the action. */
export function ShiftLine() {
  const S = useSim()
  const pending = E.pendingHandover(S)
  const last = [...S.handovers].reverse().find(h => h.acceptedAt)
  return (
    <section className="panel shift" aria-label="Shift">
      <span className="avatar r-operator" aria-hidden>{S.shift.operator.slice(-1)}</span>
      <span className="shift-who"><b>{S.shift.operator}</b> on shift since {fmtTime(S.shift.since, false)}</span>
      {pending ? <span className="shift-last act">Handed over {fmtTime(pending.at, false)} · waiting for {E.incomingOperator()} to take over</span>
        : last ? <button className="link-btn shift-last" onClick={() => setUI({ handover: { read: last.id } })}>Took over from {last.from} at {fmtTime(last.acceptedAt!, false)}{last.notes ? ' · 1 note' : ''} · read briefing</button>
        : <span className="shift-last">No handover yet this shift</span>}
      <span className="spacer" />
      {!pending && S.role === 'operator' && <button className="btn sm" onClick={() => setUI({ handover: 'compose' })}>Hand over shift</button>}
    </section>
  )
}
