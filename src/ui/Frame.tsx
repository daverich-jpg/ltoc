import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as E from '../sim/engine'
import { isTerminal, tierOf, TIER_LABEL, nextAction } from '../sim/derive'
import { SEGMENTS, segById } from '../sim/geo'
import { AGENCIES } from '../sim/seed'
import type { AgencyId, Incident, Role, Tier } from '../sim/types'
import { Age, Icon, Kbd, StateChip, TierGlyph, fmtAge, fmtTime , Spinner } from './bits'
import { getUI, go, openIncident, setUI, useSim, useUI, type Module } from './store'
import { toggleTheme, useTheme, currentTheme } from './theme'
import { Sun as PhSun, Moon as PhMoon } from './icons'

export function TopBar() {
  const S = useSim()
  const U = useUI()
  const feedAge = S.now - S.feedAt
  const camsOk = S.cameras.filter(c => c.status === 'ok').length
  return (
    <header className="topbar">
      <div className="brand">LTOC <small>Lagos Traffic Ops</small></div>
      <div className="tb-group">
        <span className="clock num" aria-label="Simulated time, West Africa Time">{fmtTime(S.now)}</span>
      </div>
      <div className="tb-sep" />
      <span className="sim-badge" title="All incidents, traffic readings, units and timings are simulated. Lagos geography is real.">SIMULATION</span>
      <div className="tb-sep" />
      <DataHealth />
      <div className="spacer" />
      <SearchField />
      <div className="spacer" />
      <ThemeToggle />
      <SeatMenu />
      <div style={{ position: 'relative' }}>
        <button className="btn sm" aria-expanded={U.scenarioOpen} onClick={() => setUI({ scenarioOpen: !U.scenarioOpen })}>
          {S.running ? <Icon.play /> : <Icon.pause />} Scenario <span className="num muted">{S.speed}×</span>
        </button>
        {U.scenarioOpen && <ScenarioControl />}
      </div>
    </header>
  )
}

/** One quiet line when everything is fine; only problems get words. */
function DataHealth() {
  const S = useSim()
  const feedAge = S.now - S.feedAt
  const camsOff = S.cameras.filter(c => c.status !== 'ok').length
  const issues = [
    feedAge > 180000 && `Traffic feed ${fmtAge(feedAge)} old`,
    S.degraded.link && `Server link lost ${fmtAge(S.now - (S.linkLostAt ?? S.now))}`,
  ].filter(Boolean) as string[]
  const detail = `Traffic feed ${fmtAge(feedAge)} old · ${S.cameras.length - camsOff}/${S.cameras.length} cameras · server link ${S.degraded.link ? 'lost' : 'ok'}`
  return (
    <div className="health" role="status" aria-label="Data health" title={detail}>
      {issues.length ? issues.map(t => <span key={t} className="stale"><span className="dot" style={{ background: 'var(--act)' }} />{t}</span>)
        : <span><span className="dot" style={{ background: 'var(--ok)' }} />Data live</span>}
    </div>
  )
}

const SEATS: { role: Role; name: string; can: string; agency?: AgencyId }[] = [
  { role: 'operator', name: 'Operator', can: 'Verify, assess, dispatch, close' },
  { role: 'supervisor', name: 'Supervisor', can: 'Also approves diversions and public messages' },
  { role: 'liaison', name: 'LASEMA liaison', can: 'Notes and LASEMA units only', agency: 'LASEMA' },
  { role: 'liaison', name: 'LASAMBUS liaison', can: 'Notes and ambulance units only', agency: 'LASAMBUS' },
]
/** Whose desk this is. A seat changes permissions, not pages, so it lives in a menu rather than looking like navigation. */
/** Looks and behaves like a search box: click it, or just start typing into it. Opens the palette with what was typed. */
function SearchField() {
  const open = (q = '') => setUI({ palette: true, paletteQuery: q })
  return (
    <button className="search-field" onClick={() => open()} aria-label="Search incidents, units, roads and actions (⌘K)"
      onKeyDown={e => { if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); open(e.key) } }}>
      <Icon.search />
      <span className="ph">Search incidents, units, roads</span>
      <kbd>⌘K</kbd>
    </button>
  )
}

const Sun = () => <PhSun size={16} weight="bold" aria-hidden />
const Moon = () => <PhMoon size={16} weight="bold" aria-hidden />
/** Shows the theme you'd switch TO. Icons cross-fade with scale and blur rather than swapping. */
function ThemeToggle() {
  const theme = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  const v = { initial: { opacity: 0, scale: 0.25, filter: 'blur(4px)' }, animate: { opacity: 1, scale: 1, filter: 'blur(0px)' }, exit: { opacity: 0, scale: 0.25, filter: 'blur(4px)' } }
  return (
    <button className="theme-btn" onClick={toggleTheme} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <AnimatePresence initial={false}>
        <motion.span key={theme} {...v} transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>{theme === 'dark' ? <Sun /> : <Moon />}</motion.span>
      </AnimatePresence>
    </button>
  )
}

function SeatMenu() {
  const S = useSim()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  const cur = SEATS.find(x => x.role === S.role && (x.role !== 'liaison' || x.agency === S.liaisonAgency)) ?? SEATS[0]
  const pick = (x: typeof SEATS[number]) => { if (x.agency) E.setLiaisonAgency(x.agency); else E.setRole(x.role); setOpen(false) }
  const initials = cur.role === 'liaison' ? cur.agency!.slice(0, 2) : cur.name[0]
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="seat-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`avatar r-${cur.role}`} aria-hidden>{initials}</span>
        <span>{cur.name}</span>
        <span className={`chev ${open ? 'open' : ''}`} style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)' }}><Icon.chev /></span>
      </button>
      <AnimatePresence>
        {open && <motion.div className="menu" role="menu" aria-label="Switch seat"
          initial={{ opacity: 0, transform: 'scale(0.97) translateY(-2px)' }} animate={{ opacity: 1, transform: 'scale(1) translateY(0px)' }}
          exit={{ opacity: 0, transform: 'scale(0.97) translateY(-2px)', transition: { duration: 0.12, ease: [0.7, 0, 0.84, 0] } }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}>
          <div className="menu-label">Seat</div>
          {SEATS.map(x => {
            const on = x === cur
            return <button key={x.name} role="menuitemradio" aria-checked={on} className="menu-item" onClick={() => pick(x)}>
              <span className={`avatar r-${x.role}`} aria-hidden>{x.role === 'liaison' ? x.agency!.slice(0, 2) : x.name[0]}</span>
              <span style={{ flex: 1 }}><span style={{ display: 'block', fontWeight: 500 }}>{x.name}</span><span className="small muted">{x.can}</span></span>
              {on && <span style={{ color: 'var(--accent)' }}><Icon.check /></span>}
            </button>
          })}
        </motion.div>}
      </AnimatePresence>
    </div>
  )
}

function ScenarioControl() {
  const S = useSim()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest('[aria-expanded]')) setUI({ scenarioOpen: false }) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <motion.div ref={ref} className="pop" style={{ right: 0 }} initial={{ opacity: 0, transform: 'scale(0.97)' }} animate={{ opacity: 1, transform: 'scale(1)' }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
      <p className="small muted" style={{ marginBottom: 8 }}>Prototype only. Not part of the operator product.</p>
      <h3>Scenarios</h3>
      <div className="row">
        {([['S1', 'Third Mainland crash'], ['S2', 'Tanker, Eko approach'], ['S3', 'Duplicates + false alarm']] as const).map(([id, l]) => (
          <button key={id} className="btn sm" disabled={S.scenarios.includes(id)} onClick={() => E.startScenario(id)}>{id} · {l}</button>
        ))}
      </div>
      <h3>Clock</h3>
      <div className="row">
        <button className="btn sm" onClick={() => E.setRunning(!S.running)}>{S.running ? <><Icon.pause /> Pause</> : <><Icon.play /> Resume</>}</button>
        <div className="seg">{[1, 4, 16].map(x => <button key={x} aria-pressed={S.speed === x} onClick={() => E.setSpeed(x)}>{x}×</button>)}</div>
        <button className="btn sm ghost" onClick={() => { E.reset(); setUI({ tabs: [], active: undefined }) }}><Icon.reset /> Reset</button>
      </div>
      <h3>Degraded mode</h3>
      <label className="row small" style={{ cursor: 'pointer' }}><input type="checkbox" checked={S.degraded.feed} onChange={e => E.setDegraded('feed', e.target.checked)} /> Drop the traffic feed (readings go stale)</label>
      <label className="row small" style={{ cursor: 'pointer', marginTop: 4 }}><input type="checkbox" checked={S.degraded.link} onChange={e => E.setDegraded('link', e.target.checked)} /> Lose the server link (commands fail, state holds)</label>
      <h3>Autopilot</h3>
      <label className="row small" style={{ cursor: 'pointer' }}><input type="checkbox" checked={S.autopilot} onChange={e => E.setAutopilot(e.target.checked)} /> Play the operator for S1</label>
      <h3>Supervisor thresholds</h3>
      {([['unclaimedSec', 'Unclaimed critical report → Act now after', [30, 60, 120]], ['verifySec', 'Verification open → Act now after', [180, 300, 600]], ['ackSec', 'Acknowledgement overdue after', [45, 60, 90]]] as const).map(([k, label, opts]) => (
        <div key={k} className="row small" style={{ justifyContent: 'space-between', marginTop: 4 }}>{label}
          <div className="seg">{opts.map(x => <button key={x} aria-pressed={S.thresholds[k] === x} onClick={() => E.setThreshold(k, x)}>{x < 120 || k === 'unclaimedSec' ? `${x} s` : `${x / 60} m`}</button>)}</div>
        </div>))}
    </motion.div>
  )
}

const NAV: { id: Module; label: string; icon: () => React.JSX.Element; key: string }[] = [
  { id: 'overview', label: 'Overview', icon: Icon.overview, key: '1' },
  { id: 'map', label: 'Live map', icon: Icon.map, key: '2' },
  { id: 'incidents', label: 'Incidents', icon: Icon.incidents, key: '3' },
  { id: 'response', label: 'Response', icon: Icon.response, key: '4' },
  { id: 'analytics', label: 'Analytics', icon: Icon.analytics, key: '5' },
]
export function Nav() {
  const U = useUI()
  const S = useSim()
  const cur = U.active ? undefined : U.module
  return (
    <nav className="nav" aria-label="Modules">
      {NAV.map(n => <button key={n.id} aria-current={cur === n.id ? 'page' : undefined} onClick={() => go(n.id)} title={`${n.label} (${n.key})`}><n.icon />{n.label}</button>)}
      <div className="nav-label">Prototype</div>
      <button aria-current={cur === 'flows' ? 'page' : undefined} onClick={() => go('flows')} title="Flows & states (6)"><Icon.flows />Flows & states</button>
    </nav>
  )
}

export function Rail() {
  const S = useSim()
  const U = useUI()
  const groups = useMemo(() => {
    const g: Record<Tier, { inc: Incident; reasons: string[] }[]> = { act: [], watch: [], ambient: [], none: [] }
    for (const inc of Object.values(S.incidents)) {
      const t = tierOf(inc, S)
      if (t.tier === 'none') { if (inc.closedAt && S.now - inc.closedAt < 90000) g.none.push({ inc, reasons: [] }); continue }
      g[t.tier].push({ inc, reasons: t.reasons })
    }
    for (const k of Object.keys(g) as Tier[]) g[k].sort((a, b) => b.inc.createdAt - a.inc.createdAt)
    return g
  }, [S])

  // one short pulse when an incident enters Act now
  const prevAct = useRef(new Set<string>())
  useEffect(() => {
    const now = new Set(groups.act.map(x => x.inc.id))
    const fresh = [...now].filter(id => !prevAct.current.has(id))
    if (fresh.length) setUI(u => ({ pulse: { ...u.pulse, ...Object.fromEntries(fresh.map(id => [id, Date.now()])) } }))
    prevAct.current = now
  }, [groups.act])

  return (
    <aside className="rail" aria-label="Incident rail">
      <div className="rail-head"><span>Active incidents</span><span className="num">{groups.act.length + groups.watch.length + groups.ambient.length}</span></div>
      {(['act', 'watch', 'ambient'] as Tier[]).map(t => (
        <section key={t} aria-label={TIER_LABEL[t]}>
          <div className="tier-head"><TierGlyph tier={t} />{TIER_LABEL[t]}<span className="count">{groups[t].length}</span></div>
          {groups[t].length === 0 && t === 'act' && <div className="rail-empty">Nothing needs action now.</div>}
          {groups[t].map(({ inc, reasons }) => <RailCard key={inc.id} inc={inc} tier={t} reasons={reasons} active={U.active === inc.id} pulse={!!U.pulse[inc.id] && Date.now() - U.pulse[inc.id] < 900} />)}
        </section>
      ))}
      {groups.none.length > 0 && <section aria-label="Recently resolved">
        <div className="tier-head"><TierGlyph tier="none" />Recently resolved<span className="count">{groups.none.length}</span></div>
        {groups.none.map(({ inc }) => <RailCard key={inc.id} inc={inc} tier="none" reasons={[inc.state === 'Merged' ? `Merged into ${inc.mergedInto}` : inc.state === 'Dismissed' ? 'Dismissed' : 'Closed']} active={U.active === inc.id} pulse={false} />)}
      </section>}
    </aside>
  )
}

function RailCard({ inc, tier, reasons, active, pulse }: { inc: Incident; tier: Tier; reasons: string[]; active: boolean; pulse: boolean }) {
  const S = useSim()
  const pend = S.pending.find(p => p.incidentId === inc.id)
  const prefetch = () => { if (inc.cameraId && !getUI().cameraCache[inc.cameraId]) setTimeout(() => setUI(u => ({ cameraCache: { ...u.cameraCache, [inc.cameraId!]: E.getState().now } })), 420) }
  return (
    <button className={`card t-${tier} ${pulse ? 'pulse' : ''}`} aria-current={active} onClick={() => openIncident(inc.id)} onMouseEnter={prefetch} onFocus={prefetch} style={{ opacity: tier === 'none' ? 0.6 : 1 }}>
      <div className="row1">
        <motion.span layoutId={`id-${inc.id}`} className="num" transition={{ type: 'spring', damping: 25, stiffness: 300 }}>{inc.id}</motion.span>
        <StateChip state={inc.state} />
        <span className="spacer" />
        <Age ms={S.now - inc.createdAt} />
      </div>
      <motion.div layoutId={`title-${inc.id}`} className="title" transition={{ type: 'spring', damping: 25, stiffness: 300 }}>{inc.title}</motion.div>
      <div className="why">
        {pend ? (pend.status === 'failed' ? <><Icon.alert /> <span className="stale">{pend.label} failed</span></> : <><Spinner style={{ color: 'var(--accent)', marginTop: 3 }} /> {pend.label}…</>)
          : <span>{tier === 'act' || reasons[0]?.includes('Act now in') ? reasons[0] : !isTerminal(inc) ? nextAction(inc, S) : reasons[0]}</span>}
      </div>
    </button>
  )
}

// ---------- command palette (no animation: used many times a day) ----------
type Item = { id: string; label: string; type: string; run: () => void; hint?: string }
export function Palette() {
  const S = useSim()
  const [q, setQ] = useState(() => getUI().paletteQuery ?? '')
  const [sel, setSel] = useState(0)
  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    for (const i of Object.values(S.incidents)) out.push({ id: i.id, label: `${i.id} · ${i.title}`, type: 'Incident', hint: i.state, run: () => openIncident(i.id) })
    for (const u of Object.values(S.units)) out.push({ id: u.id, label: `${u.callsign} · ${u.agency} ${u.type}`, type: u.type === 'recovery' ? 'Recovery' : 'Unit', hint: u.state, run: () => { setUI({ module: 'response', active: undefined }) } })
    for (const sg of SEGMENTS) out.push({ id: sg.id, label: sg.name, type: 'Road', run: () => { setUI({ module: 'map', active: undefined, inspectSeg: sg.id }) } })
    for (const a of Object.keys(AGENCIES) as AgencyId[]) out.push({ id: a, label: AGENCIES[a].name, type: 'Agency', run: () => setUI({ module: 'response', active: undefined }) })
    for (const n of NAV) out.push({ id: 'go-' + n.id, label: `Go to ${n.label}`, type: 'Action', run: () => go(n.id) })
    out.push({ id: 'go-flows', label: 'Go to Flows & states', type: 'Action', run: () => go('flows') })
    for (const sc of ['S1', 'S2', 'S3'] as const) out.push({ id: 'sc' + sc, label: `Start scenario ${sc}`, type: 'Action', run: () => E.startScenario(sc) })
    out.push({ id: 'theme', label: `Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} mode`, type: 'Action', run: toggleTheme })
    out.push({ id: 'role-s', label: 'Switch to supervisor seat', type: 'Action', run: () => E.setRole('supervisor') })
    out.push({ id: 'role-o', label: 'Switch to operator seat', type: 'Action', run: () => E.setRole('operator') })
    return out
  }, [S])
  const ql = q.toLowerCase()
  const res = (ql ? items.filter(i => i.label.toLowerCase().includes(ql) || i.id.toLowerCase().includes(ql)) : items.filter(i => i.type === 'Incident' && !isTerminal(S.incidents[i.id])).concat(items.filter(i => i.type === 'Action'))).slice(0, 40)
  const close = () => setUI({ palette: false, paletteQuery: '' })
  return (
    <div className="dialog-back" onMouseDown={close}>
      <div className="dialog palette" role="dialog" aria-label="Command palette" onMouseDown={e => e.stopPropagation()}>
        <input autoFocus placeholder="Incident, unit, call sign, road, agency or action" value={q} onChange={e => { setQ(e.target.value); setSel(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(res.length - 1, s + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
            if (e.key === 'Enter' && res[sel]) { res[sel].run(); close() }
            if (e.key === 'Escape') close()
          }} role="combobox" aria-expanded aria-controls="pal-list" />
        <ul id="pal-list" role="listbox">
          {res.map((r, i) => <li key={r.type + r.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => { r.run(); close() }}>
            <span>{r.label}</span>{r.hint && <span className="muted small">{r.hint}</span>}<span className="type">{r.type}</span>
          </li>)}
          {res.length === 0 && <li className="muted">No match. Try a call sign like LT-P21 or a road like Eko.</li>}
        </ul>
      </div>
    </div>
  )
}

export function Announcer() {
  const S = useSim()
  const [shown, setShown] = useState<typeof S.announcements>([])
  const seen = useRef(new Set<string>())
  useEffect(() => {
    const fresh = S.announcements.filter(a => !seen.current.has(a.id))
    if (!fresh.length) return
    fresh.forEach(a => seen.current.add(a.id))
    setShown(s => [...s, ...fresh].slice(-4))
    const ids = fresh.map(f => f.id)
    setTimeout(() => setShown(s => s.filter(x => !ids.includes(x.id))), 5000)
  }, [S.announcements])
  return (
    <>
      <div className="sr-only" aria-live="polite">{S.announcements.at(-1)?.text}</div>
      <div className="toasts">
        {shown.map(a => <motion.div key={a.id} className={`toast ${a.tone}`} initial={{ opacity: 0, transform: 'translateY(8px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
          {a.tone === 'error' ? <Icon.alert /> : a.tone === 'warn' ? <TierGlyph tier="act" /> : <span className="dot" style={{ background: 'var(--accent)' }} />}
          <span>{a.text}</span><span className="num muted small" style={{ marginLeft: 'auto' }}>{fmtTime(a.at)}</span>
        </motion.div>)}
      </div>
    </>
  )
}

export function useGlobalKeys() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setUI(u => ({ palette: !u.palette })); return }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || getUI().palette) return
      const m = ({ '1': 'overview', '2': 'map', '3': 'incidents', '4': 'response', '5': 'analytics', '6': 'flows' } as Record<string, Module>)[e.key]
      if (m) { go(m); return }
      if (e.key === 'j' || e.key === 'k') {
        const S = E.getState()
        const list = Object.values(S.incidents).filter(i => tierOf(i, S).tier !== 'none').sort((a, b) => ({ act: 0, watch: 1, ambient: 2, none: 3 }[tierOf(a, S).tier] - { act: 0, watch: 1, ambient: 2, none: 3 }[tierOf(b, S).tier]) || b.createdAt - a.createdAt)
        const idx = list.findIndex(i => i.id === getUI().active)
        const next = list[Math.max(0, Math.min(list.length - 1, idx + (e.key === 'j' ? 1 : -1)))]
        if (next) openIncident(next.id)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}

export const segName = (id: string) => segById[id]?.name ?? id
