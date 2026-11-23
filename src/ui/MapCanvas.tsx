import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MAP_H, MAP_W, NODES, SEGMENTS, WATER, nodeXY, segPath, segPoint, segPointDir, upstreamOf } from '../sim/geo'
import { Basemap } from './Basemap'
import { isOpen, readingFor, segmentStatus, tierOf, lastConf, type Cond } from '../sim/derive'
import { getUI, openIncident, setUI, useSim, useUI } from './store'
import { Ambulance, Car, Circle, Diamond, FireTruck, Lifebuoy, Siren, Triangle, Truck, VideoCamera, VideoCameraSlash } from './icons'
import type { UnitType } from '../sim/types'

const UNIT_ICON: Record<UnitType, typeof Car> = { patrol: Car, rescue: Lifebuoy, ambulance: Ambulance, fire: FireTruck, police: Siren, recovery: Truck }
import type { Incident } from '../sim/types'

const COND_STYLE: Record<Cond, { c: string; w: number; dash?: string }> = {
  Free: { c: 'var(--t-free)', w: 2 },
  Slow: { c: 'var(--t-slow)', w: 3 },
  Heavy: { c: 'var(--t-heavy)', w: 4.5 },
  Standstill: { c: 'var(--t-stand)', w: 5.5, dash: '7 3' },
}
export const COND_LEGEND = COND_STYLE

function easeOut(t: number) { return 1 - Math.pow(1 - t, 3) }

export function MapCanvas({ focusId, wsOpen, hotspots }: { focusId?: string; wsOpen?: boolean; hotspots?: Record<string, number> }) {
  const S = useSim()
  const U = useUI()
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1000, h: 800 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const anim = useRef<number>(0)
  const [local, setLocal] = useState<{ x: number; y: number; w: number } | null>(null)
  const setView = (view: { x: number; y: number; w: number }) => hotspots ? setLocal(view) : setUI({ view })

  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // first fit
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || size.w < 50 || focusId) return
    fitted.current = true
    const v0 = getUI().view
    if (!(v0.w === 952 && v0.x === 0) && !hotspots) return
    // fit the network's core (Ikeja to Ajah, Mile 2 to Kara) with room for the layers panel on the left
    const bx = 0, by = 40, bw = MAP_W, bh = MAP_H - 80
    const w = Math.max(bw * 1.12, bh * 1.08 * size.w / size.h)
    const h = w * size.h / size.w
    const view = { x: bx + bw / 2 - w / 2 - w * 0.06, y: by + bh / 2 - h / 2, w }
    if (hotspots) setLocal(view); else setUI({ view })
  }, [size.w, size.h])

  // anchor on the focused incident, leaving room for the workspace panel
  const focus = focusId ? S.incidents[focusId] : undefined
  useEffect(() => {
    if (!focus) return
    const [ix, iy] = segPoint(focus.segId, focus.t)
    const panelPx = wsOpen ? Math.min(760, size.w * 0.62) : 0
    const visible = Math.max(0.3, (size.w - panelPx) / size.w)
    const w = 380 / visible
    const target = { x: ix - w * visible / 2, y: iy - (w * size.h / size.w) / 2, w }
    const from = getUI().view
    cancelAnimationFrame(anim.current)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setUI({ view: target }); return }
    const t0 = performance.now(), D = 320
    const step = (t: number) => {
      const k = easeOut(Math.min(1, (t - t0) / D))
      setUI({ view: { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k, w: from.w + (target.w - from.w) * k } })
      if (k < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(anim.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, wsOpen, size.w > 0])

  const v = hotspots ? (local ?? U.view) : U.view
  const vh = v.w * (size.h / Math.max(1, size.w))
  const zoomedIn = v.w < 600
  const schematic = U.basemap === 'schematic'

  const related = useMemo(() => {
    if (!focus) return null
    const segs = new Set([focus.segId, ...upstreamOf(focus.segId), ...(focus.diversion?.status !== 'lifted' ? focus.diversion?.segs ?? [] : [])])
    const units = new Set(focus.assignments.filter(a => !a.released).map(a => a.unitId))
    return { segs, units }
  }, [focus])

  const incidents = Object.values(S.incidents).filter(i => isOpen(i) && i.verif !== 'Disproved')
  const feedAge = S.now - S.feedAt
  const stale = feedAge > 180000

  function onWheel(e: React.WheelEvent) {
    const rect = ref.current!.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width, py = (e.clientY - rect.top) / rect.height
    const k = Math.exp(e.deltaY * 0.0015)
    const w = Math.min(1400, Math.max(140, v.w * k))
    const h = w * size.h / size.w
    setView({ x: v.x + (v.w - w) * px, y: v.y + (vh - h) * py, w })
  }
  function onDown(e: React.PointerEvent) { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false } }
  function onMove(e: React.PointerEvent) {
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    const s = v.w / size.w
    setView({ ...v, x: d.vx - dx * s, y: d.vy - dy * s })
  }
  function onUp() { setTimeout(() => { drag.current = null }, 0) }
  const click = (fn: () => void) => (e: React.MouseEvent) => { if (drag.current?.moved) return; e.stopPropagation(); fn() }

  const dimSeg = (id: string) => related && !related.segs.has(id) ? 0.25 : 1
  const L = hotspots ? { ...U.layers, traffic: false, units: false, diversions: false, closures: false, cameras: false, incidents: false } : U.layers
  // spread units sharing a node
  const unitPos = useMemo(() => {
    const byNode: Record<string, number> = {}
    const out: Record<string, [number, number]> = {}
    for (const u of Object.values(S.units)) {
      if (u.state === 'Available' && !zoomedIn) continue
      const k = byNode[u.posNode] = (byNode[u.posNode] ?? -1) + 1
      const [x, y] = nodeXY(u.posNode)
      const ang = k * 1.9 + 0.6
      out[u.id] = [x + Math.cos(ang) * (9 + k * 2), y + Math.sin(ang) * (9 + k * 2)]
    }
    return out
  }, [S.units, zoomedIn])

  return (
    <div className="mapwrap" ref={ref} data-basemap={U.basemap}>
      {!schematic && <Basemap mode={U.basemap as 'map' | 'satellite'} view={{ x: v.x, y: v.y, w: v.w, h: vh }} size={size} />}
      <svg viewBox={`${v.x} ${v.y} ${v.w} ${vh}`} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onClick={() => { if (!drag.current?.moved) setUI({ inspectSeg: undefined }) }} role="img" aria-label={schematic ? "Schematic map of Lagos road network" : "Map of Lagos road network"}>
        <defs>
          <filter id="desat"><feColorMatrix type="saturate" values="0.15" /></filter>
        </defs>
        {schematic && <>
          <rect x={-500} y={-500} width={MAP_W + 1000} height={MAP_H + 1000} fill="var(--map-land)" />
          {WATER.map((p, i) => <polygon key={i} points={p} fill="var(--water)" />)}
        </>}

        {/* base roads: the schematic draws its own; on a real basemap only the network outline, so it stays legible with traffic hidden */}
        <g>
          {SEGMENTS.map(sg => {
            const d = segPath(sg.id)
            const w = 2.5 + sg.lanes * 0.8
            if (!schematic) return <path key={sg.id} d={d} fill="none" stroke="var(--net-line)" strokeWidth={L.traffic ? 1 : 2.5} strokeLinecap="round" strokeLinejoin="round" opacity={dimSeg(sg.id) * (L.traffic ? 0.5 : 0.9)} />
            return <g key={sg.id} opacity={dimSeg(sg.id)} className="focus-dim" style={{ filter: related && !related.segs.has(sg.id) ? 'url(#desat)' : undefined }} fill="none" strokeLinejoin="round">
              {sg.bridge && <path d={d} stroke="var(--bridge-casing)" strokeWidth={w + 3} strokeLinecap="butt" />}
              {!sg.bridge && <path d={d} stroke="var(--road-casing)" strokeWidth={w + 1.6} strokeLinecap="round" />}
              <path d={d} stroke="var(--road)" strokeWidth={w} strokeLinecap="round" />
            </g>
          })}
        </g>

        {/* simulated traffic */}
        {L.traffic && <g>
          {SEGMENTS.map(sg => {
            const r = readingFor(sg.id, S)
            const st = COND_STYLE[r.cond]
            return <path key={sg.id} d={segPath(sg.id)} fill="none" strokeLinejoin="round" stroke={stale ? 'var(--text-3)' : st.c} strokeWidth={stale ? 1.5 : st.w} strokeDasharray={stale ? '2 4' : st.dash} strokeLinecap="round" opacity={dimSeg(sg.id) * (stale ? 0.6 : 0.95)} className="focus-dim" />
          })}
        </g>}

        {hotspots && <g>{SEGMENTS.map(sg => {
          const n = hotspots[sg.id] ?? 0; if (!n) return null
          return <path key={sg.id} d={segPath(sg.id)} fill="none" strokeLinejoin="round" stroke="var(--act)" strokeOpacity={0.25 + Math.min(0.7, n / 12)} strokeWidth={3 + n * 1.3} strokeLinecap="round" />
        })}</g>}

        {/* closures */}
        {L.closures && SEGMENTS.filter(sg => segmentStatus(sg.id, S).closed).map(sg => {
          const [mx, my] = segPoint(sg.id, 0.5)
          return <g key={sg.id} opacity={dimSeg(sg.id)}>
            <path d={segPath(sg.id)} fill="none" strokeLinejoin="round" stroke="var(--act)" strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" />
            <g transform={`translate(${mx} ${my})`}><rect x={-14} y={-7} width={28} height={14} rx={3} fill="var(--act)" /><text x={0} y={3.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="var(--on-solid)" fontFamily="var(--mono)">CLOSED</text></g>
          </g>
        })}

        {/* diversions */}
        {L.diversions && incidents.filter(i => i.diversion && i.diversion.status !== 'lifted').map(i => (
          <g key={i.id} opacity={related && focus?.id !== i.id ? 0.25 : 1}>
            {i.diversion!.segs.map(sid => {
              const d = segPath(sid); const { p: [ax, ay], a } = segPointDir(sid, 0.5); const k = v.w / 1000
              const active = i.diversion!.status === 'active'
              return <g key={sid}>
                <path d={d} stroke="var(--map-land)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.7} />
                <path d={d} stroke="var(--diversion)" strokeWidth={active ? 2.5 : 2} strokeDasharray={active ? undefined : '5 4'} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M-4 -4 4 0 -4 4Z" fill="var(--diversion)" transform={`translate(${ax} ${ay}) rotate(${a * 180 / Math.PI}) scale(${Math.max(0.8, k * 1.4)})`} />
              </g>
            })}
          </g>
        ))}

        {/* hit areas for the segment inspector */}
        {SEGMENTS.map(sg => {
          return <path key={sg.id} d={segPath(sg.id)} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }} onClick={click(() => setUI({ inspectSeg: sg.id }))}><title>{sg.name}</title></path>
        })}
        {U.inspectSeg && (() => { return <path d={segPath(U.inspectSeg)} strokeLinejoin="round" stroke="var(--focus)" strokeWidth={2} strokeDasharray="3 3" fill="none" pointerEvents="none" /> })()}

        {/* labels */}
        {L.labels && NODES.filter(n => n.label === 'major' || (zoomedIn && n.label === 'minor')).map(nd => {
          const [x, y] = nodeXY(nd.id)
          const k = v.w / 1000
          return <g key={nd.id} opacity={related ? 0.55 : 1}>
            <circle cx={x} cy={y} r={1.8 * k + 0.6} fill="var(--text-3)" />
            <text x={x + 6 * k} y={y - 5 * k} className={`map-label ${nd.label}`} style={{ fontSize: (nd.label === 'major' ? 11.5 : 10.5) * k, strokeWidth: 3 * k }}>{nd.name}{nd.name_status === 'assumed' ? '*' : ''}</text>
          </g>
        })}

        {/* cameras (assumed locations) */}
        {L.cameras && S.cameras.map(c => {
          const [x, y] = segPoint(c.segId, c.t); const k = v.w / 1000
          const rel = !related || focus?.cameraId === c.id
          return <g key={c.id} transform={`translate(${x + 8 * k} ${y + 6 * k}) scale(${k})`} opacity={rel ? 0.9 : 0.25}>
            <circle r={6} fill="var(--surface)" stroke="var(--line)" strokeWidth={0.8} />
            {c.status === 'ok' ? <VideoCamera x={-4} y={-4} size={8} style={{ color: 'var(--text-2)' }} /> : <VideoCameraSlash x={-4} y={-4} size={8} style={{ color: 'var(--act)' }} />}
            <title>{`${c.id} · ${c.name} · ${c.status} · location assumed`}</title>
          </g>
        })}

        {/* unit assignment links */}
        {L.units && incidents.flatMap(i => i.assignments.filter(a => !a.released && lastConf(a).state !== 'On scene').map(a => {
          const p = unitPos[a.unitId]; if (!p) return null
          const [ix, iy] = segPoint(i.segId, i.t)
          return <line key={a.id} x1={p[0]} y1={p[1]} x2={ix} y2={iy} stroke="var(--text-3)" strokeWidth={0.8 * v.w / 1000 + 0.3} strokeDasharray="2 3" opacity={related && !related.units.has(a.unitId) ? 0.2 : 0.8} />
        }))}

        {/* units at last confirmed position */}
        {L.units && Object.values(S.units).map(u => {
          const p = unitPos[u.id]; if (!p) return null
          const k = v.w / 1000
          const rel = !related || related.units.has(u.id)
          const busy = u.state !== 'Available'
          const age = S.now - u.posAt
          return <g key={u.id} transform={`translate(${p[0]} ${p[1]}) scale(${k})`} opacity={rel ? 1 : 0.22}>
            <circle r={7} fill="var(--surface)" stroke={busy ? 'var(--text)' : 'var(--text-3)'} strokeWidth={1.2} strokeDasharray={age > 300000 ? '2 2' : undefined} />
            {(() => { const UI = UNIT_ICON[u.type]; return <UI x={-4.5} y={-4.5} size={9} style={{ color: busy ? 'var(--text)' : 'var(--text-3)' }} /> })()}
            {(zoomedIn && (rel && related)) && <text x={9} y={3} fontSize={8.5} className="map-label" style={{ strokeWidth: 2.5 }}>{u.callsign} · {u.state.toLowerCase()}</text>}
            <title>{`${u.callsign} (${u.agency}) · ${u.state} · position confirmed ${Math.round(age / 1000)} s ago`}</title>
          </g>
        })}

        {/* incidents */}
        {L.incidents && incidents.map(i => <IncidentMarker key={i.id} inc={i} k={v.w / 1000} focused={focus?.id === i.id} dim={!!related && focus?.id !== i.id} onClick={click(() => openIncident(i.id))} />)}
      </svg>
    </div>
  )
}

function IncidentMarker({ inc, k, focused, dim, onClick }: { inc: Incident; k: number; focused: boolean; dim: boolean; onClick: (e: React.MouseEvent) => void }) {
  const S = useSim()
  const { tier } = tierOf(inc, S)
  const [x, y] = segPoint(inc.segId, inc.t)
  const s = (focused ? 1.5 : 1) * k
  const unverified = inc.verif !== 'Verified'
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={dim ? 0.3 : 1} style={{ cursor: 'pointer' }} onClick={onClick}>
      {focused && <circle r={16} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="3 3" />}
      <circle r={13} fill="transparent" />
      {/* Phosphor tier glyph on a surface disc; a dashed ring marks "not yet verified" */}
      <circle r={10.5} fill="var(--surface)" stroke={unverified ? (tier === 'act' ? 'var(--act)' : 'var(--watch)') : 'var(--line)'} strokeWidth={unverified ? 1.4 : 0.8} strokeDasharray={unverified ? '3 2' : undefined} />
      {tier === 'act' && <Triangle x={-7.5} y={-8.5} size={15} weight="fill" style={{ color: 'var(--act)' }} />}
      {tier === 'watch' && <Diamond x={-8} y={-8} size={16} weight="duotone" style={{ color: 'var(--watch)' }} />}
      {tier === 'ambient' && <Circle x={-6} y={-6} size={12} style={{ color: 'var(--ambient)' }} />}
      {(focused || tier === 'act') && <text x={12} y={4} className="map-label inc" style={{ strokeWidth: 3, fontSize: focused ? 8.5 : 11 }}>{inc.id}{unverified ? ' · unverified' : ''}</text>}
      <title>{`${inc.id} · ${inc.title} · ${inc.state}`}</title>
    </g>
  )
}
