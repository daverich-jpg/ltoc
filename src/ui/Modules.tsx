import { Fragment, useEffect, useMemo, useState } from 'react'
import * as E from '../sim/engine'
import { CORRIDOR_SEGS, isOpen, isTerminal, lastConf, metricsOf, nextAction, readingFor, segmentStatus, tierOf, TIER_LABEL, assignmentOverdue, type Cond } from '../sim/derive'
import { CORRIDORS, GEO_AS_OF, GEO_SOURCE, nodeById, segById } from '../sim/geo'
import { AGENCIES } from '../sim/seed'
import type { AgencyId, Incident, Tier } from '../sim/types'
import { Age, Assumed, Icon, Sim, StateChip, TierGlyph, fmtAge, fmtDur, fmtTime } from './bits'
import { COND_LEGEND, MapCanvas } from './MapCanvas'
import { go, openIncident, setUI, useSim, useUI } from './store'

const COND_RANK: Record<Cond, number> = { Free: 0, Slow: 1, Heavy: 2, Standstill: 3 }

// ================= Overview =================
export function Overview() {
  const S = useSim()
  const open = Object.values(S.incidents).filter(isOpen)
  const tiers = open.map(i => ({ inc: i, t: tierOf(i, S) }))
  const count = (t: Tier) => tiers.filter(x => x.t.tier === t).length
  const act = tiers.filter(x => x.t.tier === 'act').sort((a, b) => a.inc.createdAt - b.inc.createdAt)
  const feedAge = S.now - S.feedAt
  const corridors = CORRIDORS.map(c => {
    const segs = CORRIDOR_SEGS(c)
    const worst = segs.map(s => ({ s, r: readingFor(s.id, S) })).sort((a, b) => COND_RANK[b.r.cond] - COND_RANK[a.r.cond] || a.r.speed - b.r.speed)[0]
    const incs = open.filter(i => segs.some(s => s.id === i.segId))
    const closed = segs.some(s => segmentStatus(s.id, S).closed)
    return { c, worst, incs, closed, critical: segs.some(s => s.critical) }
  }).sort((a, b) => Number(b.closed) - Number(a.closed) || b.incs.length - a.incs.length || COND_RANK[b.worst.r.cond] - COND_RANK[a.worst.r.cond]).filter((c, i) => i < 6 || c.incs.length || c.closed)
  const busyUnits = Object.values(S.units).filter(u => u.state !== 'Available' && u.state !== 'Unavailable').length
  return (
    <div className="page">
      <div className="page-head"><div><h1>Overview</h1></div></div>
      <div className="strip" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }} role="list" aria-label="Citywide status">
        <div className="panel stat" role="listitem"><div className="k"><TierGlyph tier="act" /> Act now</div><div className="v" style={{ color: count('act') ? 'var(--act)' : undefined }}>{count('act')}</div>{count('act') > 3 && <div className="s stale">Over the alert budget of 3</div>}</div>
        <div className="panel stat" role="listitem"><div className="k"><TierGlyph tier="watch" /> Watch</div><div className="v">{count('watch')}</div></div>
        <div className="panel stat" role="listitem"><div className="k">Units committed</div><div className="v">{busyUnits}<span className="muted" style={{ fontSize: 16 }}> of {Object.keys(S.units).length}</span></div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 12, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="panel" aria-label="Attention queue">
            <div className="panel-h"><TierGlyph tier="act" /><h2>Needs action</h2></div>
            <div className="panel-b" style={{ padding: 0 }}>
              {act.length === 0 ? <p className="muted" style={{ padding: 16 }}>Nothing needs action.</p>
                : <table className="t"><tbody>{act.map(({ inc, t }) => (
                  <tr key={inc.id} className="click" onClick={() => openIncident(inc.id)}>
                    <td style={{ width: 84 }}><span className="num">{inc.id}</span><br /><Age ms={S.now - inc.createdAt} /></td>
                    <td><b>{inc.title}</b><div className="small" style={{ color: 'var(--act-ink)' }}>{t.reasons[0]}</div></td>
                    <td style={{ width: 120 }}><StateChip state={inc.state} /></td>
                  </tr>))}</tbody></table>}
            </div>
          </section>
          <section className="panel" aria-label="Corridor status" style={{ flex: 1 }}>
            <div className="panel-h" style={{ paddingLeft: 16 }}><h2>Corridors</h2></div>
            <table className="t"><tbody>{corridors.map(c => (
              <tr key={c.c}>
                <td style={{ paddingLeft: 16 }}>{c.c}</td>
                <td style={{ width: 120 }}><CondBadge cond={c.worst.r.cond} stale={feedAge > 180000} /></td>
                <td style={{ width: 90 }} className="small">{c.closed ? <span className="chip act">Closed</span> : c.incs.length ? <span className="chip outline">{c.incs.length} incident{c.incs.length > 1 ? 's' : ''}</span> : null}</td>
              </tr>))}</tbody></table>
          </section>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Handover />
        </div>
      </div>
    </div>
  )
}

export function CondBadge({ cond, stale }: { cond: Cond; stale?: boolean }) {
  const st = COND_LEGEND[cond]
  return <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <svg width="22" height="8" aria-hidden><line x1="2" y1="4" x2="20" y2="4" stroke={stale ? 'var(--text-3)' : st.c} strokeWidth={Math.min(6, st.w)} strokeDasharray={stale ? '2 3' : st.dash} strokeLinecap="round" /></svg>
    <span className={stale ? 'muted' : ''}>{cond}{stale ? ' (stale)' : ''}</span>
  </span>
}

function Handover() {
  const S = useSim()
  const open = Object.values(S.incidents).filter(isOpen).sort((a, b) => ({ act: 0, watch: 1, ambient: 2, none: 3 }[tierOf(a, S).tier] - { act: 0, watch: 1, ambient: 2, none: 3 }[tierOf(b, S).tier]))
  const closedThisShift = Object.values(S.incidents).filter(i => isTerminal(i)).length
  return (
    <section className="panel" aria-label="Shift handover" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-h"><h2>Handover</h2><span className="muted small">{open.length} open</span></div>
      <div className="panel-b" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ol className="small" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {open.map(i => <li key={i.id} style={{ display: 'grid', gridTemplateColumns: '16px 74px 1fr', gap: 6 }}>
            <TierGlyph tier={tierOf(i, S).tier} /><button className="btn ghost sm num" style={{ height: 18, padding: '0 4px', justifyContent: 'flex-start' }} onClick={() => openIncident(i.id)}>{i.id}</button>
            <span>{i.title}<br /><span className="dim">{nextAction(i, S)}</span></span>
          </li>)}
        </ol>
        <textarea value={S.handoverNotes} onChange={e => E.setHandoverNotes(e.target.value)} placeholder="Notes for the next shift" aria-label="Notes for the next shift" style={{ marginTop: 12, flex: 1, resize: 'none' }} />
      </div>
    </section>
  )
}

// ================= Live map =================
export function LiveMapModule({ focusId, wsOpen }: { focusId?: string; wsOpen?: boolean }) {
  const S = useSim()
  const U = useUI()
  const [layersOpen, setLayersOpen] = useState(!wsOpen)
  useEffect(() => { if (wsOpen) setLayersOpen(false) }, [wsOpen])
  const feedAge = S.now - S.feedAt
  return (
    <>
      <MapCanvas focusId={focusId} wsOpen={wsOpen} />
      {feedAge > 180000 && <div className="banner" role="alert"><Icon.alert />Traffic feed stale for {fmtAge(feedAge)}. Showing last known readings, greyed.</div>}
      <div className="map-ctrl">
        <div className="layers">
          <button className="btn ghost sm" style={{ justifyContent: 'space-between' }} onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen}>Layers <span className={`chev ${layersOpen ? 'open' : ''}`}><Icon.chev /></span></button>
          {layersOpen && <>
            {(Object.keys(U.layers) as (keyof typeof U.layers)[]).map(k => <label key={k}><input type="checkbox" checked={U.layers[k]} onChange={e => setUI(u => ({ layers: { ...u.layers, [k]: e.target.checked } }))} />{k[0].toUpperCase() + k.slice(1)}</label>)}
            <div className="legend">
              {(Object.keys(COND_LEGEND) as Cond[]).map(c => <Fragment key={c}><svg width="26" height="8"><line x1="2" y1="4" x2="24" y2="4" stroke={COND_LEGEND[c].c} strokeWidth={COND_LEGEND[c].w} strokeDasharray={COND_LEGEND[c].dash} strokeLinecap="round" /></svg><span>{c}</span></Fragment>)}
              <svg width="26" height="12"><path d="M13 1 22 11H4Z" fill="var(--act)" /></svg><span>Act now</span>
              <svg width="26" height="12"><path d="M13 1 18 6 13 11 8 6Z" fill="var(--watch-fill)" stroke="var(--watch)" strokeWidth="1.6" /></svg><span>Watch</span>
              <svg width="26" height="12"><path d="M13 1 18 6 13 11 8 6Z" fill="none" stroke="var(--watch)" strokeWidth="2" strokeDasharray="3 2" /></svg><span>Unverified</span>
              <svg width="26" height="14"><circle cx="13" cy="7" r="5.5" fill="none" stroke="var(--text)" strokeWidth="1.3" /></svg><span>Unit</span>
              <svg width="26" height="8"><line x1="2" y1="4" x2="24" y2="4" stroke="var(--diversion)" strokeWidth="2" strokeDasharray="5 4" /></svg><span>Diversion proposed</span>
            </div>
          </>}
        </div>
      </div>
      {U.inspectSeg && !wsOpen && <SegmentInspector segId={U.inspectSeg} />}
      <div className="map-foot" style={wsOpen ? { right: 'calc(min(780px, 62%) + 14px)' } : undefined}>
        <span title={`Road names verified ${GEO_AS_OF}. Geometry hand-placed, to check against OSM. Traffic is simulated.`}>Approximate map · units at last confirmed position</span>
      </div>
    </>
  )
}

function SegmentInspector({ segId }: { segId: string }) {
  const S = useSim()
  const sg = segById[segId]
  const r = readingFor(segId, S)
  const st = segmentStatus(segId, S)
  const hist = S.history.filter(h => h.segId === segId).length
  const cams = S.cameras.filter(c => c.segId === segId)
  return (
    <div className="panel inspector" role="dialog" aria-label={`Segment ${sg.name}`}>
      <div className="panel-h"><h3 style={{ flex: 1 }}>{sg.name}</h3><button className="btn ghost sm" onClick={() => setUI({ inspectSeg: undefined })} aria-label="Close inspector"><Icon.x /></button></div>
      <div className="panel-b">
        <dl className="kv" style={{ gridTemplateColumns: '84px 1fr' }}>
          <dt>Lanes</dt><dd>{sg.lanes} · {sg.dir}</dd>
          <dt>Traffic</dt><dd><CondBadge cond={r.cond} stale={S.now - S.feedAt > 180000} /> <span className="num small muted">{r.kmh} km/h</span></dd>
          {st.closed && <><dt>Status</dt><dd><span className="chip act">Closed by diversion</span></dd></>}
          <dt>Incidents</dt><dd>{st.incidents.length ? st.incidents.map(i => <button key={i.id} className="btn sm" style={{ marginRight: 4 }} onClick={() => openIncident(i.id)}>{i.id}</button>) : <span className="muted">None open</span>}</dd>
        </dl>
      </div>
    </div>
  )
}

// ================= Incidents queue =================
export function IncidentsModule() {
  const S = useSim()
  const [state, setState] = useState<'open' | 'all' | 'resolved'>('open')
  const [tier, setTier] = useState<Tier | 'any'>('any')
  const [q, setQ] = useState('')
  const rows = Object.values(S.incidents).filter(i => state === 'all' || (state === 'open' ? isOpen(i) : isTerminal(i)))
    .filter(i => tier === 'any' || tierOf(i, S).tier === tier)
    .filter(i => !q || (i.id + i.title + segById[i.segId].name + i.leadAgency + i.sources.map(s => s.type).join()).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt)
  return (
    <div className="page">
      <div className="page-head"><div><h1>Incidents</h1></div></div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <div className="seg">{(['open', 'resolved', 'all'] as const).map(s => <button key={s} aria-pressed={state === s} onClick={() => setState(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
        <div className="seg">{(['any', 'act', 'watch', 'ambient'] as const).map(s => <button key={s} aria-pressed={tier === s} onClick={() => setTier(s)}>{s === 'any' ? 'Any tier' : TIER_LABEL[s]}</button>)}</div>
        <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" style={{ maxWidth: 320 }} />
      </div>
      <div className="panel">
        <table className="t">
          <thead><tr><th>Tier</th><th>Incident</th><th>State</th><th>Age</th></tr></thead>
          <tbody>{rows.map(i => { const t = tierOf(i, S); return (
            <tr key={i.id} className="click" onClick={() => openIncident(i.id)}>
              <td><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><TierGlyph tier={t.tier} />{TIER_LABEL[t.tier]}</span></td>
              <td><b>{i.title}</b><div className="small muted num">{i.id}</div></td>
              <td><StateChip state={i.state} /></td>
              <td><Age ms={S.now - i.createdAt} /></td>
            </tr>) })}</tbody>
        </table>
        {rows.length === 0 && <p className="muted" style={{ padding: 14 }}>No incidents match.</p>}
      </div>
    </div>
  )
}

// ================= Response coordination =================
export function ResponseModule() {
  const S = useSim()
  const [tab, setTab] = useState<'units' | 'recovery' | 'playbooks' | 'messages' | 'seats'>('units')
  const units = Object.values(S.units)
  return (
    <div className="page">
      <div className="page-head"><div><h1>Response</h1></div></div>
      <div className="seg" style={{ marginBottom: 12 }}>{(['units', 'recovery', 'playbooks', 'messages', 'seats'] as const).map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{({ units: 'Unit board', recovery: 'Recovery assets', playbooks: 'Playbooks', messages: 'Public messages', seats: 'Agency seats' })[t]}</button>)}</div>
      {(tab === 'units' || tab === 'recovery') && <div className="panel">
                <table className="t">
          <thead><tr><th style={{ paddingLeft: 16 }}>Unit</th><th>{tab === 'recovery' ? 'Capacity' : 'Agency'}</th><th>State</th><th>Confirmed</th><th>Incident</th></tr></thead>
          <tbody>{units.filter(u => tab === 'recovery' ? u.type === 'recovery' : u.type !== 'recovery').sort((a, b) => a.agency.localeCompare(b.agency) || a.id.localeCompare(b.id)).map(u => {
            const inc = u.incidentId ? S.incidents[u.incidentId] : undefined
            const a = inc?.assignments.find(x => x.unitId === u.id && !x.released)
            const od = a && assignmentOverdue(a, S)
            return <tr key={u.id}>
              <td style={{ paddingLeft: 16 }} className="num">{u.callsign}</td>
              <td className="small">{tab === 'recovery' ? `${u.capacity}${u.owner === 'private' ? ' · private' : ''}` : `${u.agency} · ${u.type}`}</td>
              <td><span className={`chip ${od ? 'act' : u.state === 'Available' ? 'outline' : ''}`}>{u.state === 'Dispatched' ? 'Dispatched · no ack' : u.state}</span></td>
              <td className="small muted num">{fmtAge(S.now - u.stateAt)} ago</td>
              <td>{inc ? <button className="btn sm" onClick={() => openIncident(inc.id)}>{inc.id}</button> : <span className="muted">—</span>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>}
      {tab === 'playbooks' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {S.playbooks.map(pb => <div key={pb.id} className="panel"><div className="panel-h"><h2>{pb.name}</h2><span className="num muted small">{pb.id}</span><Assumed what="playbook content, needs operations review" /></div><div className="panel-b small">
          <p className="muted">Trigger: {pb.trigger}</p>
          <ol style={{ paddingLeft: 18 }}>{pb.steps.map(s => <li key={s}>{s}</li>)}</ol>
          <p>Diversion: {pb.diversion.label}</p><p className="muted">Notifies {pb.notify.join(', ')}</p>
        </div></div>)}
      </div>}
      {tab === 'messages' && <div className="panel"><table className="t"><thead><tr><th>Incident</th><th>Message</th><th>Status</th><th>Approver</th><th>Updated</th></tr></thead><tbody>
        {Object.values(S.incidents).flatMap(i => i.messages.map(m => ({ i, m }))).map(({ i, m }) => <tr key={m.id} className="click" onClick={() => openIncident(i.id)}><td className="num">{i.id}</td><td className="small">{m.text}</td><td><span className={`chip ${m.status === 'published' ? 'accent' : 'outline'}`}>{m.status}</span></td><td className="small">{m.approver ?? '—'}</td><td><Age ms={S.now - m.updatedAt} /></td></tr>)}
      </tbody></table>{Object.values(S.incidents).every(i => !i.messages.length) && <p className="muted" style={{ padding: 14 }}>No public messages yet. Drafts come from playbooks or are written in an incident.</p>}</div>}
      {tab === 'seats' && <div className="panel"><table className="t"><thead><tr><th>Seat</th><th>Role</th><th>Can do</th></tr></thead><tbody>
        <tr><td>Operator A · Desk 2</td><td>Operator</td><td className="small">Verify, assess, assign, apply playbooks, request field status, close</td></tr>
        <tr><td>Supervisor · Shift B</td><td>Shift supervisor</td><td className="small">All operator actions, approve diversions and public messages, audit view, thresholds, handover</td></tr>
        {(['LASEMA', 'LASAMBUS', 'FRSC', 'POLICE'] as AgencyId[]).map(a => <tr key={a}><td>{AGENCIES[a].short} liaison <button className="btn sm ghost" onClick={() => E.setLiaisonAgency(a)}>Use this seat</button></td><td>Agency liaison</td><td className="small">See the shared picture, add notes, dispatch own-agency units <Assumed what="multi-agency permissions" /></td></tr>)}
      </tbody></table></div>}
    </div>
  )
}

// ================= Analytics (thin) =================
export function AnalyticsModule() {
  const S = useSim()
  const live = Object.values(S.incidents).filter(i => i.state === 'Closed').map(i => ({ id: i.id, segId: i.segId, ...metricsOf(i) }))
  const all = [...S.history.map(h => ({ verify: h.verifySec, assign: h.assignSec, arrive: h.arriveSec, clear: h.clearSec })), ...live]
  const stat = (k: 'verify' | 'assign' | 'arrive' | 'clear') => {
    const v = all.map(x => x[k]).filter((x): x is number => x != null).sort((a, b) => a - b)
    return { med: v[Math.floor(v.length / 2)], p90: v[Math.floor(v.length * 0.9)], n: v.length, v }
  }
  const hot = useMemo(() => { const m: Record<string, number> = {}; for (const h of S.history) m[h.segId] = (m[h.segId] ?? 0) + 1; return m }, [S.history])
  const top = Object.entries(hot).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const metrics = [['Time to verify', 'verify'], ['Time to acknowledge', 'assign'], ['Time to arrive', 'arrive'], ['Time to clear', 'clear']] as const
  return (
    <div className="page">
      <div className="page-head"><div><h1>Analytics</h1><p>Last 14 days</p></div></div>
      <div className="strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {metrics.map(([label, k]) => { const s = stat(k); const max = s.v[s.v.length - 1] || 1; return (
          <div key={k} className="panel stat"><div className="k">{label}</div><div className="v">{fmtDur(s.med)}</div><div className="s">median · slowest 10% {fmtDur(s.p90)}</div>
            <svg width="100%" height="28" viewBox="0 0 200 28" preserveAspectRatio="none" aria-hidden style={{ marginTop: 6 }}>{s.v.map((x, i) => <line key={i} x1={x / max * 196 + 2} x2={x / max * 196 + 2} y1={4} y2={24} stroke="var(--text-3)" strokeOpacity="0.5" />)}<line x1={s.med / max * 196 + 2} x2={s.med / max * 196 + 2} y1={0} y2={28} stroke="var(--accent)" strokeWidth="2" /></svg>
          </div>) })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12 }}>
        <div className="panel" style={{ position: 'relative', height: 520, overflow: 'hidden' }}><MapCanvas hotspots={hot} /><div className="map-foot"><span>Crashes per road segment</span></div></div>
        <div className="panel"><div className="panel-h"><h2>Top segments</h2></div><table className="t"><tbody>{top.map(([id, n]) => <tr key={id}><td>{segById[id].name}<div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${n / top[0][1] * 100}%`, background: 'var(--act)' }} /></div></td><td className="num" style={{ width: 40 }}>{n}</td></tr>)}</tbody></table>
</div>
      </div>
    </div>
  )
}

export { go }
