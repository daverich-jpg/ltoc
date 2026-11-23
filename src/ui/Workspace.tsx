import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import * as E from '../sim/engine'
import { assignmentOverdue, impactOf, isTerminal, lastConf, metricsOf, nextAction, severitySuggestion, tierOf, TIER_LABEL } from '../sim/derive'
import { GEO_AS_OF, haversine, nodeById, segById, route } from '../sim/geo'
import { AGENCIES } from '../sim/seed'
import { LIFECYCLE, UNIT_FLOW, type AgencyId, type Incident, type Severity, type Unit, type UnitType } from '../sim/types'
import { Age, Assumed, Icon, Kbd, Sim, SourceIcon, StateChip, TierGlyph, fmtAge, fmtDur, fmtTime , Spinner } from './bits'
import { closeIncident, getUI, openIncident, setUI, useSim, useUI } from './store'
import type { State } from '../sim/engine'
import { draftMessage, readReports } from '../ai/client'
import { TimelineTrack } from './Timeline'
import { Broadcast, Clock, NotePencil, PencilSimple, ShieldCheck, Sparkle } from './icons'
import type { AIResult, MessageDraft, MessageFacts, ReportRead } from '../ai/types'

type Sec = 'verify' | 'assess' | 'response' | 'clear' | 'close' | 'timeline'
/** The lead panel is the one that holds the NEXT action, so the operator never has to go looking for it. */
export function leadFor(inc: Incident, S: State): Sec {
  const active = inc.assignments.filter(a => !a.released)
  const needsResponse = active.some(a => assignmentOverdue(a, S)) || (!!inc.lanesBlocked && !active.some(a => S.units[a.unitId]?.type === 'recovery'))
  switch (inc.state) {
    case 'Reported': case 'Verifying': return 'verify'
    case 'Confirmed': return inc.severity ? 'response' : 'assess'
    case 'Responding': return 'response'
    case 'On scene': return needsResponse ? 'response' : 'clear'
    case 'Clearing': return 'clear'
    case 'Road clear': return inc.diversion?.status === 'active' || inc.messages.some(m => m.status === 'published') ? 'clear' : 'close'
    case 'Closed': return 'close'
    default: return 'timeline'
  }
}
function doneFor(id: Sec, inc: Incident): boolean {
  switch (id) {
    case 'verify': return inc.verif === 'Verified' || inc.verif === 'Disproved'
    case 'assess': return inc.severity != null
    case 'response': { const a = inc.assignments; return a.length > 0 && a.every(x => x.released || lastConf(x).state === 'On scene') }
    case 'clear': return (inc.state === 'Road clear' || inc.state === 'Closed') && inc.diversion?.status !== 'active' && !inc.messages.some(m => m.status === 'published')
    case 'close': return inc.state === 'Closed'
    default: return false
  }
}
const STEP_NO: Partial<Record<Sec, number>> = { verify: 1, assess: 2, response: 3, clear: 4, close: 5 }

function usePend(incId: string, prefix: string) {
  const S = useSim()
  return S.pending.find(p => p.incidentId === incId && p.label.startsWith(prefix))
}

/** A command button: disabled while its command is unconfirmed, never shows the result early. */
function Cmd({ inc, prefix, onClick, children, kind = '', disabled, title, k, id }: { inc: Incident; prefix: string; onClick: () => void; children: ReactNode; kind?: string; disabled?: boolean; title?: string; k?: string; id?: string }) {
  const p = usePend(inc.id, prefix)
  const busy = p?.status === 'pending'
  return (
    <button id={id} className={`btn ${kind} ${busy ? 'pending' : ''}`} disabled={disabled || busy} onClick={onClick} title={title} aria-busy={busy}>
      {busy && <Spinner />}{children}{k && !busy && <Kbd>{k}</Kbd>}
    </button>
  )
}
function Pendings({ inc, prefixes }: { inc: Incident; prefixes: string[] }) {
  const S = useSim()
  const ps = S.pending.filter(p => p.incidentId === inc.id && prefixes.some(x => p.label.startsWith(x)))
  return <>{ps.map(p => p.status === 'failed'
    ? <div key={p.id} className="inline-err" role="alert"><Icon.alert /><span className="grow"><b>{p.label}</b> did not apply. {p.error}</span><button className="btn sm" onClick={() => E.retry(p.id)}>Retry</button><button className="btn sm ghost" onClick={() => E.discardFailed(p.id)}>Dismiss</button></div>
    : <div key={p.id} className="pending-line"><Spinner />{p.label}: sent, waiting for confirmation <span className="num muted">{fmtAge(S.now - p.issuedAt)}</span></div>)}</>
}

function Section({ id, inc, title, summary, lead, children }: { id: Sec; inc: Incident; title: string; summary: ReactNode; lead: boolean; children: ReactNode }) {
  const U = useUI()
  const reduce = useReducedMotion()
  const user = U.expanded[inc.id]?.[id]
  const open = user ?? lead
  const done = doneFor(id, inc)
  const ref = useRef<HTMLElement>(null)
  const first = useRef(true)
  // When this becomes the next step, bring it to the top of the workspace once the previous step has folded away.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!lead) return
    const instant = reduce || getUI().lastInput === 'keyboard'
    const t = setTimeout(() => ref.current?.scrollIntoView({ block: 'start', behavior: instant ? 'auto' : 'smooth' }), instant ? 0 : 170)
    return () => clearTimeout(t)
  }, [lead])
  const toggle = () => setUI(u => ({ expanded: { ...u.expanded, [inc.id]: { ...u.expanded[inc.id], [id]: !open } } }))
  const instant = reduce || U.lastInput === 'keyboard'
  const step = STEP_NO[id]
  return (
    <section ref={ref} className={`sec ${lead ? 'lead' : ''} ${done && !lead ? 'done' : ''}`} aria-labelledby={`h-${inc.id}-${id}`} aria-current={lead ? 'step' : undefined}>
      <button className="sec-h" onClick={toggle} aria-expanded={open}>
        <span className={`chev ${open ? 'open' : ''}`}><Icon.chev /></span>
        {step && <span className={`stepno ${done ? 'is-done' : lead ? 'is-now' : ''}`} aria-hidden>{done ? <Icon.check /> : step}</span>}
        <h2 id={`h-${inc.id}-${id}`}>{title}</h2>
        {lead && <span className="lead-tag">Now</span>}
        {done && !lead && <span className="sr-only">Done.</span>}
        {!open && <span className="sum">{summary}</span>}
        {open && <span className="spacer" />}
      </button>
      <AnimatePresence initial={false}>
        {open && <motion.div key="b" style={{ overflow: 'hidden' }}
          initial={instant ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1, transition: { duration: instant ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] } }}
          exit={{ height: 0, opacity: 0, transition: { duration: instant ? 0 : 0.15, ease: [0.7, 0, 0.84, 0] } }}>
          <div className="sec-b">{children}</div>
        </motion.div>}
      </AnimatePresence>
    </section>
  )
}

export function Workspace() {
  const S = useSim()
  const U = useUI()
  const inc = U.active ? S.incidents[U.active] : undefined
  const kbd = U.lastInput === 'keyboard'

  useEffect(() => {
    if (inc && inc.state === 'Reported' && S.role === 'operator') E.startVerify(inc.id)
  }, [inc?.id, inc?.state, S.role])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || e.metaKey || e.ctrlKey || getUI().palette) return
      if (e.key === 'Escape') closeIncident()
      if (!inc) return
      const go = (sel: string, alt = false) => {
        setUI(u => ({ expanded: { ...u.expanded, [inc.id]: { ...u.expanded[inc.id], verify: true } } }))
        if (alt) window.dispatchEvent(new Event('ltoc-alt'))
        setTimeout(() => (document.querySelector(sel) as HTMLElement)?.focus(), 40)
      }
      if (e.key === 'v') go('#confirm-basis')
      if (e.key === 'd') go('#dismiss-reason', true)
      if (e.key === 'm') go('#merge-target', true)
      if (e.key === 'n') { e.preventDefault(); window.dispatchEvent(new Event('ltoc-note')) }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [inc?.id])

  const lead = inc ? leadFor(inc, S) : 'timeline'
  const prevLead = useRef<Record<string, Sec>>({})
  useEffect(() => {
    if (!inc) return
    const prev = prevLead.current[inc.id]
    prevLead.current[inc.id] = lead
    // the step moved on: fold the finished step and open the next one, whatever was toggled before
    if (prev && prev !== lead) setUI(u => ({ expanded: { ...u.expanded, [inc.id]: {} } }))
  }, [inc?.id, lead])
  if (!inc) return null
  const ti = tierOf(inc, S)
  const seg = segById[inc.segId]
  return (
    <motion.div className="ws" role="region" aria-label={`Incident workspace ${inc.id}`} key="ws"
      initial={kbd ? false : { opacity: 0, transform: 'translateX(24px)' }} animate={{ opacity: 1, transform: 'translateX(0px)' }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
      {U.tabs.length > 1 && <div className="ws-tabs" role="tablist" aria-label="Pinned incidents">
        {U.tabs.map(t => <div key={t} style={{ display: 'flex' }}>
          <button className="ws-tab" role="tab" aria-selected={t === inc.id} onClick={() => openIncident(t)}><TierGlyph tier={tierOf(S.incidents[t], S).tier} size={10} />{t}</button>
          <button className="ws-tab" style={{ paddingLeft: 0 }} aria-label={`Unpin ${t}`} onClick={() => closeIncident(t)}><span className="x"><Icon.x /></span></button>
        </div>)}
      </div>}
      <header className="ws-head">
        <div className="meta">
          <motion.span layoutId={kbd ? undefined : `id-${inc.id}`} className="num muted" transition={{ type: 'spring', damping: 25, stiffness: 300 }}>{inc.id}</motion.span>
          <span className="muted">· {seg.corridor}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={() => closeIncident()} aria-label="Close incident" title="Close (Esc)"><Icon.x /></button>
        </div>
        <motion.h1 layoutId={kbd ? undefined : `title-${inc.id}`} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>{inc.title}</motion.h1>
        <div className="meta">
          <StateChip state={inc.state} />
          {ti.tier === 'act' && <span className="chip act"><TierGlyph tier="act" size={10} />{ti.reasons[0]}</span>}
          {inc.severity && <span className={`chip sev-${inc.severity}`}>{inc.severity}</span>}
        </div>
        {inc.state === 'Merged' && <p className="small muted" style={{ marginTop: 8 }}>Merged into {inc.mergedInto}.</p>}
      </header>
      <div className="ws-body" key={inc.id}>
        {S.role === 'liaison' && <p className="small muted" style={{ padding: '0 4px' }}>{S.liaisonAgency} liaison: you can add notes and dispatch {S.liaisonAgency} units.</p>}
        <VerifySection inc={inc} lead={lead === 'verify'} />
        <AssessSection inc={inc} lead={lead === 'assess'} />
        <ResponseSection inc={inc} lead={lead === 'response'} />
        <ClearSection inc={inc} lead={lead === 'clear'} />
        <CloseSection inc={inc} lead={lead === 'close'} />
        <TimelineSection inc={inc} lead={lead === 'timeline'} />
      </div>
      <NotesDock inc={inc} />
    </motion.div>
  )
}

// ---------------- Verification ----------------
function VerifySection({ inc, lead }: { inc: Incident; lead: boolean }) {
  const S = useSim()
  const ro = S.role === 'liaison' || isTerminal(inc) || !['Reported', 'Verifying'].includes(inc.state)
  const indep = E.independentSources(inc)
  const [camViewed, setCamViewed] = useState(false)
  const officer = inc.sources.find(s => s.type === 'officer')
  const basisOpts = [
    ...(inc.cameraId && camViewed ? [{ label: `Camera ${inc.cameraId}`, full: `Camera ${inc.cameraId}` }] : []),
    ...(indep >= 2 ? [{ label: `${indep} independent sources`, full: `${indep} independent sources (${[...new Set(inc.sources.map(s => E.SOURCE_LABEL[s.type].toLowerCase()))].join(', ')})` }] : []),
    ...(officer ? [{ label: `Officer ${officer.channel.split(' ')[0]}`, full: `Officer report (${officer.channel.split(' ')[0]})` }] : []),
  ]
  const [override, setOverride] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [mergeTo, setMergeTo] = useState('')
  const candidates = useMemo(() => Object.values(S.incidents).filter(o => o.id !== inc.id && !isTerminal(o) && Math.abs(o.createdAt - inc.createdAt) < 1800000).map(o => {
    const a = segById[o.segId], b = segById[inc.segId]
    const shared = [a.from, a.to].some(x => [b.from, b.to].includes(x)) || o.segId === inc.segId
    const km = haversine(o.t < 0.5 ? a.from : a.to, inc.t < 0.5 ? b.from : b.to)
    return { o, km, likely: shared && o.type === inc.type }
  }).filter(c => c.km < 3).sort((a, b) => Number(b.likely) - Number(a.likely) || a.km - b.km), [S.incidents, inc.id])
  const likely = candidates.find(c => c.likely)
  const [alt, setAlt] = useState(false)
  useEffect(() => { const h = () => setAlt(true); window.addEventListener('ltoc-alt', h); return () => window.removeEventListener('ltoc-alt', h) }, [])

  const summary = inc.verif === 'Verified' ? `Verified by ${inc.verifiedBy}` : inc.verif === 'Disproved' ? 'Dismissed' : `${inc.sources.length} report${inc.sources.length > 1 ? 's' : ''}`
  return (
    <Section id="verify" inc={inc} title="Verify" summary={summary} lead={lead}>
      {inc.sources.map(s => (
        <div className="src" key={s.id}>
          <span className="dim" style={{ paddingTop: 2 }} title={E.SOURCE_LABEL[s.type]}><SourceIcon type={s.type} /></span>
          <div><div className="who" title={s.type === 'call' ? `Caller spoke to the ${E.EMERGENCY_CENTRE} call-taker. This is their summary.` : undefined}>{E.sourceLabel(s)}</div><q>{s.content}</q></div>
          <Age ms={S.now - s.receivedAt} />
        </div>
      ))}
      {!isTerminal(inc) && <AIRead inc={inc} canApply={S.role !== 'liaison'} />}
      {inc.cameraId ? <CameraView inc={inc} onViewed={() => setCamViewed(true)} /> : !ro && <p className="small muted" style={{ marginTop: 6 }}>No camera on this segment.</p>}

      {!ro && <>
        <div className="actions">
          {basisOpts.map((b, i) => <Cmd key={b.full} id={i === 0 ? 'confirm-basis' : undefined} inc={inc} prefix="Confirm" kind={i === 0 ? 'primary' : ''} k={i === 0 ? 'V' : undefined} onClick={() => E.confirmIncident(inc.id, b.full)}><Icon.check /> Confirm · {b.label}</Cmd>)}
          {basisOpts.length === 0 && <span className="small muted">Waiting for the camera or a second report…</span>}
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost sm" id={basisOpts.length ? undefined : 'confirm-basis'} onClick={() => setOverride(override === null ? '' : null)}>Override</button>
          <button className="btn ghost sm" aria-expanded={alt} onClick={() => setAlt(!alt)}>Dismiss or merge</button>
        </div>
        {override !== null && <div className="inline-form">
          <input type="text" autoFocus value={override} onChange={e => setOverride(e.target.value)} placeholder="Reason for confirming without a source" />
          <Cmd inc={inc} prefix="Confirm" kind="primary" disabled={!override.trim()} onClick={() => E.confirmIncident(inc.id, '', override.trim())}>Confirm</Cmd>
        </div>}
        {likely && !alt && <button className="hint" onClick={() => { setAlt(true); setMergeTo(likely.o.id) }}>Possible duplicate of {likely.o.id} · review</button>}
        {alt && <>
          <div className="inline-form">
            <input id="dismiss-reason" type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why it's false, e.g. camera shows normal traffic" />
            <Cmd inc={inc} prefix="Dismiss" kind="danger" disabled={!reason.trim()} onClick={() => E.dismissIncident(inc.id, reason.trim())}>Dismiss</Cmd>
          </div>
          <div className="inline-form">
            <select id="merge-target" className={mergeTo ? '' : 'is-placeholder'} value={mergeTo} onChange={e => setMergeTo(e.target.value)}>
              <option value="" disabled hidden={candidates.length > 0}>{candidates.length ? 'Duplicate of…' : 'No nearby open incident'}</option>
              {candidates.map(c => <option key={c.o.id} value={c.o.id}>{c.o.id} · {c.o.title}</option>)}
            </select>
            <Cmd inc={inc} prefix="Merge" disabled={!mergeTo} onClick={() => E.mergeIncident(inc.id, mergeTo)}>Merge</Cmd>
          </div>
        </>}
      </>}
      <Pendings inc={inc} prefixes={['Start verification', 'Confirm', 'Dismiss', 'Merge']} />
    </Section>
  )
}

/** Placeholder camera feed. Prefetched on hover; otherwise a skeleton resolves into the frame with its true age. */
function CameraView({ inc, onViewed }: { inc: Incident; onViewed: () => void }) {
  const S = useSim()
  const U = useUI()
  const cam = S.cameras.find(c => c.id === inc.cameraId)!
  const fetched = U.cameraCache[cam.id]
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (fetched || cam.status !== 'ok') return
    const t = setTimeout(() => { if (E.getState().degraded.link) setFailed(true); else setUI(u => ({ cameraCache: { ...u.cameraCache, [cam.id]: E.getState().now } })) }, 650)
    return () => clearTimeout(t)
  }, [fetched, cam.id])
  useEffect(() => { if (fetched) onViewed() }, [fetched])
  const age = fetched ? S.now - fetched : 0
  const refresh = () => { setFailed(false); setUI(u => { const c = { ...u.cameraCache }; delete c[cam.id]; return { cameraCache: c } }) }
  return (
    <div style={{ marginTop: 10 }}>
      {cam.status !== 'ok' ? <div className="cam" style={{ display: 'grid', placeItems: 'center' }}><span className="small" style={{ color: '#ccc' }}>{cam.id} offline</span></div>
        : failed ? <div className="inline-err"><Icon.alert /><span className="grow">Frame didn't load.</span><button className="btn sm" onClick={refresh}>Retry</button></div>
        : !fetched ? <div className="cam skel" aria-label="Loading camera frame" />
        : <div className="cam"><CamFrame inc={inc} at={fetched} />
            <div className="ov"><span>{cam.id}</span><span className={age > 120000 ? 'stale' : ''}>{fmtAge(age)} old</span></div>
            <button className="cam-refresh" onClick={refresh} aria-label="Refresh frame"><Icon.reset /></button>
          </div>}
    </div>
  )
}

function CamFrame({ inc, at }: { inc: Incident; at: number }) {
  const S = useSim()
  const seg = segById[inc.segId]
  const truth = inc.vehicle !== 'Unknown' && at >= inc.createdAt
  const seed = Math.floor(at / 30000)
  // The frame shows the road as it is. Lanes blocked come from the scene, not from the operator's record.
  const scene = truth ? { vehicle: inc.vehicle, lanesBlocked: inc.lanesBlocked || (/trailer/i.test(inc.vehicle) ? 2 : 1) } : null
  const patrol = !!scene && inc.assignments.some(a => !a.released && a.history.some(h => h.state === 'On scene' && h.at <= at) && S.units[a.unitId]?.type === 'patrol')
  const key = `${inc.id}|${seed}|${scene ? scene.vehicle + scene.lanesBlocked : 'clear'}|${patrol}`
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSrc(null)
    import('./camScene').then(m => m.renderCamFrame({ key, seed: seed + inc.id.length * 131, lanes: seg.lanes, bridge: !!seg.bridge, scene, patrol })).then(u => { if (live) setSrc(u) }).catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return src ? <img className="cam-img" src={src} alt={`Camera frame: ${seg.name}${scene ? `, ${scene.vehicle.toLowerCase()} in the road` : ', traffic moving'}`} /> : <div className="cam-img skel" aria-hidden />
}

// ---------------- Assess ----------------
function AssessSection({ inc, lead }: { inc: Incident; lead: boolean }) {
  const S = useSim()
  const sug = severitySuggestion(inc)
  const seg = segById[inc.segId]
  const ro = S.role === 'liaison' || isTerminal(inc)
  const imp = impactOf(inc, S)
  const why = sug.factors.filter(f => f.on).map(f => f.label.replace(/ \(.*\)/, '').toLowerCase())
  const summary = inc.severity ? `${inc.severity} · ${inc.lanesBlocked ?? '?'} of ${seg.lanes} lanes blocked` : `Suggested ${sug.level}`
  return (
    <Section id="assess" inc={inc} title="Assess" summary={summary} lead={lead}>
      {!ro && <div className="sevpick" role="group" aria-label="Severity">
        {(['Minor', 'Major', 'Critical'] as Severity[]).map(s => <Cmd key={s} inc={inc} prefix="Set severity" kind={inc.severity === s || (!inc.severity && s === sug.level) ? 'primary' : ''} onClick={() => E.setSeverity(inc.id, s, sug.level)}>{s}{s === sug.level && !inc.severity ? ' · suggested' : ''}</Cmd>)}
      </div>}
      {why.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>Suggested {sug.level} because: {why.join(', ')}.</p>}
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Lanes blocked</dt><dd>{ro ? `${inc.lanesBlocked ?? '?'} of ${seg.lanes}` : <div className="seg">{Array.from({ length: seg.lanes + 1 }, (_, n) => <button key={n} aria-pressed={inc.lanesBlocked === n} onClick={() => E.setLanes(inc.id, n)}>{n}</button>)}</div>}</dd>
        <dt>Hazards</dt><dd><div className="hz">
          {(['injuries', 'tanker', 'hazmat', 'secondary'] as const).map(h => <button key={h} className="btn sm" aria-pressed={inc.hazards[h]} disabled={ro} onClick={() => E.toggleHazard(inc.id, h)}>{({ injuries: 'Injuries', tanker: 'Tanker', hazmat: 'Hazardous load', secondary: 'Secondary risk' })[h]}</button>)}
        </div></dd>
        <dt>Lead agency</dt><dd>{ro ? inc.leadAgency : <select value={inc.leadAgency} onChange={e => E.setLead(inc.id, e.target.value as AgencyId)} style={{ width: 'auto' }}>{(Object.keys(AGENCIES) as AgencyId[]).filter(a => a !== 'PRIVATE').map(a => <option key={a} value={a}>{AGENCIES[a].short}</option>)}</select>}</dd>
        <dt>Est. delay</dt><dd className="num">{imp.totalDelay} min</dd>
      </dl>
      <Pendings inc={inc} prefixes={['Set severity', 'Record lanes', 'Update hazard', 'Set lead']} />
    </Section>
  )
}

// ---------------- Respond ----------------
const TYPE_ORDER: UnitType[] = ['patrol', 'rescue', 'ambulance', 'fire', 'police', 'recovery']
function ResponseSection({ inc, lead }: { inc: Incident; lead: boolean }) {
  const S = useSim()
  const active = isTerminal(inc) ? inc.assignments : inc.assignments.filter(a => !a.released)
  const ro = isTerminal(inc) || ['Reported', 'Verifying'].includes(inc.state)
  const canDispatch = (u: Unit) => S.role !== 'liaison' || u.agency === S.liaisonAgency
  const want: UnitType[] = ['patrol', 'recovery', ...(inc.hazards.injuries ? ['rescue', 'ambulance'] as UnitType[] : []), ...(inc.hazards.hazmat || inc.hazards.tanker ? ['fire'] as UnitType[] : [])]
  const suggested = useMemo(() => {
    const avail = Object.values(S.units).filter(u => u.state === 'Available')
    return TYPE_ORDER.map(t => ({ t, units: avail.filter(u => u.type === t).map(u => ({ u, eta: E.etaSec(u, inc), km: route(u.posNode, inc.t < 0.5 ? segById[inc.segId].from : segById[inc.segId].to).km })).sort((a, b) => a.eta - b.eta).slice(0, 2) })).filter(g => g.units.length)
  }, [S.units, inc.id])
  const pbs = S.playbooks.filter(p => p.segTrigger.includes(inc.segId))
  const [showAll, setShowAll] = useState(false)
  const overdue = active.filter(a => !a.released && assignmentOverdue(a, S))
  const summary = active.length ? `${active.filter(a => lastConf(a).state === 'On scene').length} of ${active.length} on scene${overdue.length ? ` · ${overdue.length} not acknowledged` : ''}` : 'No units yet'
  return (
    <Section id="response" inc={inc} title="Respond" summary={summary} lead={lead}>
      {!ro && <RecommendedTeam inc={inc} want={want} suggested={suggested} canDispatch={canDispatch} playbook={!inc.playbookId ? pbs[0] : undefined} />}
      {active.map(a => <AssignmentRow key={a.id} inc={inc} asId={a.id} />)}
      {!ro && <button className="btn ghost sm" aria-expanded={showAll} onClick={() => setShowAll(!showAll)} style={{ marginTop: 4 }}><span className={`chev ${showAll ? 'open' : ''}`}><Icon.chev /></span>Add another unit</button>}
      {!ro && showAll && <table className="t" style={{ marginTop: 4 }}><tbody>
        {suggested.flatMap(g => g.units.map(({ u, eta }) => (
          <tr key={u.id}>
            <td><b className="num">{u.callsign}</b> <span className="small muted">{u.agency} · {u.type}</span></td>
            <td className="num small muted" style={{ width: 90 }}>~{Math.round(eta / 60)} min</td>
            <td style={{ textAlign: 'right', width: 80 }}><Cmd inc={inc} prefix={`Dispatch ${u.id}`} onClick={() => E.dispatchUnit(inc.id, u.id)} disabled={!canDispatch(u)}>Assign</Cmd></td>
          </tr>
        )))}
      </tbody></table>}
      <Pendings inc={inc} prefixes={['Dispatch', 'Activate playbook']} />
    </Section>
  )
}

function AssignmentRow({ inc, asId }: { inc: Incident; asId: string }) {
  const S = useSim()
  const a = inc.assignments.find(x => x.id === asId)!
  const u = S.units[a.unitId]
  const l = lastConf(a)
  const od = !a.released && assignmentOverdue(a, S)
  const idx = UNIT_FLOW.indexOf(l.state)
  return (
    <div className={`asg ${od ? 'overdue' : ''}`}>
      <div className="top">
        <b className="num">{u.callsign}</b><span className="small muted">{a.role}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="small" style={{ fontWeight: 500 }}>{l.state === 'Dispatched' ? 'Not acknowledged' : l.state}</span>
        <span className="small muted num">{l.channel} · {fmtAge(S.now - l.at)}</span>
      </div>
      <div className="ustep" aria-hidden>{UNIT_FLOW.map((st, i) => <span key={st} className={i < idx ? 'done' : i === idx ? 'cur' : i === idx + 1 ? 'wait' : ''} />)}</div>
      {od && <div className="small" style={{ color: 'var(--act-ink)' }}>No acknowledgement after {S.thresholds.ackSec} s. Call or reassign.</div>}
    </div>
  )
}

// ---------------- Clear ----------------
// One job: get the road open. The scene question leads as the only filled button; the diversion and the public
// message are someone else's to approve, so they read as status and only ask for a click when the operator owns it.
function ClearSection({ inc, lead }: { inc: Incident; lead: boolean }) {
  const S = useSim()
  const d = inc.diversion
  const msg = [...inc.messages].reverse().find(m => m.status !== 'withdrawn') ?? inc.messages.at(-1)
  const done = isTerminal(inc)
  const reopened = (inc.state === 'Road clear' || done) && (d?.status === 'lifted' || msg?.status === 'withdrawn')
  const summary = [d && d.status !== 'lifted' ? `Diversion ${d.status}` : null, msg && msg.status !== 'withdrawn' ? `message ${msg.status}` : null].filter(Boolean).join(' · ') || (reopened ? 'Traffic reopened' : done ? 'Done' : 'Nothing set up')
  return (
    <Section id="clear" inc={inc} title="Clear" summary={summary} lead={lead}>
      {!done && <NextStep inc={inc} />}
      {!done && <TrafficStatus inc={inc} />}
      {(msg || !done) && <MessageBlock inc={inc} />}
      <Pendings inc={inc} prefixes={['Request', 'Approve', 'Lift', 'Save message', 'Publish', 'Withdraw', 'Adapt']} />
      {S.role === 'liaison' && !done && <p className="small muted" style={{ marginTop: 8 }}>Read only in the liaison seat.</p>}
    </Section>
  )
}

type Hero = { key: string; title: string; sub: ReactNode; cmd?: { label: string; prefix: string; run: () => void } }
function heroFor(inc: Incident, S: State): Hero {
  const onScene = inc.assignments.filter(a => !a.released && lastConf(a).state === 'On scene')
  const asker = (onScene.find(a => S.units[a.unitId].type === 'patrol') ?? onScene[0])?.unitId
  const pf = inc.pendingField
  if (pf) return { key: `wait-${pf.want}`, title: `Asked ${pf.unitId} ${pf.want === 'Clearing' ? 'if recovery has started' : 'if all lanes are open'}`,
    sub: <span className="next-wait"><Spinner /> Waiting for a radio reply · <span className="num">{fmtAge(S.now - pf.at)}</span></span> }
  if (inc.state === 'Road clear') {
    const div = inc.diversion?.status === 'active', live = inc.messages.find(m => m.status === 'published')
    if (!div && !live) return { key: 'reopened', title: 'All lanes open, confirmed', sub: 'Traffic is back to normal. Close the incident next.' }
    return { key: 'reopen', title: 'All lanes open, confirmed', sub: div && live ? 'Lift the diversion and take the public message down.' : div ? 'Lift the diversion.' : 'Take the public message down.',
      cmd: { label: 'Reopen traffic', prefix: div ? 'Lift diversion' : 'Withdraw', run: () => { if (div) E.liftDiversion(inc.id); if (live) E.withdrawMessage(inc.id, live.id) } } }
  }
  if (!asker) return { key: 'arriving', title: 'Waiting for units on scene', sub: 'This step starts when the first unit arrives.' }
  if (inc.state === 'Clearing') return { key: 'clearing', title: 'Recovery under way', sub: `Ask ${asker} to confirm all lanes are open.`,
    cmd: { label: 'Ask: all lanes open?', prefix: 'Request road clear', run: () => E.requestFieldStatus(inc.id, 'Road clear') } }
  return { key: 'onscene', title: `${asker} is on scene`, sub: 'Radio them to confirm recovery has started.',
    cmd: { label: 'Ask: recovery started?', prefix: 'Request clearing', run: () => E.requestFieldStatus(inc.id, 'Clearing') } }
}

function NextStep({ inc }: { inc: Incident }) {
  const S = useSim()
  const h = heroFor(inc, S)
  const reduce = useReducedMotion()
  return (
    <div className={`next ${h.cmd ? '' : 'is-quiet'}`} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={h.key} className="next-body"
          initial={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(2px)', transform: 'translateY(4px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)', transform: 'translateY(0px)' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(2px)', transform: 'translateY(-4px)' }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
          <div className="next-text"><div className="next-title">{h.title}</div><div className="next-sub">{h.sub}</div></div>
          {h.cmd && <Cmd inc={inc} prefix={h.cmd.prefix} kind="primary" onClick={h.cmd.run} disabled={S.role === 'liaison'}>{h.cmd.label}</Cmd>}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// Diversion + public message, grouped by who holds them now. Same-status items share one line.
function TrafficStatus({ inc }: { inc: Incident }) {
  const S = useSim()
  const d = inc.diversion
  const msg = inc.messages.find(m => m.status === 'draft' || m.status === 'approved' || m.status === 'published')
  const sup = S.role === 'supervisor', lia = S.role === 'liaison'
  const waiting = [d?.status === 'awaiting approval' && 'Diversion', msg?.status === 'draft' && 'message'].filter(Boolean) as string[]
  const live = [d?.status === 'active' && 'Diversion active', msg?.status === 'published' && 'message live'].filter(Boolean) as string[]
  const since = Math.min(...[d?.status === 'awaiting approval' ? d.updatedAt : Infinity, msg?.status === 'draft' ? msg.updatedAt : Infinity])
  if (!waiting.length && !live.length && msg?.status !== 'approved' && d?.status !== 'proposed') return null
  const join = (xs: string[]) => xs.map((x, i) => i === 0 ? x[0].toUpperCase() + x.slice(1) : x).join(' and ')
  return (
    <ul className="tstat" aria-label="Diversion and public message">
      {d?.status === 'proposed' && <li><Clock size={16} weight="bold" className="tstat-ic" aria-hidden />
        <span className="tstat-txt"><span className="tstat-h">Diversion not sent</span><span className="tstat-d">{d.label}</span></span>
        <Cmd inc={inc} prefix="Request diversion" kind="sm" onClick={() => E.requestDiversionApproval(inc.id)} disabled={lia}>Send to supervisor</Cmd></li>}
      {waiting.length > 0 && <li><Clock size={16} weight="bold" className="tstat-ic" aria-hidden />
        <span className="tstat-txt"><span className="tstat-h">{join(waiting)} with supervisor</span>{d?.status === 'awaiting approval' && <span className="tstat-d">{d.label}</span>}</span>
        {sup ? <Cmd inc={inc} prefix="Approve" kind="sm" onClick={() => { if (d?.status === 'awaiting approval') E.approveDiversion(inc.id); if (msg?.status === 'draft') E.approveMessage(inc.id, msg.id) }}>Approve</Cmd>
          : <span className="tstat-age num">{fmtAge(S.now - since)}</span>}</li>}
      {msg?.status === 'approved' && <li><ShieldCheck size={16} weight="bold" className="tstat-ic ok" aria-hidden />
        <span className="tstat-txt"><span className="tstat-h">Message approved</span><span className="tstat-d">Ready for the public traffic feed</span></span>
        <Cmd inc={inc} prefix="Publish" kind="sm" onClick={() => E.publishMessage(inc.id, msg.id)} disabled={lia}>Publish</Cmd></li>}
      {live.length > 0 && <li><Broadcast size={16} weight="bold" className="tstat-ic ok" aria-hidden />
        <span className="tstat-txt"><span className="tstat-h">{join(live)}</span>{d?.status === 'active' && <span className="tstat-d">{d.label}</span>}</span></li>}
    </ul>
  )
}

// The message reads as text; editing is one click away and happens in place.
function MessageBlock({ inc }: { inc: Incident }) {
  const S = useSim()
  const msg = [...inc.messages].reverse().find(m => m.status !== 'withdrawn') ?? inc.messages.at(-1)
  const [editing, setEditing] = useState(false)
  const done = isTerminal(inc), lia = S.role === 'liaison'
  const editable = !done && !lia && (!msg || msg.status === 'draft' || msg.status === 'approved')
  if (editing) return <div className="clear-msg"><div className="msg-head"><span className="label">Public message</span></div><MessageComposer inc={inc} onDone={() => setEditing(false)} /></div>
  if (!msg) return editable ? <div className="clear-msg"><button className="link-btn" onClick={() => setEditing(true)}><PencilSimple size={14} weight="bold" aria-hidden /> Write a public message</button></div> : null
  return (
    <div className="clear-msg">
      <div className="msg-head">
        <span className="label">Public message</span>
        {editable && <button className="link-btn" onClick={() => setEditing(true)} aria-label="Edit public message"><PencilSimple size={14} weight="bold" aria-hidden /> Edit</button>}
      </div>
      <p className={`msg-preview ${msg.status === 'withdrawn' ? 'muted' : ''}`}>{msg.text}</p>
    </div>
  )
}

function MessageComposer({ inc, onDone }: { inc: Incident; onDone: () => void }) {
  const msg = [...inc.messages].reverse().find(m => m.status !== 'withdrawn')
  const [draft, setDraft] = useState<string>(msg?.text ?? '')
  const [ai, setAi] = useState<{ loading: boolean; res?: AIResult<MessageDraft>; lang: 'english' | 'pidgin' | 'yoruba'; edited: boolean }>({ loading: false, lang: 'english', edited: false })
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const t = ref.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length) } }, [])
  const runAI = async () => {
    setAi(a => ({ ...a, loading: true }))
    const res = await draftMessage(messageFacts(inc))
    setAi({ loading: false, res, lang: 'english', edited: false })
    setDraft(res.data.english)
  }
  const pickLang = (lang: 'english' | 'pidgin' | 'yoruba') => { const t = ai.res?.data[lang]; if (t) { setAi(a => ({ ...a, lang, edited: false })); setDraft(t) } }
  const text = draft.trim(), changed = text !== '' && draft !== msg?.text
  const save = () => {
    if (!changed) return
    E.draftMessage(inc.id, draft)
    if (ai.res) E.logAI(inc.id, `Public message drafted with AI (${ai.lang}${ai.edited ? ', edited by operator' : ''}). Facts used: ${ai.res.data.used.join(', ')}.`)
    onDone()
  }
  return (
    <div className="composer" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
      onClick={e => { if ((e.target as HTMLElement).classList.contains('composer')) ref.current?.focus() }}>
      {ai.res && !ai.loading && <motion.div className="ai-meta" initial={{ opacity: 0, filter: 'blur(2px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
        <AIBadge mode={ai.res.mode} edited={ai.edited} />
        <div className="seg" role="group" aria-label="Language">
          {(['english', 'pidgin', 'yoruba'] as const).map(l => <button key={l} aria-pressed={ai.lang === l} disabled={!ai.res!.data[l]} title={!ai.res!.data[l] ? (ai.res!.mode === 'demo' ? 'Yoruba needs live AI and a fluent reviewer' : 'Not confident enough to draft Yoruba') : undefined} onClick={() => pickLang(l)}>{l[0].toUpperCase() + l.slice(1)}</button>)}
        </div>
        <span className="small muted">Used: {ai.res.data.used.join(', ')}</span>
      </motion.div>}
      {ai.loading
        ? <div className="ai-loading composer-loading"><div className="skel" style={{ height: 14, width: '92%' }} /><div className="skel" style={{ height: 14, width: '64%' }} /><span className="small"><Spark /> Drafting from the confirmed facts…</span></div>
        : <motion.textarea ref={ref} key={ai.res ? `ai-${ai.lang}` : 'own'} className="composer-input" rows={3}
            initial={ai.res ? { opacity: 0, filter: 'blur(2px)' } : false} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            value={draft} placeholder="Tell drivers what’s happening and which way to go…" aria-label="Public message"
            onChange={e => { setDraft(e.target.value); if (ai.res) setAi(a => ({ ...a, edited: true })) }} />}
      {ai.res && ai.res.data.caution && !ai.loading && <p className="small composer-caution">{ai.res.data.caution}</p>}
      <div className="composer-bar">
        <button className="btn ghost sm ai-btn" onClick={runAI} disabled={ai.loading}><Spark /> {ai.res || msg ? 'Redraft with AI' : 'Draft with AI'}</button>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={onDone}>Cancel</button>
        <Cmd inc={inc} prefix="Save message" kind="primary sm" disabled={!changed || ai.loading} onClick={save}>Send to supervisor</Cmd>
      </div>
    </div>
  )
}

// ---------------- Close ----------------
function CloseSection({ inc, lead }: { inc: Incident; lead: boolean }) {
  const S = useSim()
  const [disp, setDisp] = useState('')
  const [detail, setDetail] = useState('')
  const m = metricsOf(inc)
  const warn: string[] = []
  const notArrived = inc.assignments.filter(a => !a.released && lastConf(a).state !== 'On scene')
  if (notArrived.length) warn.push(`${notArrived.map(a => a.unitId).join(', ')} not on scene`)
  if (inc.diversion?.status === 'active') warn.push('diversion still active')
  if (inc.messages.some(x => x.status === 'published')) warn.push('message still published')
  const summary = inc.state === 'Closed' ? inc.disposition : 'Needs a disposition'
  return (
    <Section id="close" inc={inc} title="Close" summary={summary} lead={lead}>
      {inc.state === 'Closed' ? <>
        <p><b>{inc.disposition}</b> <span className="muted small">· closed {fmtTime(inc.closedAt!, false)}</span></p>
        <div className="metrics">
          {([['Verify', m.verify], ['Acknowledge', m.assign], ['Arrive', m.arrive], ['Clear', m.clear]] as const).map(([k, v]) => <div key={k}><span className="muted small">{k}</span><b className="num">{fmtDur(v)}</b></div>)}
        </div>
      </> : isTerminal(inc) ? <p className="small muted">{inc.state}.</p>
        : inc.state !== 'Road clear' ? <p className="small muted">Available once the scene confirms all lanes open.</p>
        : <>
          <div className="inline-form" style={{ marginTop: 0 }}>
            <select className={disp ? '' : 'is-placeholder'} value={disp} onChange={e => setDisp(e.target.value)} disabled={S.role === 'liaison'}><option value="" disabled hidden>Where did the vehicle go?</option>{E.DISPOSITIONS.map(d => <option key={d}>{d}</option>)}</select>
            <input type="text" value={detail} onChange={e => setDetail(e.target.value)} placeholder="Detail (optional)" disabled={S.role === 'liaison'} />
          </div>
          {warn.length > 0 && <p className="small" style={{ marginTop: 6, color: 'var(--act-ink)' }}>Still open: {warn.join(', ')}.</p>}
          <div className="actions"><Cmd inc={inc} prefix="Close incident" kind="primary" disabled={!disp || S.role === 'liaison'} onClick={() => E.closeIncident(inc.id, disp, detail.trim())}>Close incident</Cmd></div>
        </>}
      <Pendings inc={inc} prefixes={['Close incident']} />
    </Section>
  )
}

// ---------------- Timeline ----------------
function TimelineSection({ inc, lead }: { inc: Incident; lead: boolean }) {
  const S = useSim()
  const [audit, setAudit] = useState(false)
  const evs = [...inc.timeline].reverse()
  const shown = audit ? evs : evs.filter(e => e.kind !== 'notify' || /acknowledged/.test(e.text) === false)
  return (
    <Section id="timeline" inc={inc} title="Timeline" summary={`${inc.timeline.length} events · last ${fmtAge(S.now - (inc.timeline.at(-1)?.at ?? S.now))} ago`} lead={lead}>
      {S.role === 'supervisor' && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}><button className="btn ghost sm" aria-pressed={audit} onClick={() => setAudit(!audit)}>{audit ? 'Back to timeline' : 'Audit log'}</button></div>}
      {audit ? <ul className="tl">
        {shown.map(e => <li key={e.id} className={`k-${e.kind}`}>
          <span className="when">{fmtTime(e.at)}</span>
          <span><span className="txt">{e.text}</span> <span className="who">· {e.actor} · via {e.route} · {e.kind}</span></span>
        </li>)}
      </ul> : <TimelineTrack inc={inc} />}
    </Section>
  )
}

type Sugg = { t: UnitType; units: { u: Unit; eta: number; km: number }[] }[]
/** One decision instead of five: the nearest unit of each needed type, plus the matching playbook. Any row can be unticked. */
function RecommendedTeam({ inc, want, suggested, canDispatch, playbook }: { inc: Incident; want: UnitType[]; suggested: Sugg; canDispatch: (u: Unit) => boolean; playbook?: { id: string; name: string; diversion: { label: string } } }) {
  const S = useSim()
  const have = new Set(inc.assignments.filter(a => !a.released).map(a => S.units[a.unitId]?.type))
  const picks = want.filter(t => !have.has(t)).map(t => suggested.find(g => g.t === t)?.units[0]).filter((x): x is Sugg[number]['units'][number] => !!x && canDispatch(x.u))
  const [off, setOff] = useState<Record<string, boolean>>({})
  const [pbOff, setPbOff] = useState(false)
  if (!picks.length && !playbook) return null
  const chosen = picks.filter(p => !off[p.u.id])
  const usePb = !!playbook && !pbOff && S.role !== 'liaison'
  const busy = S.pending.some(p => p.incidentId === inc.id && p.status === 'pending' && (p.label.startsWith('Dispatch') || p.label.startsWith('Activate')))
  const go = () => { for (const p of chosen) E.dispatchUnit(inc.id, p.u.id); if (usePb && playbook) E.activatePlaybook(inc.id, playbook.id) }
  return (
    <div className="team">
      <ul>
        {picks.map(({ u, eta }) => <li key={u.id}><label>
          <input type="checkbox" checked={!off[u.id]} onChange={() => setOff(o => ({ ...o, [u.id]: !o[u.id] }))} />
          <b className="num">{u.callsign}</b><span className="small muted">{u.type}{u.capacity ? ` · ${u.capacity}` : ''}</span>
          <span className="spacer" style={{ flex: 1 }} /><span className="small num muted">~{Math.round(eta / 60)} min</span>
        </label></li>)}
        {playbook && <li><label>
          <input type="checkbox" checked={!pbOff} disabled={S.role === 'liaison'} onChange={() => setPbOff(!pbOff)} />
          <b>Diversion and message</b><span className="small muted">{playbook.diversion.label}</span>
        </label></li>}
      </ul>
      <div className="actions" style={{ marginTop: 8 }}>
        <button className={`btn primary ${busy ? 'pending' : ''}`} disabled={(!chosen.length && !usePb) || busy} onClick={go}>{busy && <Spinner />}Dispatch {chosen.length} unit{chosen.length === 1 ? '' : 's'}</button>
      </div>
    </div>
  )
}

/** Approval belongs to another seat. In the prototype you can take that seat; in production this would notify the supervisor. */

// ---------------- AI assists ----------------
export const Spark = () => <Sparkle size={13} weight="fill" aria-hidden />
function AIBadge({ mode, edited, kind = 'draft' }: { mode: 'live' | 'demo'; edited?: boolean; kind?: 'draft' | 'read' }) {
  return <span className="ai-badge" title={mode === 'demo' ? 'Demo mode: no API key is set, so this is a rule-based stand-in for the model' : 'From Claude. A person checks it before anything changes.'}><Spark /> AI {kind}{edited ? ' · edited' : ''}{mode === 'demo' ? ' · demo' : ''}</span>
}

function messageFacts(inc: Incident): MessageFacts {
  const seg = segById[inc.segId]
  const d = inc.diversion && inc.diversion.status !== 'lifted' ? { label: inc.diversion.label, status: inc.diversion.status } : null
  return {
    incidentId: inc.id, kind: `${inc.type}, ${inc.vehicle}`, road: seg.name, corridor: seg.corridor, direction: inc.dir,
    lanesBlocked: inc.lanesBlocked, lanesTotal: seg.lanes, severity: inc.severity, diversion: d,
    hazards: (Object.keys(inc.hazards) as (keyof Incident['hazards'])[]).filter(k => inc.hazards[k]),
  }
}

const readCache = new Map<string, { res: AIResult<ReportRead>; applied?: boolean }>()
/** Reads every report on the incident and suggests structured fields, each tied to the exact words it came from. Never applies itself. */
function AIRead({ inc, canApply }: { inc: Incident; canApply: boolean }) {
  const key = `${inc.id}:${inc.sources.length}`
  const [entry, setEntry] = useState(() => readCache.get(key))
  useEffect(() => {
    const hit = readCache.get(key)
    if (hit) { setEntry(hit); return }
    setEntry(undefined)
    let live = true
    readReports(inc.sources.map(s => ({ id: s.id, label: E.sourceLabel(s), text: s.content, reportedAt: fmtTime(s.receivedAt, false) }))).then(res => {
      const e = { res }; readCache.set(key, e); if (live) setEntry(e)
    })
    return () => { live = false }
  }, [key])
  if (!entry) return <div className="ai-card"><div className="ai-head"><span className="ai-badge"><Spark /> AI</span><span className="small muted">Reading {inc.sources.length} report{inc.sources.length > 1 ? 's' : ''}…</span></div><div className="skel" style={{ height: 22, width: '75%', marginTop: 8 }} /></div>
  const r = entry.res.data
  const quote = (f: string) => r.evidence.filter(e => e.field === f).map(e => `“${e.quote}”`).join(' · ')
  const seg = r.segId ? segById[r.segId] : undefined
  const tags: { k: string; field: string; label: string }[] = [
    ...(seg ? [{ k: 'road', field: 'road', label: seg.corridor }] : []),
    ...(r.direction ? [{ k: 'dir', field: 'direction', label: r.direction }] : []),
    ...(r.vehicle ? [{ k: 'veh', field: 'vehicle', label: r.vehicle }] : []),
    ...(r.lanesBlocked != null ? [{ k: 'lanes', field: 'lanes', label: `${r.lanesBlocked} lane${r.lanesBlocked === 1 ? '' : 's'} blocked` }] : []),
    ...(['injuries', 'tanker', 'hazmat', 'secondary'] as const).filter(h => r.hazards[h]).map(h => ({ k: h, field: h, label: ({ injuries: 'Injuries', tanker: 'Tanker', hazmat: 'Hazardous load', secondary: 'Secondary risk' })[h] })),
  ]
  const toLanes = r.lanesBlocked != null && r.lanesBlocked !== inc.lanesBlocked ? r.lanesBlocked : null
  const toHaz = (['injuries', 'tanker', 'hazmat', 'secondary'] as const).filter(h => r.hazards[h] && !inc.hazards[h])
  const pending = toLanes != null || toHaz.length > 0
  const apply = () => {
    if (toLanes != null) E.setLanes(inc.id, toLanes)
    for (const h of toHaz) E.toggleHazard(inc.id, h)
    const what = [toLanes != null ? `${toLanes} lanes blocked` : null, ...toHaz].filter(Boolean).join(', ')
    E.logAI(inc.id, `Applied AI read of reports: ${what}. Evidence: ${r.evidence.filter(e => e.field === 'lanes' || toHaz.includes(e.field as never)).map(e => `“${e.quote}”`).join(' ')}`)
    const e = { ...entry, applied: true }; readCache.set(key, e); setEntry(e)
  }
  return (
    <motion.div className="ai-card" initial={{ opacity: 0, filter: 'blur(2px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
      <div className="ai-head">
        <AIBadge mode={entry.res.mode} kind="read" />
        <span className="small muted">Read of {inc.sources.length} report{inc.sources.length > 1 ? 's' : ''}</span>
        <span className="spacer" style={{ flex: 1 }} />
        {canApply && (entry.applied ? <span className="small" style={{ color: 'var(--ok-ink)' }}><Icon.check /> Applied</span>
          : pending && <button className="btn sm" onClick={apply}>Apply to Assess</button>)}
      </div>
      {tags.length ? <div className="ai-tags">{tags.map(t => <span key={t.k} className="ai-tag" tabIndex={0} title={quote(t.field) || undefined}>{t.label}</span>)}</div>
        : <p className="small muted" style={{ marginTop: 6 }}>Nothing specific enough to suggest yet.</p>}
      {seg && r.segId !== inc.segId && <p className="small" style={{ marginTop: 6, color: 'var(--watch)' }}>Reports point to {seg.name}; the incident is placed on {segById[inc.segId].name}.</p>}
    </motion.div>
  )
}

// ---------------- Notes ----------------
const NoteIcon = () => <NotePencil size={15} weight="bold" aria-hidden />
const initials = (who: string) => who.replace(/\(.*\)/, '').split(/[\s·]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

/** Notes between seats. A pill in the corner morphs into a small card; the composer is there only when you want it.
 *  Notes are not world state, so they appear instantly ("Sending…") and settle when the server confirms. */
function NotesDock({ inc }: { inc: Incident }) {
  const S = useSim()
  const U = useUI()
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState<{ id: string; text: string; at: number }[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const notes = inc.timeline.filter(e => e.kind === 'note')
  const closed = isTerminal(inc)
  const failed = S.pending.find(p => p.incidentId === inc.id && p.label === 'Add note' && p.status === 'failed')

  useEffect(() => { setOpen(false); setText(''); setSending([]) }, [inc.id])
  useEffect(() => { setSending(s => s.filter(p => !notes.some(n => n.text === p.text && n.at >= p.at))) }, [notes.length])
  useEffect(() => { const h = () => { if (!closed) setOpen(true) }; window.addEventListener('ltoc-note', h); return () => window.removeEventListener('ltoc-note', h) }, [closed])
  useEffect(() => { if (open) listRef.current?.scrollTo({ top: 1e6 }) }, [open, notes.length, sending.length])
  if (closed && !notes.length) return null

  const post = () => {
    const t = text.trim(); if (!t) return
    setSending(s => [...s, { id: `${Date.now()}`, text: t, at: S.now }])
    E.addNote(inc.id, t); setText('')
  }
  const instant = reduce || U.lastInput === 'keyboard'
  const morph = instant ? { duration: 0 } : { type: 'spring' as const, damping: 25, stiffness: 300 }
  const enter = instant ? false : { opacity: 0, transform: 'translateY(4px)', filter: 'blur(2px)' }

  return (
    <div className="notes-dock">
      <AnimatePresence initial={false} mode="popLayout">
        {open ? (
          <motion.div key="card" layoutId={`notes-${inc.id}`} className="note-card" style={{ borderRadius: 16 }} transition={morph} role="dialog" aria-label={`Notes on ${inc.id}`}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}>
            <motion.div className="note-inner" initial={instant ? false : { opacity: 0 }} animate={{ opacity: 1, transition: { delay: instant ? 0 : 0.08, duration: 0.15 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
              <div className="note-head">
                <b>Notes</b><span className="muted small">Everyone on {inc.id} sees these</span>
                <span className="spacer" style={{ flex: 1 }} />
                <button className="btn ghost sm icon" onClick={() => setOpen(false)} aria-label="Close notes"><Icon.x /></button>
              </div>
              <div className="note-list" ref={listRef}>
                {notes.length === 0 && sending.length === 0 && <p className="small muted note-empty">No notes yet.</p>}
                {notes.map(n => <motion.div key={n.id} className="sticky" initial={enter} animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
                  <div className="sticky-meta"><span className="avatar sm" aria-hidden>{initials(n.actor)}</span>{n.actor}<span className="muted num">{fmtTime(n.at, false)}</span></div>
                  <p>{n.text}</p>
                </motion.div>)}
                {sending.map(p => <motion.div key={p.id} className="sticky sending" initial={enter} animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
                  <div className="sticky-meta"><span className="avatar sm" aria-hidden>{initials(S.seat)}</span>You
                    {failed ? <span className="stale">Not sent · <button className="link" onClick={() => E.retry(failed.id)}>Retry</button></span> : <span className="muted">Sending…</span>}</div>
                  <p>{p.text}</p>
                </motion.div>)}
              </div>
              {!closed && <div className="note-compose">
                <textarea autoFocus rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Write a note…" aria-label="New note"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post() } }} />
                <div className="note-foot">
                  <span className="small muted">Enter to post · Shift+Enter for a new line</span>
                  <button className="btn primary sm" disabled={!text.trim()} onClick={post}>Post</button>
                </div>
              </div>}
            </motion.div>
          </motion.div>
        ) : (
          <motion.button key="pill" layoutId={`notes-${inc.id}`} className="note-pill" style={{ borderRadius: 9999 }} transition={morph} onClick={() => setOpen(true)} aria-label={closed ? `Read ${notes.length} notes` : 'Add a note (N)'} title={closed ? undefined : 'Add a note (N)'}>
            <motion.span className="note-pill-in" initial={instant ? false : { opacity: 0 }} animate={{ opacity: 1, transition: { delay: instant ? 0 : 0.06, duration: 0.12 } }}>
              <NoteIcon />{notes.length ? <>{notes.length}<span className="sr-only"> {notes.length === 1 ? "note" : "notes"}</span></> : 'Note'}
            </motion.span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
