// LTOC simulation engine.
// Rule (PRD §13, IA §6): the UI never shows a state the system has not confirmed.
// Every operator action is a *command*. It sits in `pending` until the (simulated) server
// or a field unit confirms it. On failure the state stays at its last confirmed value.
import type { AgencyId, Assignment, Camera, Channel, HistoryRecord, Incident, IncidentState, Message, Pending, Playbook, Role, ScenarioId, Severity, SourceReport, TimelineEvent, Unit, UnitState } from './types'
import { CAMERAS, PLAYBOOKS, genHistory, seedUnits } from './seed'
import { nodeById, route, segById } from './geo'
import { isOpen, isTerminal, lastConf, nearestNode, assignmentOverdue, escalation } from './derive'

export const START = Date.UTC(2026, 10, 18, 6, 42, 0) // 07:42 WAT

export interface State {
  now: number
  speed: number
  running: boolean
  incidents: Record<string, Incident>
  units: Record<string, Unit>
  cameras: Camera[]
  playbooks: Playbook[]
  pending: Pending[]
  role: Role
  liaisonAgency: AgencyId
  seat: string
  degraded: { feed: boolean; link: boolean }
  feedAt: number
  linkLostAt?: number
  scenarios: ScenarioId[]
  autopilot: boolean
  thresholds: { ackSec: number; unclaimedSec: number; verifySec: number }
  handoverNotes: string
  history: HistoryRecord[]
  announcements: { id: string; at: number; text: string; tone: 'info' | 'warn' | 'error' }[]
  nextId: number
}

let S: State
let version = 0
const listeners = new Set<() => void>()
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const getVersion = () => version
export const getState = () => S
function emit() { version++; S = { ...S }; listeners.forEach(l => l()) }

type Job = { at: number; run: () => void }
let queue: Job[] = []
const at = (t: number, run: () => void) => { queue.push({ at: t, run }) }
const after = (sec: number, run: () => void) => at(S.now + sec * 1000, run)
let FF = false // fast-forward: commands apply instantly
let uid = 0
const id = (p: string) => `${p}${++uid}`

function initial(): State {
  const units = Object.fromEntries(seedUnits().map(u => [u.id, { ...u, stateAt: START - 3600000, posAt: START - 900000 }]))
  return {
    now: START, speed: 4, running: true, incidents: {}, units, cameras: CAMERAS.map(c => ({ ...c })), playbooks: PLAYBOOKS,
    pending: [], role: 'operator', liaisonAgency: 'LASEMA', seat: 'Operator A · Desk 2', degraded: { feed: false, link: false }, feedAt: START,
    scenarios: [], autopilot: false, thresholds: { ackSec: 60, unclaimedSec: 60, verifySec: 300 }, handoverNotes: '', history: genHistory(START), announcements: [], nextId: 139,
  }
}

// ---------- helpers ----------
const actorName = () => S.role === 'supervisor' ? 'Supervisor (Shift B)' : S.role === 'liaison' ? `${S.liaisonAgency} liaison` : 'Operator A'
function log(inc: Incident, kind: TimelineEvent['kind'], text: string, actor = 'System', route: Channel = 'system') {
  inc.timeline.push({ id: id('ev'), at: S.now, actor, route, kind, text })
}
function setState(inc: Incident, st: IncidentState, why: string, actor = 'System', route: Channel = 'system') {
  if (inc.state === st) return
  inc.state = st; inc.stateAt = S.now
  if (st === 'Closed' || st === 'Dismissed' || st === 'Merged') inc.closedAt = S.now
  log(inc, 'state', `State → ${st}. ${why}`, actor, route)
}
function announce(text: string, tone: 'info' | 'warn' | 'error' = 'info') {
  S.announcements = [...S.announcements.slice(-5), { id: id('an'), at: S.now, text, tone }]
}
const newIncId = () => `INC-${(S.nextId++).toString().padStart(4, '0')}`

// ---------- commands ----------
const retryFns = new Map<string, () => void>()
function command(label: string, incidentId: string | undefined, apply: () => void, latencyMs = 450 + Math.random() * 500) {
  if (FF) { apply(); return }
  const p: Pending = { id: id('cmd'), label, incidentId, issuedAt: S.now, status: 'pending' }
  S.pending = [...S.pending, p]
  const run = () => {
    const cur = S.pending.find(x => x.id === p.id)
    if (!cur) return
    if (S.degraded.link) {
      S.pending = S.pending.map(x => x.id === p.id ? { ...x, status: 'failed', error: 'No confirmation from the LTOC server within 5 s. Nothing was changed.' } : x)
      const inc = incidentId ? S.incidents[incidentId] : undefined
      if (inc) log(inc, 'failure', `Command failed: ${label}. State kept at last confirmed value.`, actorName(), 'console')
      announce(`${label} failed. State unchanged.`, 'error')
    } else {
      S.pending = S.pending.filter(x => x.id !== p.id)
      retryFns.delete(p.id)
      apply()
    }
    emit()
  }
  retryFns.set(p.id, () => { S.pending = S.pending.map(x => x.id === p.id ? { ...x, status: 'pending', error: undefined, issuedAt: S.now } : x); emit(); setTimeout(run, S.degraded.link ? 5000 : latencyMs) })
  emit()
  setTimeout(run, S.degraded.link ? 5000 : latencyMs)
}
/** Tests only: apply commands without network latency. */
export function setInstantCommands(v: boolean) { FF = v }
export function retry(pid: string) { retryFns.get(pid)?.() }
export function discardFailed(pid: string) { S.pending = S.pending.filter(p => p.id !== pid); retryFns.delete(pid); emit() }
export const isPending = (incId: string, label?: string) => S.pending.some(p => p.incidentId === incId && p.status === 'pending' && (!label || p.label.startsWith(label)))

// ---------- intake ----------
interface NewIncidentSpec { type: Incident['type']; vehicle: string; title: string; dir: string; hazards?: Partial<Incident['hazards']>; lead?: AgencyId; scenario: Incident['scenario']; lanes?: number | null }
function ingest(r: Omit<SourceReport, 'id' | 'receivedAt'>, spec: NewIncidentSpec, opts: { noCluster?: boolean } = {}): Incident {
  const report: SourceReport = { ...r, id: id('src'), receivedAt: S.now }
  // One alert per incident: cluster reports on the same segment within 30 minutes.
  if (!opts.noCluster) {
    const match = Object.values(S.incidents).find(i => isOpen(i) && i.segId === r.segId && Math.abs(i.t - r.t) < 0.3 && S.now - i.createdAt < 1800000 && i.type === spec.type)
    if (match) {
      match.sources.push(report)
      log(match, 'source', `Source added: ${labelSource(report)}. Clustered (same segment, ${Math.round((S.now - match.createdAt) / 1000)} s after first report).`)
      announce(`${match.id}: new ${labelSource(report)} clustered`)
      return match
    }
  }
  const inc: Incident = {
    id: newIncId(), type: spec.type, vehicle: spec.vehicle, title: spec.title, segId: r.segId, t: r.t, dir: spec.dir,
    lanesBlocked: spec.lanes ?? null, hazards: { injuries: false, tanker: false, hazmat: false, secondary: false, ...spec.hazards },
    severity: null, state: 'Reported', verif: 'Unverified', leadAgency: spec.lead ?? 'LASTMA', involved: [], sources: [report], timeline: [],
    assignments: [], messages: [], createdAt: S.now, stateAt: S.now, scenario: spec.scenario,
    cameraId: S.cameras.find(c => c.segId === r.segId)?.id,
  }
  S.incidents = { ...S.incidents, [inc.id]: inc }
  log(inc, 'source', `Incident created from ${labelSource(report)}.`)
  log(inc, 'state', 'State → Reported. Unverified.')
  announce(`${inc.id} reported: ${inc.title}`, segById[inc.segId].critical ? 'warn' : 'info')
  return inc
}
export const SOURCE_LABEL: Record<SourceReport['type'], string> = { call: 'Call', officer: 'Officer report', camera: 'Camera', driver: 'Driver report', agency: 'Agency feed', probe: 'Probe data' }
/** 767/112 calls are answered by the State Emergency Command and Control Centre, not LTOC.
 *  The report LTOC sees is that call-taker's summary, so the label says where it came through. */
export const EMERGENCY_CENTRE = 'State Emergency Centre'
export function sourceLabel(r: Pick<SourceReport, 'type' | 'channel'>) {
  if (r.type === 'call') { const line = r.channel.replace(/ line$/, ''); return `${line} call · via ${EMERGENCY_CENTRE}` }
  return `${SOURCE_LABEL[r.type]} · ${r.channel}`
}
const labelSource = (r: SourceReport) => sourceLabel(r)

// ---------- operator actions ----------
export function startVerify(incId: string) {
  const inc = S.incidents[incId]
  if (!inc || inc.state !== 'Reported' || isPending(incId, 'Start verification')) return
  command('Start verification', incId, () => { inc.verif = 'Verifying'; setState(inc, 'Verifying', 'Workspace opened; verification claimed.', actorName(), 'console') })
}

export function independentSources(inc: Incident) { return new Set(inc.sources.map(s => s.type)).size }

export function confirmIncident(incId: string, basis: string, override?: string) {
  const inc = S.incidents[incId]
  if (!inc) return
  command('Confirm incident', incId, () => {
    inc.verif = 'Verified'; inc.verifiedBy = override ? `Operator override: ${override}` : basis
    log(inc, 'state', `Verification event: verified by ${inc.verifiedBy}.`, actorName(), 'console')
    setState(inc, 'Confirmed', `Verified by ${inc.verifiedBy}.`, actorName(), 'console')
  })
}
export function dismissIncident(incId: string, reason: string) {
  const inc = S.incidents[incId]
  command('Dismiss incident', incId, () => { inc.verif = 'Disproved'; setState(inc, 'Dismissed', `Disproved: ${reason}.`, actorName(), 'console') })
}
export function mergeIncident(incId: string, intoId: string) {
  const inc = S.incidents[incId], into = S.incidents[intoId]
  command(`Merge into ${intoId}`, incId, () => {
    into.sources.push(...inc.sources)
    log(into, 'source', `Merged ${inc.id}: ${inc.sources.length} source report(s) kept.`, actorName(), 'console')
    inc.mergedInto = intoId
    setState(inc, 'Merged', `Duplicate of ${intoId}. All sources moved.`, actorName(), 'console')
  })
}
export function setSeverity(incId: string, sev: Severity, suggested: Severity) {
  const inc = S.incidents[incId]
  command('Set severity', incId, () => {
    inc.severity = sev
    log(inc, 'assess', sev === suggested ? `Severity confirmed: ${sev} (matches suggestion).` : `Severity set to ${sev}. Override of suggested ${suggested}.`, actorName(), 'console')
  })
}
export function setLanes(incId: string, lanes: number) {
  const inc = S.incidents[incId]
  command('Record lanes blocked', incId, () => { inc.lanesBlocked = lanes; log(inc, 'assess', `Lanes blocked recorded: ${lanes} of ${segById[inc.segId].lanes}.`, actorName(), 'console') })
}
export function toggleHazard(incId: string, key: keyof Incident['hazards']) {
  const inc = S.incidents[incId]
  command('Update hazard flag', incId, () => { inc.hazards = { ...inc.hazards, [key]: !inc.hazards[key] }; log(inc, 'assess', `Hazard ${key}: ${inc.hazards[key] ? 'flagged' : 'cleared'}.`, actorName(), 'console') })
}
export function setLead(incId: string, agency: AgencyId) {
  const inc = S.incidents[incId]
  command('Set lead agency', incId, () => { inc.leadAgency = agency; log(inc, 'assign', `Lead agency: ${agency}.`, actorName(), 'console') })
}

export function etaSec(unit: Unit, inc: Incident) {
  const km = route(unit.posNode, nearestNode(inc.segId, inc.t)).km + 0.4
  return Math.round(km / 30 * 3600) // 30 km/h simulated average in peak traffic (assumed)
}

const ROLE_FOR: Record<Unit['type'], string> = { patrol: 'Traffic control', rescue: 'Rescue', ambulance: 'Casualty care', fire: 'Fire and hazmat', police: 'Security', recovery: 'Recovery' }
export function dispatchUnit(incId: string, unitId: string) {
  const inc = S.incidents[incId], unit = S.units[unitId]
  if (!inc || !unit || unit.state !== 'Available') return
  command(`Dispatch ${unitId}`, incId, () => {
    if (unit.state !== 'Available') return
    const a: Assignment = { id: id('as'), unitId, role: ROLE_FOR[unit.type], assignedAt: S.now, history: [{ state: 'Dispatched', channel: 'terminal', at: S.now }] }
    inc.assignments = [...inc.assignments, a]
    if (!inc.involved.includes(unit.agency) && unit.agency !== inc.leadAgency) inc.involved = [...inc.involved, unit.agency]
    S.units = { ...S.units, [unitId]: { ...unit, state: 'Dispatched', stateAt: S.now, stateChannel: 'terminal', incidentId: incId } }
    log(inc, 'assign', `Dispatch sent to ${unitId} (${unit.agency}, ${ROLE_FOR[unit.type]}). Awaiting acknowledgement.`, actorName(), 'terminal')
    if (inc.state === 'Confirmed') setState(inc, 'Responding', `First dispatch sent (${unitId}).`)
    scheduleUnit(inc.id, a.id)
  })
}

function confirmUnit(incId: string, asId: string, state: UnitState, channel: Channel, posNode?: string) {
  const inc = S.incidents[incId]
  const a = inc?.assignments.find(x => x.id === asId)
  if (!inc || !a || a.released) return
  a.history = [...a.history, { state, channel, at: S.now }]
  const u = S.units[a.unitId]
  S.units = { ...S.units, [u.id]: { ...u, state, stateAt: S.now, stateChannel: channel, ...(posNode ? { posNode, posAt: S.now } : {}) } }
  const verb = state === 'Acknowledged' ? 'acknowledged' : state === 'En route' ? 'en route' : state === 'On scene' ? 'on scene' : state.toLowerCase()
  log(inc, 'unit', `${u.id} ${verb}. Confirmed by ${channel}.`, u.id, channel)
  if (state === 'On scene' && inc.state === 'Responding') setState(inc, 'On scene', `First confirmed arrival: ${u.id} (${channel}).`)
}

function scheduleUnit(incId: string, asId: string) {
  const inc = S.incidents[incId]
  const a = inc.assignments.find(x => x.id === asId)!
  const u = S.units[a.unitId]
  const ack = u.ackDelay * (0.85 + Math.random() * 0.3)
  const travel = etaSec(u, inc)
  const r = route(u.posNode, nearestNode(inc.segId, inc.t))
  const mid = r.nodes[Math.floor(r.nodes.length / 2)] ?? u.posNode
  after(ack, () => confirmUnit(incId, asId, 'Acknowledged', u.ackChannel, u.posNode))
  after(ack + 10, () => confirmUnit(incId, asId, 'En route', 'terminal'))
  if (r.nodes.length > 2) after(ack + 10 + travel * 0.5, () => {
    const cur = S.incidents[incId]?.assignments.find(x => x.id === asId)
    if (!cur || cur.released) return
    const unit = S.units[u.id]
    S.units = { ...S.units, [u.id]: { ...unit, posNode: mid, posAt: S.now } }
    log(S.incidents[incId], 'unit', `${u.id} position report: near ${nodeById[mid].name}. Terminal GPS.`, u.id, 'terminal')
  })
  after(ack + 10 + travel, () => confirmUnit(incId, asId, 'On scene', u.type === 'patrol' ? 'radio' : 'terminal', nearestNode(inc.segId, inc.t)))
}

export function activatePlaybook(incId: string, pbId: string) {
  const inc = S.incidents[incId], pb = S.playbooks.find(p => p.id === pbId)!
  command(`Activate playbook ${pbId}`, incId, () => {
    inc.playbookId = pbId
    inc.diversion = { playbookId: pbId, label: pb.diversion.label, segs: pb.diversion.segs, closes: pb.diversion.closes, status: 'proposed', updatedAt: S.now }
    inc.messages = [...inc.messages, { id: id('msg'), text: pb.message, status: 'draft', channel: 'LTOC public traffic feed (simulated)', updatedAt: S.now }]
    log(inc, 'diversion', `Playbook ${pb.id} applied. Diversion proposed: ${pb.diversion.label}. Draft public message created.`, actorName(), 'console')
    for (const ag of pb.notify) {
      log(inc, 'notify', `Notification sent to ${ag} desk.`, actorName(), 'terminal')
      after(15 + Math.random() * 30, () => log(S.incidents[incId], 'notify', `${ag} desk acknowledged the notification.`, ag, 'terminal'))
      if (!inc.involved.includes(ag) && ag !== inc.leadAgency) inc.involved = [...inc.involved, ag]
    }
  })
}
export function editDiversion(incId: string, segs: string[]) {
  const inc = S.incidents[incId]
  command('Adapt diversion', incId, () => { if (inc.diversion) { inc.diversion = { ...inc.diversion, segs, status: 'proposed', updatedAt: S.now }; log(inc, 'diversion', `Diversion adapted: ${segs.length} segments.`, actorName(), 'console') } })
}
export function requestDiversionApproval(incId: string) {
  const inc = S.incidents[incId]
  command('Request diversion approval', incId, () => { inc.diversion = { ...inc.diversion!, status: 'awaiting approval', updatedAt: S.now }; log(inc, 'diversion', 'Diversion sent to supervisor for approval.', actorName(), 'console') })
}
export function approveDiversion(incId: string) {
  const inc = S.incidents[incId]
  command('Approve diversion', incId, () => {
    inc.diversion = { ...inc.diversion!, status: 'active', updatedAt: S.now }
    log(inc, 'diversion', `Diversion approved and active. Closed: ${inc.diversion.closes.map(s => segById[s].name).join(', ') || 'none'}.`, 'Supervisor (Shift B)', 'console')
  })
}
export function liftDiversion(incId: string) {
  const inc = S.incidents[incId]
  command('Lift diversion', incId, () => { inc.diversion = { ...inc.diversion!, status: 'lifted', updatedAt: S.now }; log(inc, 'diversion', 'Diversion lifted. Closures removed.', actorName(), 'console') })
}

export function draftMessage(incId: string, text: string) {
  const inc = S.incidents[incId]
  command('Save message draft', incId, () => {
    const cur = inc.messages.find(m => m.status === 'draft' || m.status === 'approved')
    if (cur) inc.messages = inc.messages.map(m => m.id === cur.id ? { ...m, text, status: 'draft', approver: undefined, updatedAt: S.now } : m)
    else inc.messages = [...inc.messages, { id: id('msg'), text, status: 'draft', channel: 'LTOC public traffic feed (simulated)', updatedAt: S.now }]
    log(inc, 'message', 'Public message draft saved. Needs supervisor approval.', actorName(), 'console')
  })
}
function setMsg(inc: Incident, mid: string, patch: Partial<Message>) { inc.messages = inc.messages.map(m => m.id === mid ? { ...m, ...patch, updatedAt: S.now } : m) }
export function approveMessage(incId: string, mid: string) {
  const inc = S.incidents[incId]
  command('Approve public message', incId, () => { setMsg(inc, mid, { status: 'approved', approver: 'Supervisor (Shift B)' }); log(inc, 'message', 'Public message approved.', 'Supervisor (Shift B)', 'console') })
}
export function publishMessage(incId: string, mid: string) {
  const inc = S.incidents[incId]
  command('Publish public message', incId, () => { setMsg(inc, mid, { status: 'published' }); log(inc, 'message', 'Public message published. Channel confirmed receipt.', actorName(), 'system') }, 1200)
}
export function withdrawMessage(incId: string, mid: string) {
  const inc = S.incidents[incId]
  command('Withdraw public message', incId, () => { setMsg(inc, mid, { status: 'withdrawn' }); log(inc, 'message', 'Public message withdrawn.', actorName(), 'system') })
}

export function requestFieldStatus(incId: string, want: 'Clearing' | 'Road clear') {
  const inc = S.incidents[incId]
  const onScene = inc.assignments.filter(a => !a.released && lastConf(a).state === 'On scene')
  const unit = onScene.find(a => S.units[a.unitId].type === 'patrol') ?? onScene[0]
  if (!unit) return
  command(`Request ${want.toLowerCase()} confirmation`, incId, () => {
    inc.pendingField = { want, unitId: unit.unitId, at: S.now }
    log(inc, 'system', `Asked ${unit.unitId} to confirm "${want}" by radio.`, actorName(), 'radio')
    const delay = want === 'Clearing' ? 20 : 30
    after(delay, () => {
      const cur = S.incidents[incId]
      if (!cur || cur.pendingField?.want !== want) return
      cur.pendingField = undefined
      if (want === 'Clearing') setState(cur, 'Clearing', `${unit.unitId} confirmed recovery under way (radio).`, unit.unitId, 'radio')
      else { setState(cur, 'Road clear', `${unit.unitId} confirmed all lanes open (radio).`, unit.unitId, 'radio'); cur.lanesBlocked = 0 }
      announce(`${incId}: ${want} confirmed by ${unit.unitId}`)
    })
  })
}

export const DISPOSITIONS = ['Vehicle taken to a police station', 'Vehicle taken to the LASTMA yard', 'Removed by owner', 'No vehicle to remove', 'Handed to FRSC for crash record']
export function closeIncident(incId: string, disposition: string, detail: string) {
  const inc = S.incidents[incId]
  if (!disposition) return
  command('Close incident', incId, () => {
    inc.disposition = detail ? `${disposition}: ${detail}` : disposition
    setState(inc, 'Closed', `Disposition: ${inc.disposition}.`, actorName(), 'console')
    for (const a of inc.assignments.filter(x => !x.released)) {
      a.released = true
      const u = S.units[a.unitId]
      S.units = { ...S.units, [u.id]: { ...u, state: 'Returning', stateAt: S.now, stateChannel: 'radio', incidentId: undefined } }
      after(90 + Math.random() * 120, () => { const uu = S.units[u.id]; if (uu.state === 'Returning') S.units = { ...S.units, [u.id]: { ...uu, state: 'Available', stateAt: S.now, stateChannel: 'radio', posNode: uu.base, posAt: S.now } } })
    }
  })
}
/** AI never changes state. When an operator accepts an AI suggestion, the timeline records both: who acted, and that AI proposed it. */
export function logAI(incId: string, text: string) {
  const inc = S.incidents[incId]
  if (!inc) return
  command('Log AI assist', incId, () => log(inc, 'assess', text, `${actorName()} · AI suggestion`, 'console'), 200)
}
export function addNote(incId: string, text: string) {
  const inc = S.incidents[incId]
  if (!text.trim()) return
  command('Add note', incId, () => log(inc, 'note', text.trim(), actorName(), 'console'), 250)
}

// ---------- session controls ----------
export function setRole(r: Role) { S.role = r; S.seat = r === 'supervisor' ? 'Supervisor · Shift B' : r === 'liaison' ? `${S.liaisonAgency} liaison seat` : 'Operator A · Desk 2'; emit() }
export function setLiaisonAgency(a: AgencyId) { S.liaisonAgency = a; setRole('liaison') }
export function setSpeed(x: number) { S.speed = x; emit() }
export function setRunning(r: boolean) { S.running = r; emit() }
export function setThreshold(key: keyof State['thresholds'], sec: number) { S.thresholds = { ...S.thresholds, [key]: sec }; emit() }
export function setHandoverNotes(t: string) { S.handoverNotes = t; emit() }
export function setDegraded(k: 'feed' | 'link', v: boolean) {
  S.degraded = { ...S.degraded, [k]: v }
  if (k === 'link') S.linkLostAt = v ? S.now : undefined
  announce(k === 'feed' ? (v ? 'Traffic feed lost. Readings will age from now.' : 'Traffic feed restored.') : (v ? 'Connection to LTOC server lost. Commands will not apply.' : 'Connection restored.'), v ? 'error' : 'info')
  emit()
}
export function setAutopilot(v: boolean) { S.autopilot = v; emit() }

// ---------- time ----------
export function tick(realMs: number) {
  if (!S.running) return
  advance(realMs * S.speed)
  emit()
}
function advance(ms: number) {
  if (S.autopilot) autopilotStep()
  const target = S.now + ms
  for (;;) {
    queue.sort((a, b) => a.at - b.at)
    const j = queue[0]
    if (!j || j.at > target) break
    queue.shift()
    S.now = Math.max(S.now, j.at)
    j.run()
  }
  S.now = target
  if (!S.degraded.feed) S.feedAt = Math.floor(S.now / 30000) * 30000
  // available units check in from base over their terminal every 5 minutes (simulated heartbeat)
  if (!S.degraded.link) {
    const beat = Math.floor(S.now / 300000) * 300000
    for (const u of Object.values(S.units)) if (u.state === 'Available' && u.posAt < beat) S.units[u.id] = { ...u, posNode: u.base, posAt: beat, stateChannel: 'terminal' }
  }
  // overdue acknowledgements surface once, as a timeline event
  // escalations surface once per reason, as a timeline event
  for (const inc of Object.values(S.incidents)) {
    const esc = escalation(inc, S)
    if (esc && inc.escalationLogged !== esc) {
      inc.escalationLogged = esc
      log(inc, 'system', `${esc}. Raised to Act now.`)
      announce(`${inc.id}: ${esc.toLowerCase()}`, 'warn')
    }
  }
  for (const inc of Object.values(S.incidents)) for (const a of inc.assignments) {
    if (!a.released && !a.overdueLogged && assignmentOverdue(a, S)) {
      a.overdueLogged = true
      log(inc, 'system', `Acknowledgement overdue: ${a.unitId} (threshold ${S.thresholds.ackSec} s). Raised to Act now.`)
      announce(`${inc.id}: ${a.unitId} has not acknowledged`, 'warn')
    }
  }
}

// ---------- scenarios ----------
function background() {
  const t0 = S.now
  // A: breakdown on Lekki–Epe, already on scene
  S.now = t0 - 38 * 60000
  const a = ingest({ type: 'officer', channel: 'LT-P40 radio', content: 'Car broken down in the outer lane after the toll plaza, eastbound. Driver unhurt.', locationText: 'Lekki–Epe Expressway, after the toll plaza', segId: 'lekki-epe1', t: 0.55 }, { type: 'Breakdown', vehicle: 'Car', title: 'Breakdown, Lekki–Epe Expwy eastbound', dir: 'Eastbound', scenario: 'background', lanes: 1 })
  a.verif = 'Verified'; a.verifiedBy = 'Officer on scene (LT-P40)'; a.severity = 'Minor'
  S.now += 60000; setState(a, 'Confirmed', 'Verified by officer on scene (LT-P40).', 'Operator A', 'console')
  const as1: Assignment = { id: id('as'), unitId: 'LT-P40', role: 'Traffic control', assignedAt: S.now, history: [{ state: 'Dispatched', channel: 'terminal', at: S.now }, { state: 'Acknowledged', channel: 'radio', at: S.now + 15000 }, { state: 'On scene', channel: 'radio', at: S.now + 20000 }] }
  S.now += 5 * 60000
  const as2: Assignment = { id: id('as'), unitId: 'LT-TOW9', role: 'Recovery', assignedAt: S.now, history: [{ state: 'Dispatched', channel: 'terminal', at: S.now }, { state: 'Acknowledged', channel: 'radio', at: S.now + 30000 }, { state: 'En route', channel: 'terminal', at: S.now + 45000 }] }
  a.assignments = [as1, as2]
  setState(a, 'Responding', 'First dispatch sent (LT-P40).'); S.now += 20000; setState(a, 'On scene', 'First confirmed arrival: LT-P40 (radio).')
  S.units['LT-P40'] = { ...S.units['LT-P40'], state: 'On scene', stateAt: S.now, posNode: 'lekki1', posAt: S.now, incidentId: a.id }
  S.units['LT-TOW9'] = { ...S.units['LT-TOW9'], state: 'En route', stateAt: S.now + 25000, stateChannel: 'terminal', posNode: 'lekki1', posAt: S.now + 25000, incidentId: a.id }
  // B: congestion event at Oshodi
  S.now = t0 - 22 * 60000
  const b = ingest({ type: 'probe', channel: 'fleet probe feed', content: 'Speeds under 10 km/h for 1.2 km towards Apapa from Oshodi. Truck queue for the ports.', locationText: 'Apapa–Oshodi Expressway, Oshodi', segId: 'aoe-osh', t: 0.4 }, { type: 'Congestion', vehicle: 'Trucks (queue)', title: 'Port truck queue, Apapa–Oshodi Expwy', dir: 'Towards Apapa', scenario: 'background' })
  b.verif = 'Verified'; b.verifiedBy = 'Officer report (LT-P09) + probe data'; b.severity = 'Minor'
  S.now += 4 * 60000; setState(b, 'Confirmed', 'Verified by officer report (LT-P09) and probe data.', 'Operator A', 'console')
  // C: road clear, paperwork open
  S.now = t0 - 75 * 60000
  const c = ingest({ type: 'call', channel: '767 line', content: 'Bus and car collided at Fadeyi, inbound.', locationText: 'Ikorodu Road, Fadeyi', segId: 'ikr-anth', t: 0.8 }, { type: 'Crash', vehicle: 'Bus', title: 'Bus and car, Ikorodu Rd at Fadeyi', dir: 'Inbound', scenario: 'background', lanes: 1 })
  c.verif = 'Verified'; c.verifiedBy = 'Officer (LT-P14)'; c.severity = 'Minor'
  S.now += 3 * 60000; setState(c, 'Confirmed', 'Verified by officer (LT-P14).'); setState(c, 'Responding', 'First dispatch sent.'); S.now += 9 * 60000; setState(c, 'On scene', 'First confirmed arrival (radio).')
  S.now += 30 * 60000; setState(c, 'Clearing', 'Recovery under way (radio).'); S.now += 18 * 60000; setState(c, 'Road clear', 'All lanes open (radio).'); c.lanesBlocked = 0
  S.now = t0
}

function s1() {
  const T = S.now
  at(T + 8000, () => ingest({ type: 'call', channel: '767 line', content: 'Caller says a trailer has hit the barrier on Third Mainland Bridge going towards the Island, just past the Adekunle exit. A car is stuck behind it and someone may be hurt.', locationText: 'Third Mainland Bridge, inbound, past the Adekunle link', segId: 'tmb-s', t: 0.3 }, { type: 'Crash', vehicle: 'Trailer', title: 'Trailer crash, Third Mainland Bridge inbound', dir: 'Inbound to Lagos Island', hazards: { injuries: true }, scenario: 'S1' }))
  at(T + 50000, () => ingest({ type: 'driver', channel: 'driver report app (simulated)', content: 'Crash on 3MB inbound, two lanes blocked, traffic stopped.', locationText: 'Third Mainland inbound near Adekunle', segId: 'tmb-s', t: 0.25 }, { type: 'Crash', vehicle: 'Trailer', title: '', dir: '', scenario: 'S1' }))
  at(T + 95000, () => { const inc = Object.values(S.incidents).find(i => i.scenario === 'S1'); if (inc && isOpen(inc)) ingest({ type: 'officer', channel: 'LT-P21 radio', content: 'From the ramp I can see stopped traffic inbound and a trailer across lanes 3 and 4.', locationText: 'Adekunle link ramp', segId: 'tmb-s', t: 0.3 }, { type: 'Crash', vehicle: 'Trailer', title: '', dir: '', scenario: 'S1' }) })
  // Scenario-specific behaviour: the nearest ambulance is slow to acknowledge.
  S.units['AMB-12'] = { ...S.units['AMB-12'], ackDelay: 105 }
}
function s2() {
  const T = S.now
  at(T + 6000, () => ingest({ type: 'officer', channel: 'LT-P12 radio', content: 'Tanker carrying petrol broken down on the Eko Bridge approach at Ijora, inbound. Right lane blocked. Driver says no leak but I can smell fuel.', locationText: 'Eko Bridge approach, Ijora, inbound', segId: 'eko-appr', t: 0.7 }, { type: 'Hazard', vehicle: 'Tanker (PMS)', title: 'Tanker breakdown, Eko Bridge approach', dir: 'Inbound to Lagos Island', hazards: { tanker: true, hazmat: true, secondary: true }, scenario: 'S2', lanes: 1 }))
  at(T + 40000, () => ingest({ type: 'call', channel: '112 line', content: 'Strong fuel smell near Ijora under the bridge, a tanker is parked on the road.', locationText: 'Ijora', segId: 'eko-appr', t: 0.75 }, { type: 'Hazard', vehicle: 'Tanker (PMS)', title: '', dir: '', scenario: 'S2' }))
}
function s3() {
  const T = S.now
  at(T + 5000, () => ingest({ type: 'call', channel: '767 line', content: 'Accident at Ojota, near the interchange, going towards Maryland. A bus and a car.', locationText: 'Ojota interchange, inbound', segId: 'ikr-ojota', t: 0.2 }, { type: 'Crash', vehicle: 'Bus', title: 'Bus and car, Ikorodu Rd at Ojota', dir: 'Inbound', scenario: 'S3' }))
  at(T + 22000, () => ingest({ type: 'call', channel: '112 line', content: 'Crash at Ojota bus stop, bus blocking the road.', locationText: 'Ojota bus stop', segId: 'ikr-ojota', t: 0.15 }, { type: 'Crash', vehicle: 'Bus', title: '', dir: '', scenario: 'S3' }))
  at(T + 45000, () => ingest({ type: 'driver', channel: 'driver report app (simulated)', content: 'Accident just before Ojota coming from Berger, bus and car.', locationText: 'Lagos–Ibadan Expwy near Ojota', segId: 'lie-ojota', t: 0.9 }, { type: 'Crash', vehicle: 'Bus', title: 'Bus and car, Lagos–Ibadan Expwy near Ojota', dir: 'Inbound', scenario: 'S3' }))
  at(T + 65000, () => ingest({ type: 'driver', channel: 'driver report app (simulated)', content: 'CARTER BRIDGE HAS COLLAPSED cars falling into the water!!', locationText: 'Carter Bridge', segId: 'carter', t: 0.4 }, { type: 'Hazard', vehicle: 'Unknown', title: 'Reported collapse, Carter Bridge', dir: 'Both directions', scenario: 'S3' }))
}
export function startScenario(sc: ScenarioId) {
  if (S.scenarios.includes(sc)) return
  S.scenarios = [...S.scenarios, sc]
  ;({ S1: s1, S2: s2, S3: s3 })[sc]()
  announce(`Scenario ${sc} started`)
  emit()
}

// Autopilot plays the operator for S1 so any stage can be reached deterministically.
function autopilotStep() {
  const inc = Object.values(S.incidents).find(i => i.scenario === 'S1' && !isTerminal(i))
  if (!inc) return
  const since = (S.now - inc.stateAt) / 1000
  const was = S.role
  const act = (fn: () => void) => { fn() }
  switch (inc.state) {
    case 'Reported': if (since > 6) act(() => startVerify(inc.id)); break
    case 'Verifying': if (inc.sources.length >= 2 && since > 10 && S.now - inc.sources[inc.sources.length - 1].receivedAt > 12000) act(() => confirmIncident(inc.id, `Camera ${inc.cameraId} and ${independentSources(inc)} independent sources`)); break
    case 'Confirmed':
      if (inc.lanesBlocked == null) act(() => setLanes(inc.id, 2))
      else if (!inc.severity && since > 8) act(() => setSeverity(inc.id, 'Critical', 'Critical'))
      else if (inc.severity && since > 14) { for (const u of ['LT-P21', 'LSM-R04', 'AMB-12', 'PT-7']) dispatchUnit(inc.id, u) }
      break
    case 'Responding':
      if (!inc.playbookId) act(() => activatePlaybook(inc.id, 'PB-TMB-IN'))
      else if (inc.diversion?.status === 'proposed' && since > 20) act(() => requestDiversionApproval(inc.id))
      else if (inc.diversion?.status === 'awaiting approval' && since > 30) { S.role = 'supervisor'; approveDiversion(inc.id); const m = inc.messages.find(x => x.status === 'draft'); if (m) approveMessage(inc.id, m.id); S.role = was }
      else { const m = inc.messages.find(x => x.status === 'approved'); if (m) publishMessage(inc.id, m.id) }
      break
    case 'On scene': {
      const rec = inc.assignments.find(a => S.units[a.unitId].type === 'recovery')
      if (rec && lastConf(rec).state === 'On scene' && !inc.pendingField && since > 30) requestFieldStatus(inc.id, 'Clearing')
      const m = inc.messages.find(x => x.status === 'approved'); if (m) publishMessage(inc.id, m.id)
      break
    }
    case 'Clearing': if (!inc.pendingField && since > 240) requestFieldStatus(inc.id, 'Road clear'); break
    case 'Road clear':
      if (inc.diversion?.status === 'active') liftDiversion(inc.id)
      else { const m = inc.messages.find(x => x.status === 'published'); if (m) withdrawMessage(inc.id, m.id); else if (since > 40 && inc.assignments.every(a => lastConf(a).state === 'On scene')) closeIncident(inc.id, 'Vehicle taken to the LASTMA yard', 'trailer towed by PT-7') }
      break
  }
}

export type Stage = 'verify' | 'assess' | 'respond' | 'clear' | 'closed'
export const STAGES: { id: Stage; state: string; label: string }[] = [
  { id: 'verify', state: 'Reported / Verifying', label: 'Verification leads' },
  { id: 'assess', state: 'Confirmed', label: 'Assessment leads' },
  { id: 'respond', state: 'Responding / On scene', label: 'Response leads' },
  { id: 'clear', state: 'Clearing / Road clear', label: 'Diversion, message and recovery lead' },
  { id: 'closed', state: 'Closed', label: 'Disposition and review lead' },
]
const reached: Record<Stage, (i: Incident) => boolean> = {
  verify: i => i.state === 'Verifying' && i.sources.length >= 2,
  assess: i => i.state === 'Confirmed',
  respond: i => i.state === 'Responding' && i.assignments.some(a => lastConf(a).state !== 'Dispatched') && i.assignments.some(a => assignmentOverdue(a, S)),
  clear: i => i.state === 'Clearing' && (S.now - i.stateAt) > 60000,
  closed: i => i.state === 'Closed',
}
/** Reset, run S1 under autopilot until the stage is reached. Returns the incident id. */
export function fastForwardTo(stage: Stage): string | undefined {
  reset(false)
  FF = true
  S.autopilot = true
  startScenario('S1')
  let incId: string | undefined
  for (let i = 0; i < 4000; i++) {
    advance(1000)
    const inc = Object.values(S.incidents).find(x => x.scenario === 'S1')
    if (inc && reached[stage](inc)) { incId = inc.id; break }
  }
  S.autopilot = false
  FF = false
  S.announcements = []
  emit()
  return incId
}

export function reset(withEmit = true) {
  queue = []; retryFns.clear(); FF = false
  const keepRole = S?.role ?? 'operator'
  S = initial()
  S.role = keepRole
  background()
  S.announcements = []
  if (withEmit) emit()
}

export function resolveGeo() { return { segById } }
reset(false)
