// Shared shapes for LTOC's two AI assists. AI output is always a suggestion: it never changes incident state.
export interface MessageFacts {
  incidentId: string
  kind: string // e.g. "Crash, Trailer"
  road: string
  corridor: string
  direction: string
  lanesBlocked: number | null
  lanesTotal: number
  severity: string | null
  diversion: { label: string; status: string } | null
  hazards: string[]
}
export interface MessageDraft {
  english: string
  pidgin: string
  yoruba: string | null
  used: string[]
  caution: string | null
}
export interface ReportInput { id: string; label: string; text: string; reportedAt: string }
export interface ReportRead {
  segId: string | null
  direction: string | null
  vehicle: string | null
  lanesBlocked: number | null
  hazards: { injuries: boolean; tanker: boolean; hazmat: boolean; secondary: boolean }
  evidence: { field: 'road' | 'direction' | 'vehicle' | 'lanes' | 'injuries' | 'tanker' | 'hazmat' | 'secondary'; quote: string }[]
}
export type AIResult<T> = { mode: 'live' | 'demo'; data: T }

const nullable = (type: string) => ({ type: [type, 'null'] })
export const MESSAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['english', 'pidgin', 'yoruba', 'used', 'caution'],
  properties: {
    english: { type: 'string' }, pidgin: { type: 'string' }, yoruba: nullable('string'),
    used: { type: 'array', items: { type: 'string' } }, caution: nullable('string'),
  },
}
const FIELDS = ['road', 'direction', 'vehicle', 'lanes', 'injuries', 'tanker', 'hazmat', 'secondary']
export const READ_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['segId', 'direction', 'vehicle', 'lanesBlocked', 'hazards', 'evidence'],
  properties: {
    segId: nullable('string'), direction: nullable('string'), vehicle: nullable('string'), lanesBlocked: nullable('integer'),
    hazards: { type: 'object', additionalProperties: false, required: ['injuries', 'tanker', 'hazmat', 'secondary'], properties: { injuries: { type: 'boolean' }, tanker: { type: 'boolean' }, hazmat: { type: 'boolean' }, secondary: { type: 'boolean' } } },
    evidence: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'quote'], properties: { field: { type: 'string', enum: FIELDS }, quote: { type: 'string' } } } },
  },
}
