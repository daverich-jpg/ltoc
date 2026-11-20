import * as E from '../sim/engine'
import { isTerminal } from '../sim/derive'
import type { IncidentState } from '../sim/types'
import { Sim } from './bits'
import { openIncident, setUI, useSim } from './store'

function Box({ x, y, w = 104, label, sub, cur, tone }: { x: number; y: number; w?: number; label: string; sub?: string; cur?: boolean; tone?: 'end' | 'alt' }) {
  return <g transform={`translate(${x} ${y})`}>
    <rect width={w} height={sub ? 44 : 32} rx={6} fill={cur ? 'var(--accent-bg)' : 'var(--surface-2)'} stroke={cur ? 'var(--accent)' : tone === 'alt' ? 'var(--line)' : 'var(--line)'} strokeDasharray={tone === 'alt' ? '4 3' : undefined} strokeWidth={cur ? 1.5 : 1} />
    <text x={w / 2} y={sub ? 18 : 20} textAnchor="middle" fill={cur ? 'var(--accent)' : 'var(--text)'} fontSize={12} fontWeight={500}>{label}</text>
    {sub && <text x={w / 2} y={34} textAnchor="middle" fill="var(--text-3)" fontSize={10}>{sub}</text>}
  </g>
}
const Arrow = ({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) => <g><path d={d} fill="none" stroke="var(--text-3)" strokeWidth={1.2} markerEnd="url(#fa)" />{label && <text x={lx} y={ly} fill="var(--text-3)" fontSize={10} textAnchor="middle">{label}</text>}</g>

export function FlowsModule() {
  const S = useSim()
  const live = Object.values(S.incidents).find(i => i.scenario === 'S1')
  const cur = live?.state
  const states: [IncidentState, string][] = [['Reported', 'source + time'], ['Verifying', 'operator claims'], ['Confirmed', 'verification event'], ['Responding', 'dispatch sent'], ['On scene', 'unit confirms'], ['Clearing', 'radio confirm'], ['Road clear', 'radio confirm'], ['Closed', 'disposition']]
  const run = (st: E.Stage) => {
    const id = E.fastForwardTo(st)
    setUI({ module: 'map', tabs: [], active: undefined, expanded: {} })
    if (id) setTimeout(() => openIncident(id), 0)
  }
  return (
    <div className="page flow">
      <div className="page-head"><div><h1>Flows and states</h1><p>Prototype view for the case study: state machines, the five emphasis states of the incident workspace, and the Third Mainland walkthrough. Every stage below is reached by running the simulation, not mocked.</p></div></div>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-h"><h2>Incident workspace: five emphasis states</h2><span className="small muted">Resets the session, plays S1 under autopilot to the stage, then hands control back to you.</span></div>
        <div className="panel-b">
          <div className="gal">
            {E.STAGES.map((st, i) => <button key={st.id} onClick={() => run(st.id)}>
              <div className="num small muted">{String(i + 1).padStart(2, '0')} · {st.state}</div>
              <div style={{ fontWeight: 600, margin: '4px 0 8px' }}>{st.label}</div>
              <EmphasisThumb lead={i} />
              <div className="small" style={{ color: 'var(--accent)', marginTop: 8 }}>Open S1 at this stage →</div>
            </button>)}
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-h"><h2>Incident lifecycle</h2>{cur && <span className="small muted">S1 live: <b style={{ color: 'var(--accent)' }}>{cur}</b></span>}</div>
        <div className="panel-b" style={{ overflowX: 'auto' }}>
          <svg width="1000" height="200" viewBox="0 0 1000 200" role="img" aria-label="Incident state diagram">
            <defs><marker id="fa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 7 4 1 7Z" fill="var(--text-3)" /></marker></defs>
            {states.map(([s, sub], i) => <Box key={s} x={4 + i * 124} y={20} label={s} sub={sub} cur={cur === s} />)}
            {states.slice(0, -1).map((_, i) => <Arrow key={i} d={`M${108 + i * 124} 42 L${126 + i * 124} 42`} />)}
            <Box x={128} y={130} label="Dismissed" sub="disproved + reason" cur={cur === 'Dismissed'} tone="alt" />
            <Box x={252} y={130} label="Merged" sub="sources kept" cur={cur === 'Merged'} tone="alt" />
            <Arrow d="M180 64 L180 128" /><Arrow d="M200 64 Q 260 90 300 128" />
            <text x={420} y={140} fill="var(--text-3)" fontSize={11}>Road clear ≠ Closed: traffic flows while recovery paperwork continues.</text>
            <text x={420} y={158} fill="var(--text-3)" fontSize={11}>Every arrow writes a timeline event with actor, time and route.</text>
            <text x={420} y={176} fill="var(--text-3)" fontSize={11}>Confirmed requires a verifying source or an override with reason.</text>
          </svg>
        </div>
      </section>

      <div className="grid2" style={{ marginBottom: 12 }}>
        <section className="panel"><div className="panel-h"><h2>Unit states</h2><span className="small muted">each confirmed by radio, terminal or phone</span></div><div className="panel-b" style={{ overflowX: 'auto' }}>
          <svg width="560" height="150" viewBox="0 0 560 150" role="img" aria-label="Unit state diagram">
            {['Available', 'Dispatched', 'Acknowledged', 'En route', 'On scene'].map((s, i) => <Box key={s} x={2 + i * 112} y={14} w={96} label={s} />)}
            {[0, 1, 2, 3].map(i => <Arrow key={i} d={`M${98 + i * 112} 30 L${112 + i * 112} 30`} />)}
            <Box x={450} y={96} w={96} label="Returning" /><Arrow d="M498 46 L498 94" />
            <Arrow d="M450 112 Q 60 140 50 48" label="radio: back at base" lx={240} ly={140} />
            <Box x={2} y={96} w={96} label="Unavailable" tone="alt" />
            <text x={112} y={70} fill="var(--act-ink)" fontSize={10.5}>No ack within threshold → Act now</text>
          </svg>
          <p className="small muted">The interface never shows a later state than the last confirmation. Dispatched means sent and not yet acknowledged; it is never shown as en route.</p>
        </div></section>
        <section className="panel"><div className="panel-h"><h2>Verification</h2><span className="small muted">confidence = number and recency of sources</span></div><div className="panel-b">
          <svg width="460" height="150" viewBox="0 0 460 150" role="img" aria-label="Verification state diagram">
            <Box x={2} y={50} label="Unverified" /><Box x={130} y={50} label="Verifying" />
            <Box x={290} y={10} w={160} label="Verified" sub="camera · officer · 2nd source" /><Box x={290} y={92} w={160} label="Disproved" sub="reason recorded" tone="alt" />
            <Arrow d="M106 66 L128 66" /><Arrow d="M234 60 L288 36" /><Arrow d="M234 74 L288 112" />
          </svg>
          <p className="small muted">No invented percentages. The strip shows each source with its type, channel and age.</p>
        </div></section>
      </div>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-h"><h2>Walkthrough: crash on Third Mainland Bridge</h2><Sim /></div>
        <table className="t"><thead><tr><th>Step</th><th>Where</th><th>State change and how it is confirmed</th><th></th></tr></thead><tbody>
          {([
            ['1 Alert', 'Incident rail, Overview attention queue', 'Call on 767 creates the incident: Reported, Watch, with a visible countdown. If nobody claims it within 60 s it becomes Act now. Driver report 40 s later clusters into the same incident.', 'verify'],
            ['2 Open', 'Workspace over the Live map', 'Map anchors on the bridge; unrelated layers dim and desaturate. Opening claims verification: Verifying.', 'verify'],
            ['3 Verify', 'Verification strip', 'Camera TMB-C03 frame (with its true age) or a second source. Confirm, dismiss or merge in one action. The verification event names the basis.', 'assess'],
            ['4 Assess', 'Assessment panel', 'Severity suggestion with visible factors; operator confirms or overrides (logged). Lanes blocked and hazards recorded.', 'assess'],
            ['5 Assign', 'Response panel', 'Nearest available units with simulated ETA. Units show Dispatched until acknowledged. Playbook proposes diversion and draft message.', 'respond'],
            ['6 Monitor', 'Response panel, map, Overview', 'Confirmations arrive by channel. AMB-12 misses the 60 s acknowledgement threshold and the incident returns to Act now.', 'respond'],
            ['7 Resolve', 'Clearance, then Closure', 'Scene confirms Clearing, then Road clear by radio. Diversion lifted, message withdrawn, disposition recorded, Closed. Timeline feeds Analytics.', 'closed'],
          ] as const).map(([s, w, d, st]) => <tr key={s}><td className="num" style={{ width: 80 }}>{s}</td><td className="small" style={{ width: 200 }}>{w}</td><td className="small">{d}</td><td style={{ width: 110 }}><button className="btn sm" onClick={() => run(st)}>Run to here</button></td></tr>)}
        </tbody></table>
      </section>

      <div className="grid2">
        <section className="panel"><div className="panel-h"><h2>Illusion budget</h2></div><div className="panel-b small">
          <p style={{ marginBottom: 6 }}><b style={{ color: 'var(--ok-ink)' }}>Allowed for navigation</b></p>
          <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
            <li>Rail card id and title morph into the workspace header (spring, damping 25, stiffness 300). Skipped when opened from the keyboard.</li>
            <li>Focus mode: unrelated map layers dim and desaturate in 220 ms.</li>
            <li>Camera frame prefetch on rail hover or focus. Otherwise a matching skeleton resolves into the frame with its true age.</li>
          </ul>
          <p style={{ marginBottom: 6 }}><b style={{ color: 'var(--act-ink)' }}>Forbidden for the state of the world</b></p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>No optimistic updates. Every action is a command that shows “sent, waiting for confirmation” until the engine confirms it.</li>
            <li>No interpolated unit movement. Units sit at their last confirmed position with its age.</li>
            <li>On failure the state holds, an inline error explains, retry is one action. Try it: Scenario → Lose the server link.</li>
          </ul>
        </div></section>
        <section className="panel"><div className="panel-h"><h2>Data classes</h2></div><div className="panel-b small">
          <p><b>Verified</b>: road, bridge and interchange names, agency names. Shown with an as-of date (18 Nov 2026).</p>
          <p style={{ marginTop: 6 }}><Sim /> <b>Simulated</b>: incidents, traffic readings, units, timings, history. Hatched badge in the top bar, striped edge on panels that hold simulated values.</p>
          <p style={{ marginTop: 6 }}><span className="chip assumed">assumed</span> <b>Assumed</b>: map geometry, unit bases, camera locations, response-time and playbook content, liaison permissions. Dashed outline wherever they appear.</p>
          <p className="muted" style={{ marginTop: 10 }}>Open questions this prototype is built to test: pinned tabs (up to three) versus one workspace; rail position; liaison permissions; how to show unit position age without implying live tracking.</p>
        </div></section>
      </div>
      {live && isTerminal(live) && <p className="small muted" style={{ marginTop: 10 }}>S1 is resolved in this session. Use a stage card to replay.</p>}
    </div>
  )
}

/** Wireframe thumbnail: which panel leads in each state. */
function EmphasisThumb({ lead }: { lead: number }) {
  const rows = ['Verification', 'Assessment', 'Response', 'Clearance', 'Closure', 'Timeline']
  return <svg width="100%" viewBox="0 0 160 112" aria-hidden>
    <rect x={0} y={0} width={160} height={14} rx={3} fill="var(--surface-3)" />
    {rows.map((r, i) => {
      const isLead = i === lead
      const y = 18 + rows.slice(0, i).reduce((t, _, j) => t + (j === lead ? 34 : 13), 0)
      return <g key={r}><rect x={0} y={y} width={160} height={isLead ? 30 : 10} rx={3} fill={isLead ? 'var(--accent-bg)' : 'var(--surface-2)'} stroke={isLead ? 'var(--accent)' : 'none'} />
        <text x={5} y={y + 7.5} fontSize={6.5} fill={isLead ? 'var(--accent)' : 'var(--text-3)'}>{r}</text></g>
    })}
  </svg>
}
