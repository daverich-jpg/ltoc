import { useSyncExternalStore } from 'react'
import { getState, getVersion, subscribe } from '../sim/engine'

export function useSim() {
  useSyncExternalStore(subscribe, getVersion)
  return getState()
}

// ---- UI-only state (not part of the operational record) ----
/** Prototype tooling (scenario controls, Flows & states) for case-study capture only: hidden from the product unless the URL has ?lab */
export const LAB = (() => { try { return new URLSearchParams(location.search).has('lab') } catch { return false } })()

export type Module = 'overview' | 'map' | 'incidents' | 'response' | 'analytics' | 'flows'
export type Basemap = 'map' | 'satellite' | 'schematic'
export interface View { x: number; y: number; w: number }
export interface UIState {
  module: Module
  tabs: string[]
  active?: string
  back?: Module
  view: View
  basemap: Basemap
  layers: Record<'traffic' | 'incidents' | 'units' | 'cameras' | 'diversions' | 'closures' | 'labels', boolean>
  palette: boolean
  paletteQuery?: string
  scenarioOpen: boolean
  expanded: Record<string, Record<string, boolean>>
  inspectSeg?: string
  cameraCache: Record<string, number> // camId -> sim time the frame was fetched
  lastInput: 'pointer' | 'keyboard'
  pulse: Record<string, number>
}
let U: UIState = {
  module: 'overview', tabs: [], view: { x: 0, y: 0, w: 952 }, basemap: 'map',
  layers: { traffic: true, incidents: true, units: true, cameras: true, diversions: true, closures: true, labels: true },
  palette: false, scenarioOpen: false, expanded: {}, cameraCache: {}, lastInput: 'pointer', pulse: {},
}
let uv = 0
const ul = new Set<() => void>()
export function useUI() { useSyncExternalStore(l => { ul.add(l); return () => { ul.delete(l) } }, () => uv); return U }
export function setUI(patch: Partial<UIState> | ((u: UIState) => Partial<UIState>)) {
  U = { ...U, ...(typeof patch === 'function' ? patch(U) : patch) }; uv++; ul.forEach(l => l())
}
export const getUI = () => U

export function openIncident(id: string) {
  setUI(u => ({
    tabs: u.tabs.includes(id) ? u.tabs : [...u.tabs.filter(t => t !== u.active || u.tabs.length < 3), id].slice(-3),
    active: id,
    back: u.active ? u.back : u.module,
    inspectSeg: undefined,
  }))
}
export function closeIncident(id?: string) {
  setUI(u => {
    const tabs = u.tabs.filter(t => t !== (id ?? u.active))
    const active = id && id !== u.active ? u.active : undefined
    return { tabs, active, module: active ? u.module : (u.back ?? u.module), back: active ? u.back : undefined }
  })
}
export function go(m: Module) { setUI({ module: m, active: undefined, back: undefined }) }

window.addEventListener('keydown', () => { if (U.lastInput !== 'keyboard') U = { ...U, lastInput: 'keyboard' } }, true)
window.addEventListener('pointerdown', () => { if (U.lastInput !== 'pointer') U = { ...U, lastInput: 'pointer' } }, true)
