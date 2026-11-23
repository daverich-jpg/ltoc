// Derived values (IA §5): never typed in directly, always computed from state.
import type { Incident, Severity, Tier, Unit, Assignment, IncidentState } from './types'
import { segById, upstreamOf, SEGMENTS } from './geo'
import type { State } from './engine'

export const OPEN_STATES: IncidentState[] = ['Reported', 'Verifying', 'Confirmed', 'Responding', 'On scene', 'Clearing', 'Road clear']
export const isOpen = (i: Incident) => OPEN_STATES.includes(i.state)
export const isTerminal = (i: Incident) => i.state === 'Closed' || i.state === 'Dismissed' || i.state === 'Merged'

export const lastConf = (a: Assignment) => a.history[a.history.length - 1]

export function assignmentOverdue(a: Assignment, S: State) {
  const l = lastConf(a)
  return l.state === 'Dispatched' && S.now - l.at > S.thresholds.ackSec * 1000
}

export interface TierInfo { tier: Tier; reasons: string[] }
export function tierOf(inc: Incident, S: State): TierInfo {
  if (isTerminal(inc)) return { tier: 'none', reasons: [] }
  const seg = segById[inc.segId]
  const act: string[] = []
  const active = inc.assignments.filter(a => !a.released)
  // A new report on a critical corridor is Watch. It becomes Act now only if nobody claims it in
  // time, or if verification stalls. (v0.2: v0.1 made every new critical report Act now and blew the alert budget.)
  const esc = escalation(inc, S)
  if (esc) act.push(esc)
  for (const a of active) if (assignmentOverdue(a, S)) act.push(`${a.unitId} not acknowledged after ${S.thresholds.ackSec} s`)
  if (inc.hazards.hazmat && !['Road clear'].includes(inc.state)) act.push('Hazardous cargo: secondary-incident risk')
  else if (inc.hazards.secondary) act.push('Secondary-incident risk')
  const blocked = (inc.lanesBlocked ?? 0) > 0
  const hasRecovery = active.some(a => S.units[a.unitId]?.type === 'recovery')
  if (blocked && !hasRecovery && ['Confirmed', 'Responding', 'On scene'].includes(inc.state) && inc.type !== 'Congestion') act.push('Road blocked, no recovery asset assigned')
  if (S.pending.some(p => p.incidentId === inc.id && p.status === 'failed')) act.push('A command failed and needs a retry')
  if (act.length) return { tier: 'act', reasons: act }
  if (inc.state === 'Road clear') return { tier: 'ambient', reasons: ['Traffic flowing, recovery paperwork open'] }
  if (inc.type === 'Congestion' && inc.state === 'Confirmed') return { tier: 'ambient', reasons: ['Background congestion, monitored'] }
  const w: string[] = []
  if ((inc.state === 'Reported' || inc.state === 'Verifying') && seg.critical) {
    const left = inc.state === 'Reported' ? S.thresholds.unclaimedSec - (S.now - inc.createdAt) / 1000 : S.thresholds.verifySec - (S.now - inc.stateAt) / 1000
    w.push(inc.state === 'Reported' ? `New on a critical corridor · Act now in ${Math.max(0, Math.ceil(left))} s if unclaimed` : `Being verified · Act now in ${fmtLeft(left)} if not decided`)
  } else if (inc.state === 'Reported' || inc.state === 'Verifying') w.push('Awaiting verification')
  if (['Responding'].includes(inc.state)) w.push('Responders moving')
  if (inc.state === 'On scene') w.push('Units on scene')
  if (inc.state === 'Clearing') w.push('Recovery under way')
  if (inc.state === 'Confirmed') w.push('Confirmed, awaiting assignment')
  return { tier: 'watch', reasons: w.length ? w : ['Monitoring'] }
}

const fmtLeft = (sec: number) => { const t = Math.max(0, Math.ceil(sec)); return t < 60 ? `${t} s` : `${Math.floor(t / 60)} m ${String(t % 60).padStart(2, '0')} s` }

/** Why an unverified report on a critical corridor needs action now, or null if it can wait. */
export function escalation(inc: Incident, S: State): string | null {
  if (!segById[inc.segId].critical) return null
  if (inc.state === 'Reported' && S.now - inc.createdAt > S.thresholds.unclaimedSec * 1000) return `Unclaimed for over ${S.thresholds.unclaimedSec} s on a critical corridor`
  if (inc.state === 'Verifying' && S.now - inc.stateAt > S.thresholds.verifySec * 1000) return `Verification open over ${Math.round(S.thresholds.verifySec / 60)} min on a critical corridor`
  return null
}

export const TIER_LABEL: Record<Tier, string> = { act: 'Act now', watch: 'Watch', ambient: 'Ambient', none: 'Resolved' }

export interface SevSuggestion { level: Severity; score: number; factors: { label: string; pts: number; on: boolean }[] }
export function severitySuggestion(inc: Incident): SevSuggestion {
  const seg = segById[inc.segId]
  const heavy = /trailer|tanker|truck|bus/i.test(inc.vehicle)
  const lanes = inc.lanesBlocked ?? 0
  const factors = [
    { label: 'Injuries reported', pts: 2, on: inc.hazards.injuries },
    { label: 'Hazardous cargo or tanker', pts: 3, on: inc.hazards.hazmat || inc.hazards.tanker },
    { label: `Lanes blocked (${lanes} of ${seg.lanes})`, pts: lanes >= seg.lanes ? 2 : lanes >= 2 ? 1 : 0, on: lanes >= 2 },
    { label: 'Heavy vehicle', pts: 1, on: heavy },
    { label: seg.bridge ? 'Critical corridor (bridge)' : 'Critical corridor', pts: 1, on: seg.critical },
    { label: 'Secondary-incident risk', pts: 1, on: inc.hazards.secondary },
  ]
  const score = factors.reduce((t, f) => t + (f.on ? f.pts : 0), 0)
  const level: Severity = score >= 5 ? 'Critical' : score >= 2 ? 'Major' : 'Minor'
  return { level, score, factors }
}

// ---- Simulated traffic ----
function hash(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) } return ((h >>> 0) % 1000) / 1000 }
export type Cond = 'Free' | 'Slow' | 'Heavy' | 'Standstill'
export interface Reading { speed: number; cond: Cond; at: number; kmh: number }
const PEAK_INBOUND = new Set(['Third Mainland Bridge', 'Ikorodu Road', 'Apapa–Oshodi Expressway', 'Lagos–Ibadan Expressway', 'Eko Bridge', 'Carter Bridge'])

export function readingFor(segId: string, S: State): Reading {
  const at = S.feedAt
  const seg = segById[segId]
  const minute = Math.floor(at / 60000)
  let speed = 0.82 - hash(segId) * 0.25
  if (PEAK_INBOUND.has(seg.corridor)) speed -= 0.18
  speed += (hash(segId + minute) - 0.5) * 0.08
  for (const inc of Object.values(S.incidents)) {
    if (!isOpen(inc) || inc.state === 'Road clear' || inc.type === 'Breakdown' && !inc.lanesBlocked) continue
    if (inc.verif === 'Disproved') continue
    const ramp = Math.min(1, Math.max(0, (at - inc.createdAt) / 480000))
    const hit = inc.type === 'Congestion' ? 0.35 : 0.62
    if (inc.segId === segId) speed -= hit * ramp
    else if (upstreamOf(inc.segId).includes(segId)) speed -= hit * 0.65 * ramp
    if (inc.diversion?.status === 'active' && inc.diversion.segs.includes(segId)) speed -= 0.16 * ramp
  }
  speed = Math.max(0.03, Math.min(0.98, speed))
  const cond: Cond = speed > 0.62 ? 'Free' : speed > 0.4 ? 'Slow' : speed > 0.18 ? 'Heavy' : 'Standstill'
  return { speed, cond, at, kmh: Math.round(speed * 70) }
}

export function segmentStatus(segId: string, S: State): { closed: boolean; incidents: Incident[] } {
  const incs = Object.values(S.incidents).filter(i => isOpen(i) && i.segId === segId)
  const closed = Object.values(S.incidents).some(i => isOpen(i) && i.state !== 'Road clear' && i.diversion?.status === 'active' && i.diversion.closes.includes(segId))
  return { closed, incidents: incs }
}

export interface Impact { segs: { segId: string; queueKm: number; delayMin: number }[]; totalDelay: number }
export function impactOf(inc: Incident, S: State): Impact {
  const ids = [inc.segId, ...upstreamOf(inc.segId)]
  const mins = Math.max(0, (S.now - inc.createdAt) / 60000)
  const lanesFactor = inc.lanesBlocked == null ? 0.5 : inc.lanesBlocked / segById[inc.segId].lanes
  const segs = ids.map((id, i) => {
    const r = readingFor(id, S)
    const q = Math.min(4.5, (1 - r.speed) * (i === 0 ? 2.6 : 1.4) * (0.4 + lanesFactor) * Math.min(1, mins / 12 + 0.2))
    return { segId: id, queueKm: Math.round(q * 10) / 10, delayMin: Math.round(q * 6 * (0.6 + lanesFactor)) }
  })
  return { segs, totalDelay: segs.reduce((t, x) => t + x.delayMin, 0) }
}

export function nextAction(inc: Incident, S: State): string {
  const active = inc.assignments.filter(a => !a.released)
  const overdue = active.find(a => assignmentOverdue(a, S))
  if (overdue) return `Chase ${overdue.unitId}: dispatched, no acknowledgement`
  if (S.pending.some(p => p.incidentId === inc.id && p.status === 'failed')) return 'Retry the failed command'
  if (inc.type === 'Congestion' && inc.state === 'Confirmed') return 'Monitor the queue; act if it reaches a junction'
  switch (inc.state) {
    case 'Reported': return 'Open and start verification'
    case 'Verifying': return inc.sources.length > 1 || inc.cameraId ? 'Confirm, dismiss or merge' : 'Find a camera or second source'
    case 'Confirmed': return inc.severity ? 'Assign units and recovery' : 'Confirm severity, then assign'
    case 'Responding': return 'Watch acknowledgements and arrivals'
    case 'On scene': {
      if (!active.some(a => S.units[a.unitId]?.type === 'recovery') && inc.lanesBlocked) return 'Assign a recovery asset'
      if (inc.diversion && inc.diversion.status !== 'active' && inc.diversion.status !== 'lifted') return 'Get the diversion approved'
      return 'Request clearing status when recovery starts'
    }
    case 'Clearing': return 'Request road-clear confirmation from the scene'
    case 'Road clear': {
      if (inc.diversion?.status === 'active') return 'Lift the diversion'
      if (inc.messages.some(m => m.status === 'published')) return 'Withdraw the public message'
      if (!inc.clearance) return 'Ask who cleared the road, then close'
      return 'Record disposition and close'
    }
    default: return ''
  }
}

export function unitDistanceTo(u: Unit, nodeId: string, routeKm: (a: string, b: string) => number) { return routeKm(u.posNode, nodeId) }

export function nearestNode(segId: string, t: number) { const sg = segById[segId]; return t < 0.5 ? sg.from : sg.to }

export interface IncMetrics { verify?: number; assign?: number; arrive?: number; clear?: number }
export function metricsOf(inc: Incident): IncMetrics {
  const find = (re: RegExp) => inc.timeline.find(e => re.test(e.text))?.at
  const confirmed = find(/^State → Confirmed/)
  const firstAck = inc.timeline.find(e => e.kind === 'unit' && / acknowledged/.test(e.text))?.at
  const onScene = find(/^State → On scene/)
  const clear = find(/^State → Road clear/)
  return {
    verify: confirmed ? (confirmed - inc.createdAt) / 1000 : undefined,
    assign: confirmed && firstAck ? (firstAck - confirmed) / 1000 : undefined,
    arrive: firstAck && onScene ? (onScene - firstAck) / 1000 : undefined,
    clear: onScene && clear ? (clear - onScene) / 1000 : undefined,
  }
}

export const CORRIDOR_SEGS = (c: string) => SEGMENTS.filter(s => s.corridor === c)
