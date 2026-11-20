import type { ReactNode } from 'react'
import { ArrowCounterClockwise, Buildings, CaretRight, Car, ChartBar, ChartLine, Check, FlowArrow, Link, MagnifyingGlass, MapTrifold, Pause, Phone, Play, SquaresFour, User, UsersThree, VideoCamera, Warning, WarningCircle, WifiHigh, X } from '@phosphor-icons/react'
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

// One icon library across the product: Phosphor, "bold" weight (≈1.5px stroke at 16px) to sit with 400–500 text.
// Status glyphs (tier shapes, map marks, legends) are data marks, not icons, and stay hand-drawn.
const SRC: Record<SourceType, typeof Phone> = { call: Phone, officer: User, camera: VideoCamera, driver: Car, agency: Buildings, probe: ChartLine }
export function SourceIcon({ type }: { type: SourceType }) { const C = SRC[type]; return <C size={16} weight="bold" aria-hidden /> }

const P = (C: typeof Phone, size = 16) => () => <C size={size} weight="bold" aria-hidden />
export const Icon = {
  overview: P(SquaresFour), map: P(MapTrifold), incidents: P(Warning), response: P(UsersThree), analytics: P(ChartBar), flows: P(FlowArrow),
  check: P(Check, 12), chev: P(CaretRight, 14), x: P(X, 14), search: P(MagnifyingGlass, 15),
  play: P(Play, 14), pause: P(Pause, 14), reset: P(ArrowCounterClockwise, 14), alert: P(WarningCircle, 14), link: P(Link, 14), wifi: P(WifiHigh, 14),
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd>{children}</kbd> }
