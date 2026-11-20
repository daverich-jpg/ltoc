export type IncidentState = 'Reported' | 'Verifying' | 'Confirmed' | 'Responding' | 'On scene' | 'Clearing' | 'Road clear' | 'Closed' | 'Dismissed' | 'Merged'
export const LIFECYCLE: IncidentState[] = ['Reported', 'Verifying', 'Confirmed', 'Responding', 'On scene', 'Clearing', 'Road clear', 'Closed']
export type VerifState = 'Unverified' | 'Verifying' | 'Verified' | 'Disproved'
export type Severity = 'Minor' | 'Major' | 'Critical'
export type Tier = 'act' | 'watch' | 'ambient' | 'none'
export type SourceType = 'call' | 'officer' | 'camera' | 'driver' | 'agency' | 'probe'
export type Channel = 'radio' | 'terminal' | 'phone' | 'system' | 'console'
export type UnitState = 'Available' | 'Dispatched' | 'Acknowledged' | 'En route' | 'On scene' | 'Returning' | 'Unavailable'
export const UNIT_FLOW: UnitState[] = ['Dispatched', 'Acknowledged', 'En route', 'On scene']
export type AgencyId = 'LASTMA' | 'LASEMA' | 'LASAMBUS' | 'FIRE' | 'POLICE' | 'FRSC' | 'PRIVATE'
export type UnitType = 'patrol' | 'rescue' | 'ambulance' | 'fire' | 'police' | 'recovery'
export type Role = 'operator' | 'supervisor' | 'liaison'
export type ScenarioId = 'S1' | 'S2' | 'S3'

export interface SourceReport {
  id: string
  type: SourceType
  channel: string
  receivedAt: number
  content: string
  locationText: string
  segId: string
  t: number
}

export interface TimelineEvent {
  id: string
  at: number
  actor: string
  route: Channel
  kind: 'state' | 'note' | 'source' | 'assign' | 'unit' | 'assess' | 'message' | 'diversion' | 'system' | 'failure' | 'notify'
  text: string
}

export interface StateConfirmation { state: UnitState; channel: Channel; at: number }

export interface Assignment {
  id: string
  unitId: string
  role: string
  assignedAt: number
  history: StateConfirmation[]
  overdueLogged?: boolean
  released?: boolean
}

export interface Message {
  id: string
  text: string
  status: 'draft' | 'approved' | 'published' | 'withdrawn'
  channel: string
  approver?: string
  updatedAt: number
}

export interface Diversion {
  playbookId: string
  label: string
  segs: string[]
  closes: string[]
  status: 'proposed' | 'awaiting approval' | 'active' | 'lifted'
  updatedAt: number
}

export interface Incident {
  id: string
  type: 'Crash' | 'Breakdown' | 'Congestion' | 'Hazard'
  vehicle: string
  title: string
  segId: string
  t: number
  dir: string
  lanesBlocked: number | null
  hazards: { injuries: boolean; tanker: boolean; hazmat: boolean; secondary: boolean }
  severity: Severity | null
  state: IncidentState
  verif: VerifState
  verifiedBy?: string
  leadAgency: AgencyId
  involved: AgencyId[]
  sources: SourceReport[]
  timeline: TimelineEvent[]
  assignments: Assignment[]
  playbookId?: string
  diversion?: Diversion
  messages: Message[]
  disposition?: string
  createdAt: number
  stateAt: number
  closedAt?: number
  mergedInto?: string
  scenario?: ScenarioId | 'background'
  pendingField?: { want: 'Clearing' | 'Road clear'; unitId: string; at: number }
  cameraId?: string
  escalationLogged?: string
}

export interface Unit {
  id: string
  callsign: string
  agency: AgencyId
  type: UnitType
  base: string
  baseName: string
  state: UnitState
  stateAt: number
  stateChannel: Channel
  posNode: string
  posAt: number
  incidentId?: string
  // recovery assets only
  capacity?: string
  owner?: 'public' | 'private'
  /** simulated behaviour */
  ackDelay: number
  ackChannel: Channel
}

export interface Camera { id: string; name: string; segId: string; t: number; status: 'ok' | 'offline'; /** assumed location */ assumed: true }

export interface Playbook {
  id: string
  name: string
  trigger: string
  segTrigger: string[]
  steps: string[]
  diversion: { label: string; segs: string[]; closes: string[] }
  notify: AgencyId[]
  message: string
}

export interface Pending {
  id: string
  label: string
  incidentId?: string
  issuedAt: number
  status: 'pending' | 'failed'
  error?: string
}

export interface HistoryRecord {
  id: string
  segId: string
  vehicle: string
  createdAt: number
  verifySec: number
  assignSec: number
  arriveSec: number
  clearSec: number
}
