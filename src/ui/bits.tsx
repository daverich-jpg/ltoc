import type { ReactNode } from 'react'
import type { IncidentState, SourceType, Tier, Channel } from '../sim/types'

export const WAT = 3600000
export const fmtTime = (ms: number, sec = true) => new Date(ms + WAT).toISOString().slice(11, sec ? 19 : 16)
export function fmtAge(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} m ${(s % 60).toString().padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${(m % 60).toString().padStart(2, '0')} m`
}
export const fmtDur = (sec?: number) => sec == null ? '—' : sec < 60 ? `${Math.round(sec)} s` : sec < 3600 ? `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, '0')}s` : `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`

/** Tier is carried by shape + text + position, not colour alone (PRD principle 6). */
export function TierGlyph({ tier, size = 12 }: { tier: Tier; size?: number }) {
  const s = size
  if (tier === 'act') return <svg className="glyph" width={s} height={s} viewBox="0 0 12 12" aria-hidden><path d="M6 1 11.2 10.5H.8Z" fill="var(--act)" /></svg>
  if (tier === 'watch') return <svg className="glyph" width={s} height={s} viewBox="0 0 12 12" aria-hidden><path d="M6 1.2 10.8 6 6 10.8 1.2 6Z" fill="var(--watch-fill)" stroke="var(--watch)" strokeWidth="1.6" /></svg>
  if (tier === 'ambient') return <svg className="glyph" width={s} height={s} viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="4" fill="none" stroke="var(--ambient)" strokeWidth="1.5" /></svg>
  return <svg className="glyph" width={s} height={s} viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="var(--text-3)" strokeWidth="1.6" /></svg>
}

const STATE_CLASS: Partial<Record<IncidentState, string>> = { Reported: 'act', Verifying: 'watch', 'Road clear': 'ok', Closed: '', Dismissed: '', Merged: '' }
export function StateChip({ state }: { state: IncidentState }) {
  return <span className={`chip state ${STATE_CLASS[state] ?? 'outline'}`}>{state}</span>
}
export const Sim = ({ label = 'SIM' }: { label?: string }) => <span className="chip sim" title="Simulated data. Not a real reading.">{label}</span>
export const Assumed = ({ what }: { what?: string }) => <span className="chip assumed" title={`Assumed${what ? `: ${what}` : ''}. Used for realism, not verified.`}>assumed</span>
export const Verified = ({ asOf, source }: { asOf: string; source: string }) => <span className="prov" title={source}><Icon.check /> verified {asOf}</span>

export function Age({ ms, staleAfter, prefix }: { ms: number; staleAfter?: number; prefix?: string }) {
  const stale = staleAfter != null && ms > staleAfter
  return <span className={`num small ${stale ? 'stale' : 'muted'}`} title={stale ? 'Stale reading' : undefined}>{prefix}{fmtAge(ms)}{stale ? ' · stale' : ''}</span>
}

export const CHANNEL_LABEL: Record<Channel, string> = { radio: 'radio', terminal: 'terminal', phone: 'phone', system: 'system', console: 'console' }

export function SourceIcon({ type }: { type: SourceType }) {
  const p: Record<SourceType, ReactNode> = {
    call: <path d="M3 2h3l1 3-1.5 1a7 7 0 0 0 3.5 3.5L10 8l3 1v3a1 1 0 0 1-1 1A10 10 0 0 1 2 3a1 1 0 0 1 1-1Z" />,
    officer: <><circle cx="8" cy="5" r="2.5" /><path d="M3 14c.5-3 2.5-4.5 5-4.5s4.5 1.5 5 4.5" /></>,
    camera: <><rect x="1.5" y="4" width="9" height="8" rx="1.5" /><path d="m10.5 7 4-2v6l-4-2" /></>,
    driver: <><path d="M3 10V7l1.5-3h7L13 7v3" /><path d="M2 10h12v2H2z" /><circle cx="5" cy="12.5" r="1" /><circle cx="11" cy="12.5" r="1" /></>,
    agency: <><path d="M2 6 8 2l6 4" /><path d="M3 6v7h10V6M6 13V9h4v4" /></>,
    probe: <><path d="M2 12 6 7l3 3 5-6" /><circle cx="14" cy="4" r="1" /></>,
  }
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden>{p[type]}</svg>
}

const I = (d: ReactNode, size = 16) => () => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
export const Icon = {
  overview: I(<><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></>),
  map: I(<><path d="M1.5 3.5 5.5 2l5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5Z" /><path d="M5.5 2v10.5M10.5 3.5V14" /></>),
  incidents: I(<><path d="M8 2 14.5 13.5h-13Z" /><path d="M8 6.5v3M8 11.6v.1" /></>),
  response: I(<><circle cx="5" cy="5" r="2" /><circle cx="11" cy="11" r="2" /><path d="M6.5 6.5l3 3M11 5h2.5M2.5 11H5" /></>),
  analytics: I(<><path d="M2 14h12" /><path d="M4 11V7M8 11V3M12 11V8" /></>),
  flows: I(<><rect x="1.5" y="2" width="5" height="4" rx="1" /><rect x="9.5" y="10" width="5" height="4" rx="1" /><path d="M4 6v4.5a1.5 1.5 0 0 0 1.5 1.5h4" /></>),
  check: I(<path d="M3 8.5 6.5 12 13 4.5" />, 12),
  chev: I(<path d="m6 3.5 4.5 4.5L6 12.5" />, 14),
  x: I(<path d="m4 4 8 8M12 4l-8 8" />, 12),
  search: I(<><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></>, 14),
  play: I(<path d="M5 3.5v9l7-4.5Z" />, 14),
  pause: I(<path d="M5.5 3.5v9M10.5 3.5v9" />, 14),
  reset: I(<><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 2.5V5h2.5" /></>, 14),
  alert: I(<><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 11v.1" /></>, 14),
  link: I(<><path d="M6.5 9.5 9.5 6.5" /><path d="M7 4.5 8.5 3a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5 7.5 13A2.5 2.5 0 0 1 4 9.5L5.5 8" /></>, 14),
  wifi: I(<><path d="M2 6a9 9 0 0 1 12 0M4.5 8.8a5.5 5.5 0 0 1 7 0" /><circle cx="8" cy="12" r="1" /></>, 14),
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd>{children}</kbd> }
