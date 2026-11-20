// Lagos road network for LTOC.
// Data policy (PRD §14): road, bridge and interchange NAMES are Verified against public
// sources as of GEO_AS_OF. GEOMETRY is Assumed: positions are hand-placed from public maps
// and must be checked against OpenStreetMap asset by asset before any claim of accuracy.

export const GEO_AS_OF = '18 Nov 2026'
export const GEO_SOURCE = 'Public sources (see PRD §18); geometry hand-placed, to verify against OSM'

export interface GeoNode {
  id: string
  name: string
  lat: number
  lon: number
  /** 'verified' = place name confirmed in public sources; 'assumed' = label used for realism */
  name_status: 'verified' | 'assumed'
  label?: 'major' | 'minor' | 'none'
}

export interface Segment {
  id: string
  name: string
  corridor: string
  from: string
  to: string
  /** direction the from→to orientation represents */
  dir: string
  lanes: number
  critical: boolean
  bridge?: boolean
  note?: string
}

const n = (id: string, name: string, lat: number, lon: number, name_status: GeoNode['name_status'] = 'verified', label: GeoNode['label'] = 'minor'): GeoNode => ({ id, name, lat, lon, name_status, label })

export const NODES: GeoNode[] = [
  n('oworonshoki', 'Oworonshoki', 6.553, 3.404, 'verified', 'major'),
  n('adekunle', 'Adekunle link', 6.4935, 3.3935, 'assumed', 'major'),
  n('adeniji', 'Adeniji Adele', 6.462, 3.392, 'verified', 'major'),
  n('idumota', 'Idumota', 6.459, 3.387),
  n('apongbon', 'Apongbon', 6.4535, 3.3865, 'verified', 'none'),
  n('cms', 'CMS', 6.4515, 3.3955),
  n('obalende', 'Obalende', 6.447, 3.408),
  n('falomo', 'Falomo', 6.443, 3.43),
  n('vi', 'Victoria Island', 6.4295, 3.42, 'verified', 'major'),
  n('lekkitoll', 'Lekki toll plaza', 6.437, 3.45),
  n('ikoyilink', 'Ikoyi (Link Bridge)', 6.4525, 3.44, 'verified', 'none'),
  n('lekki1', 'Lekki Phase 1', 6.4445, 3.472, 'verified', 'major'),
  n('ajah', 'Ajah', 6.468, 3.566, 'verified', 'major'),
  n('iddo', 'Iddo', 6.468, 3.383),
  n('ijora', 'Ijora', 6.4655, 3.3705),
  n('costain', 'Costain', 6.481, 3.371),
  n('apapa', 'Apapa', 6.4485, 3.359, 'verified', 'major'),
  n('mile2', 'Mile 2', 6.4625, 3.316, 'verified', 'major'),
  n('cele', 'Cele', 6.515, 3.33),
  n('oyingbo', 'Oyingbo', 6.485, 3.3835),
  n('yaba', 'Yaba', 6.51, 3.378, 'verified', 'major'),
  n('ojuelegba', 'Ojuelegba', 6.509, 3.364),
  n('fadeyi', 'Fadeyi', 6.53, 3.372),
  n('anthony', 'Anthony', 6.565, 3.371),
  n('maryland', 'Maryland', 6.5715, 3.3665),
  n('ojota', 'Ojota', 6.584, 3.381, 'verified', 'major'),
  n('ketu', 'Ketu', 6.597, 3.392),
  n('mile12', 'Mile 12', 6.607, 3.397),
  n('ikorodu', 'towards Ikorodu', 6.616, 3.45, 'verified', 'minor'),
  n('berger', 'Berger', 6.643, 3.37),
  n('kara', 'Kara', 6.66, 3.388, 'verified', 'minor'),
  n('gbagada', 'Gbagada', 6.556, 3.389),
  n('oshodi', 'Oshodi', 6.555, 3.343, 'verified', 'major'),
  n('ikeja', 'Ikeja', 6.601, 3.351, 'verified', 'major'),
]

const s = (id: string, name: string, corridor: string, from: string, to: string, dir: string, lanes: number, critical = false, extra: Partial<Segment> = {}): Segment => ({ id, name, corridor, from, to, dir, lanes, critical, ...extra })

export const SEGMENTS: Segment[] = [
  s('tmb-n', 'Third Mainland Bridge (Oworonshoki – Adekunle link)', 'Third Mainland Bridge', 'oworonshoki', 'adekunle', 'Inbound to Lagos Island', 4, true, { bridge: true, note: '11.8 km, four lanes each way. Repeated closures since 2018.' }),
  s('tmb-s', 'Third Mainland Bridge (Adekunle link – Adeniji Adele)', 'Third Mainland Bridge', 'adekunle', 'adeniji', 'Inbound to Lagos Island', 4, true, { bridge: true, note: 'Lands at the Adeniji Adele interchange on Lagos Island.' }),
  s('tmb-link', 'Third Mainland midway link', 'Herbert Macaulay Way', 'oyingbo', 'adekunle', 'Towards the bridge', 2, true, { note: 'Midway link to Herbert Macaulay Way, Yaba.' }),
  s('carter', 'Carter Bridge', 'Carter Bridge', 'iddo', 'idumota', 'Inbound to Lagos Island', 3, true, { bridge: true, note: 'Approved for demolition and rebuild. Shown open as of the as-of date; status must be rechecked.' }),
  s('eko', 'Eko Bridge', 'Eko Bridge', 'ijora', 'apongbon', 'Inbound to Lagos Island', 3, true, { bridge: true }),
  s('eko-appr', 'Eko Bridge approach (Costain – Ijora)', 'Eko Bridge', 'costain', 'ijora', 'Inbound to Lagos Island', 3, true),
  s('hmw-n', 'Herbert Macaulay Way (Yaba – Oyingbo)', 'Herbert Macaulay Way', 'yaba', 'oyingbo', 'Southbound', 2),
  s('hmw-s', 'Herbert Macaulay Way (Oyingbo – Iddo)', 'Herbert Macaulay Way', 'oyingbo', 'iddo', 'Southbound', 2),
  s('ikr-mile12', 'Ikorodu Road (Mile 12 – Ketu)', 'Ikorodu Road', 'mile12', 'ketu', 'Inbound', 3),
  s('ikr-ikorodu', 'Ikorodu Road (towards Ikorodu)', 'Ikorodu Road', 'ikorodu', 'mile12', 'Inbound', 3),
  s('ikr-ketu', 'Ikorodu Road (Ketu – Ojota)', 'Ikorodu Road', 'ketu', 'ojota', 'Inbound', 3),
  s('ikr-ojota', 'Ikorodu Road (Ojota – Maryland)', 'Ikorodu Road', 'ojota', 'maryland', 'Inbound', 3, true),
  s('ikr-mary', 'Ikorodu Road (Maryland – Anthony)', 'Ikorodu Road', 'maryland', 'anthony', 'Inbound', 3),
  s('ikr-anth', 'Ikorodu Road (Anthony – Fadeyi)', 'Ikorodu Road', 'anthony', 'fadeyi', 'Inbound', 3, false, { note: 'BRT corridor: median bus lane usable for diversions.' }),
  s('ikr-fad', 'Ikorodu Road (Fadeyi – Yaba)', 'Ikorodu Road', 'fadeyi', 'yaba', 'Inbound', 3),
  s('lie-ojota', 'Lagos–Ibadan Expressway (Berger – Ojota)', 'Lagos–Ibadan Expressway', 'berger', 'ojota', 'Inbound', 4, true),
  s('lie-kara', 'Lagos–Ibadan Expressway (Kara – Berger)', 'Lagos–Ibadan Expressway', 'kara', 'berger', 'Inbound', 4, true),
  s('gbg-n', 'Gbagada Expressway (Oworonshoki – Gbagada)', 'Oworonshoki–Oshodi Expressway', 'oworonshoki', 'gbagada', 'Westbound', 3),
  s('gbg-s', 'Gbagada Expressway (Gbagada – Anthony)', 'Oworonshoki–Oshodi Expressway', 'gbagada', 'anthony', 'Westbound', 3),
  s('gbg-osh', 'Oworonshoki–Oshodi Expressway (Anthony – Oshodi)', 'Oworonshoki–Oshodi Expressway', 'anthony', 'oshodi', 'Westbound', 3),
  s('mbaw', 'Mobolaji Bank Anthony Way', 'Mobolaji Bank Anthony Way', 'ikeja', 'maryland', 'Southbound', 2),
  s('aoe-osh', 'Apapa–Oshodi Expressway (Oshodi – Cele)', 'Apapa–Oshodi Expressway', 'oshodi', 'cele', 'Towards Apapa', 4, true, { note: 'Heavy goods traffic to the ports.' }),
  s('aoe-cele', 'Apapa–Oshodi Expressway (Cele – Mile 2)', 'Apapa–Oshodi Expressway', 'cele', 'mile2', 'Towards Apapa', 4, true),
  s('aoe-apapa', 'Apapa–Oshodi Expressway (Mile 2 – Apapa)', 'Apapa–Oshodi Expressway', 'mile2', 'apapa', 'Towards Apapa', 3, true),
  s('apapa-rd', 'Apapa Road (Apapa – Ijora)', 'Apapa Road', 'apapa', 'ijora', 'Northbound', 2),
  s('western', 'Funsho Williams Avenue (Ojuelegba – Costain)', 'Funsho Williams Avenue', 'ojuelegba', 'costain', 'Southbound', 3),
  s('ojuel-yaba', 'Ojuelegba – Yaba', 'Local', 'ojuelegba', 'yaba', 'Eastbound', 2),
  s('isl-adj', 'Adeniji Adele Road', 'Lagos Island', 'adeniji', 'idumota', 'Southbound', 2),
  s('isl-apb', 'Idumota – Apongbon', 'Lagos Island', 'idumota', 'apongbon', 'Southbound', 2),
  s('isl-marina', 'Marina', 'Lagos Island', 'apongbon', 'cms', 'Eastbound', 2),
  s('isl-obal', 'CMS – Obalende', 'Lagos Island', 'cms', 'obalende', 'Eastbound', 2),
  s('awolowo', 'Awolowo Road', 'Ikoyi', 'obalende', 'falomo', 'Eastbound', 2),
  s('falomo-br', 'Falomo Bridge', 'Ikoyi', 'falomo', 'vi', 'Southbound', 2, false, { bridge: true }),
  s('ikoyi-local', 'Ikoyi to Link Bridge', 'Ikoyi', 'falomo', 'ikoyilink', 'Eastbound', 2),
  s('link-br', 'Lekki–Ikoyi Link Bridge', 'Lekki–Ikoyi Link Bridge', 'ikoyilink', 'lekki1', 'Eastbound', 2, false, { bridge: true }),
  s('ozumba', 'Ozumba Mbadiwe Avenue', 'Victoria Island', 'vi', 'lekkitoll', 'Eastbound', 3),
  s('lekki-epe1', 'Lekki–Epe Expressway (toll plaza – Lekki Phase 1)', 'Lekki–Epe Expressway', 'lekkitoll', 'lekki1', 'Eastbound', 3, true),
  s('lekki-epe2', 'Lekki–Epe Expressway (Lekki Phase 1 – Ajah)', 'Lekki–Epe Expressway', 'lekki1', 'ajah', 'Eastbound', 3, true),
]

// Projection: equirectangular, cos(6.5°)≈0.994 so degrees are close to square.
export const LON0 = 3.3
export const LAT0 = 6.67
export const K = 3400
export const MAP_W = Math.round((3.58 - LON0) * K)
export const MAP_H = Math.round((LAT0 - 6.41) * K)
export const proj = (lat: number, lon: number): [number, number] => [(lon - LON0) * K, (LAT0 - lat) * K]

export const nodeById: Record<string, GeoNode> = Object.fromEntries(NODES.map(x => [x.id, x]))
export const segById: Record<string, Segment> = Object.fromEntries(SEGMENTS.map(x => [x.id, x]))
export const nodeXY = (id: string) => { const g = nodeById[id]; return proj(g.lat, g.lon) }

export function segPoint(segId: string, t: number): [number, number] {
  const sg = segById[segId]
  const [x1, y1] = nodeXY(sg.from), [x2, y2] = nodeXY(sg.to)
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]
}

const R = 6371
export function haversine(a: string, b: string) {
  const A = nodeById[a], B = nodeById[b]
  const dLat = (B.lat - A.lat) * Math.PI / 180, dLon = (B.lon - A.lon) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(A.lat * Math.PI / 180) * Math.cos(B.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
export const segLengthKm = (id: string) => haversine(segById[id].from, segById[id].to)

// Undirected adjacency for routing (simulated arrival times only).
const adj: Record<string, { to: string; seg: string; km: number }[]> = {}
for (const sg of SEGMENTS) {
  const km = segLengthKm(sg.id) * 1.25 // road vs straight-line factor (assumed)
  ;(adj[sg.from] ||= []).push({ to: sg.to, seg: sg.id, km })
  ;(adj[sg.to] ||= []).push({ to: sg.from, seg: sg.id, km })
}

export function route(from: string, to: string): { km: number; nodes: string[]; segs: string[] } {
  const dist: Record<string, number> = { [from]: 0 }
  const prev: Record<string, { node: string; seg: string }> = {}
  const open = new Set([from])
  const done = new Set<string>()
  while (open.size) {
    let u = ''; let best = Infinity
    for (const o of open) if (dist[o] < best) { best = dist[o]; u = o }
    open.delete(u); done.add(u)
    if (u === to) break
    for (const e of adj[u] || []) {
      if (done.has(e.to)) continue
      const d = dist[u] + e.km
      if (d < (dist[e.to] ?? Infinity)) { dist[e.to] = d; prev[e.to] = { node: u, seg: e.seg }; open.add(e.to) }
    }
  }
  const nodes = [to]; const segs: string[] = []
  let c = to
  while (prev[c]) { segs.unshift(prev[c].seg); c = prev[c].node; nodes.unshift(c) }
  return { km: dist[to] ?? 99, nodes, segs }
}

/** segments that feed into a segment's start node (upstream, used for queue growth) */
export function upstreamOf(segId: string): string[] {
  const sg = segById[segId]
  return SEGMENTS.filter(x => x.id !== segId && x.to === sg.from).map(x => x.id)
}

export const CORRIDORS = Array.from(new Set(SEGMENTS.filter(x => x.corridor !== 'Local').map(x => x.corridor)))

// Water, approximate outlines for orientation only.
const poly = (pts: [number, number][]) => pts.map(([lon, lat]) => proj(lat, lon).map(v => v.toFixed(1)).join(',')).join(' ')
export const WATER = [
  // Lagos Lagoon
  poly([[3.386, 6.545], [3.395, 6.562], [3.41, 6.585], [3.45, 6.605], [3.52, 6.6], [3.58, 6.59], [3.58, 6.47], [3.53, 6.462], [3.49, 6.455], [3.475, 6.458], [3.455, 6.458], [3.436, 6.46], [3.42, 6.458], [3.405, 6.461], [3.398, 6.466], [3.392, 6.47], [3.386, 6.476], [3.386, 6.5], [3.388, 6.52]]),
  // Harbour and Five Cowrie Creek
  poly([[3.373, 6.47], [3.382, 6.472], [3.384, 6.462], [3.383, 6.452], [3.39, 6.446], [3.405, 6.441], [3.42, 6.437], [3.436, 6.44], [3.442, 6.436], [3.425, 6.428], [3.41, 6.42], [3.395, 6.412], [3.37, 6.412], [3.35, 6.43], [3.355, 6.442], [3.366, 6.452], [3.37, 6.46]]),
  // Atlantic
  poly([[3.395, 6.412], [3.43, 6.418], [3.47, 6.425], [3.52, 6.432], [3.58, 6.44], [3.58, 6.4], [3.39, 6.4]]),
]
