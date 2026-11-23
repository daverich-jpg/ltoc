// Snaps LTOC's schematic network to real OpenStreetMap geometry.
// 1. Junctions: each node is placed where its named roads meet in OSM (or the nearest
//    point on its road), searched near the hand-placed position in geo.ts.
// 2. Segments: routed junction to junction with OSRM (FOSSGIS instance), via a point on
//    the segment's named road, then simplified into src/sim/roads.json.
// Run: node scripts/snap-roads.mjs   (Overpass data is cached in scripts/.osm-cache.json)
// Geometry © OpenStreetMap contributors (ODbL).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const UA = { 'User-Agent': 'ltoc-prototype/0.1' }
const src = readFileSync(new URL('../src/sim/geo.ts', import.meta.url), 'utf8')
const NODES = {}
for (const m of src.matchAll(/n\('([\w-]+)', '[^']*', ([\d.]+), ([\d.]+)/g)) NODES[m[1]] = [+m[2], +m[3]]
const SEGS = []
for (const m of src.matchAll(/s\('([\w-]+)', '[^']*', '[^']*', '([\w-]+)', '([\w-]+)'/g)) SEGS.push({ id: m[1], from: m[2], to: m[3] })

const R = {
  tmb: /Third Mainland/i, ow: /Apapa-Oworon/i, adj: /Adeniji Adele/i, carter: /Carter Bridge/i, eko: /Eko Bridge/i,
  marina: /Marina/i, obal: /Obalende Road/i, awo: /^Awolowo Road/i, falomo: /Falomo/i, ozumba: /Ozumba/i, le: /Lekki-Epe/i,
  link: /Lekki - Ikoyi/i, hmw: /Herbert Macaulay/i, apr: /^Apapa Road/i, west: /Western Avenue/i, ikr: /^Ikorodu Road/i,
  ojuel: /Ojuelegba/i, mbaw: /Mobolaji Bank/i, lie: /Lagos-Ibadan/i,
}
// node -> [road] (nearest point) or [roadA, roadB] (where they meet)
const JUNCTION = {
  oworonshoki: ['tmb', 'ow'], adekunle: ['tmb'], adeniji: ['tmb', 'adj'], idumota: ['carter'], apongbon: ['eko'], cms: ['marina'],
  obalende: ['obal'], falomo: ['awo', 'falomo'], vi: ['falomo', 'ozumba'], lekkitoll: ['ozumba', 'le'], ikoyilink: ['link'], lekki1: ['le'],
  ajah: ['le'], iddo: ['carter', 'hmw'], ijora: ['eko'], costain: ['west', 'eko'], apapa: ['ow', 'apr'], mile2: ['ow'], cele: ['ow'],
  oyingbo: ['hmw'], yaba: ['hmw', 'ikr'], ojuelegba: ['ojuel', 'west'], fadeyi: ['ikr'], anthony: ['ikr', 'ow'], maryland: ['ikr', 'mbaw'],
  ojota: ['ikr', 'lie'], ketu: ['ikr'], mile12: ['ikr'], ikorodu: ['ikr'], berger: ['lie'], kara: ['lie'], gbagada: ['ow'], oshodi: ['ow'], ikeja: ['mbaw'],
}
const ROAD = {
  'tmb-n': 'tmb', 'tmb-s': 'tmb', carter: 'carter', eko: 'eko', 'eko-appr': 'eko', 'hmw-n': 'hmw', 'hmw-s': 'hmw',
  'ikr-mile12': 'ikr', 'ikr-ikorodu': 'ikr', 'ikr-ketu': 'ikr', 'ikr-ojota': 'ikr', 'ikr-mary': 'ikr', 'ikr-anth': 'ikr', 'ikr-fad': 'ikr',
  'lie-ojota': 'lie', 'lie-kara': 'lie', 'gbg-n': 'ow', 'gbg-s': 'ow', 'gbg-osh': 'ow', mbaw: 'mbaw', 'aoe-osh': 'ow', 'aoe-cele': 'ow', 'aoe-apapa': 'ow',
  'apapa-rd': 'apr', western: 'west', 'isl-adj': 'adj', 'isl-marina': 'marina', awolowo: 'awo', 'falomo-br': 'falomo', 'link-br': 'link', ozumba: 'ozumba',
  'lekki-epe1': 'le', 'lekki-epe2': 'le',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CACHE = new URL('./.osm-cache.json', import.meta.url)
let ways
if (existsSync(CACHE)) ways = JSON.parse(readFileSync(CACHE, 'utf8'))
else {
  const q = `[out:json][timeout:120];way["highway"~"motorway|trunk|primary|secondary"]["name"](6.38,3.28,6.70,3.62);out geom tags;`
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: UA })
  ways = (await r.json()).elements.map(w => ({ name: w.tags.name, g: w.geometry.map(p => [p.lat, p.lon]) }))
  writeFileSync(CACHE, JSON.stringify(ways))
}
const roadWays = Object.fromEntries(Object.entries(R).map(([k, re]) => [k, ways.filter(w => re.test(w.name))]))

const toXY = ([lat, lon]) => [lon * 110.57 * Math.cos(6.5 * Math.PI / 180), lat * 110.57] // km
const dist = (a, b) => { const A = toXY(a), B = toXY(b); return Math.hypot(A[0] - B[0], A[1] - B[1]) }
function edges(ws) { const e = []; for (const w of ws) for (let i = 0; i < w.g.length - 1; i++) e.push([w.g[i], w.g[i + 1]]); return e }
function nearestOnEdge([a, b], p) {
  const A = toXY(a), B = toXY(b), P = toXY(p), vx = B[0] - A[0], vy = B[1] - A[1]
  const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / (vx * vx + vy * vy || 1e-12)))
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
function nearestOn(key, p, maxKm = 2) {
  let best = null
  for (const e of edges(roadWays[key])) { const q = nearestOnEdge(e, p); const d = dist(p, q); if (d < maxKm && (!best || d < best.d)) best = { d, ll: q } }
  return best
}
// where road A comes closest to road B, near p (penalise distance from p lightly)
function meet(ka, kb, p, maxKm = 2) {
  const eb = edges(roadWays[kb]).filter(([a]) => dist(a, p) < maxKm + 0.5)
  let best = null
  for (const ea of edges(roadWays[ka])) {
    if (dist(ea[0], p) > maxKm + 0.5) continue
    for (const pt of [ea[0], ea[1], [(ea[0][0] + ea[1][0]) / 2, (ea[0][1] + ea[1][1]) / 2]]) {
      for (const e of eb) {
        const q = nearestOnEdge(e, pt); const gap = dist(pt, q); const score = gap + 0.15 * dist(pt, p)
        if (!best || score < best.score) best = { score, gap, ll: [(pt[0] + q[0]) / 2, (pt[1] + q[1]) / 2] }
      }
    }
  }
  return best
}

const nodes = {}
for (const [id, p] of Object.entries(NODES)) {
  const spec = JUNCTION[id]
  let ll = p, how = 'unchanged'
  if (spec.length === 2) { const m = meet(spec[0], spec[1], p); if (m && m.gap < 0.15) { ll = m.ll; how = `${spec.join('×')} gap ${(m.gap * 1000) | 0} m` } else { const n = nearestOn(spec[0], p); if (n) { ll = n.ll; how = `${spec[0]} (no meet, gap ${m ? (m.gap * 1000) | 0 : '-'} m)` } } }
  else { const n = nearestOn(spec[0], p); if (n) { ll = n.ll; how = spec[0] } }
  nodes[id] = ll
  const mv = dist(p, ll) * 1000
  console.log(`node ${id.padEnd(12)} moved ${String(mv | 0).padStart(5)} m  via ${how}${mv > 1200 ? '  <-- CHECK' : ''}`)
}


// Undirected graph over the cached OSM ways. For display we want the road itself, not a legal
// driving route, so one-way rules are ignored; leaving the segment's named road costs extra.
const vkey = ([a, b]) => a.toFixed(7) + ',' + b.toFixed(7)
function shortestOnRoads(A, B, key, wayList = ways) {
  const re = key ? R[key] : null
  const adj = new Map(), pos = new Map()
  for (const w of wayList) {
    const pen = (re && re.test(w.name || '') ? 1 : re ? 3 : 1.4) * (w.minor ? 1.6 : 1)
    for (let i = 0; i < w.g.length - 1; i++) {
      const a = vkey(w.g[i]), b = vkey(w.g[i + 1]); pos.set(a, w.g[i]); pos.set(b, w.g[i + 1])
      const d = dist(w.g[i], w.g[i + 1]) * pen
      if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, [])
      adj.get(a).push([b, d]); adj.get(b).push([a, d])
    }
  }
  const snap = p => { let best = null, bd = Infinity; for (const [k, ll] of pos) { if (re && !(adj.get(k) || []).length) continue; const d = dist(p, ll); if (d < bd) { bd = d; best = k } } return best }
  const s = snap(A), t = snap(B); if (!s || !t) return null
  const D = new Map([[s, 0]]), prev = new Map(), done = new Set()
  const heap = [[0, s]]
  while (heap.length) {
    let mi = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[mi][0]) mi = i
    const [du, u] = heap.splice(mi, 1)[0]
    if (done.has(u)) continue; done.add(u)
    if (u === t) break
    if (du > 40) break
    for (const [v, w] of adj.get(u) || []) { const nd = du + w; if (nd < (D.get(v) ?? Infinity)) { D.set(v, nd); prev.set(v, u); heap.push([nd, v]) } }
  }
  if (!done.has(t)) return null
  const path = [t]; let c = t; while (prev.has(c)) { c = prev.get(c); path.unshift(c) }
  const line = path.map(k => pos.get(k))
  let km = 0; for (let i = 1; i < line.length; i++) km += dist(line[i - 1], line[i])
  return { km, line, how: 'osm graph' }
}

// every drivable way in a box around the segment (cached), for short links the major-road
// graph can't connect and OSRM can only reach via one-way loops
const LOCAL = new URL('./.osm-local-cache.json', import.meta.url)
const localCache = existsSync(LOCAL) ? JSON.parse(readFileSync(LOCAL, 'utf8')) : {}
async function localWays(id, A, B) {
  if (localCache[id]) return localCache[id]
  const pad = 0.008
  const bb = [Math.min(A[0], B[0]) - pad, Math.min(A[1], B[1]) - pad, Math.max(A[0], B[0]) + pad, Math.max(A[1], B[1]) + pad].map(v => v.toFixed(4)).join(',')
  const q = `[out:json][timeout:90];way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|_link"](${bb});out geom tags;`
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: UA })
      if (r.ok) {
        const els = (await r.json()).elements
        localCache[id] = els.map(w => ({ name: w.tags.name || '', minor: /residential|unclassified/.test(w.tags.highway), g: w.geometry.map(p => [p.lat, p.lon]) }))
        writeFileSync(LOCAL, JSON.stringify(localCache)); await sleep(1500); return localCache[id]
      }
    } catch { /* retry */ }
    await sleep(5000 * (a + 1))
  }
  return []
}

async function osrm(pts) {
  const coords = pts.map(([la, lo]) => `${lo.toFixed(6)},${la.toFixed(6)}`).join(';')
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson`, { headers: UA })
      if (r.ok) { const j = await r.json(); if (j.code === 'Ok') return { km: j.routes[0].distance / 1000, line: j.routes[0].geometry.coordinates.map(([lo, la]) => [la, lo]) } }
    } catch { /* retry */ }
    await sleep(1500 * (a + 1))
  }
  return null
}
function simplify(pts, tol = 0.005) {
  if (pts.length < 3) return pts
  const X = pts.map(toXY), keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1
    const [ax, ay] = X[a], [bx, by] = X[b], vx = bx - ax, vy = by - ay, L = Math.hypot(vx, vy) || 1e-12
    for (let i = a + 1; i < b; i++) { const d = L < 1e-9 ? Math.hypot(X[i][0] - ax, X[i][1] - ay) : Math.abs(vx * (ay - X[i][1]) - vy * (ax - X[i][0])) / L; if (d > md) { md = d; mi = i } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

const out = { source: '© OpenStreetMap contributors (ODbL); routed with OSRM', generated: new Date().toISOString().slice(0, 10), nodes: {}, segments: {} }
for (const [id, ll] of Object.entries(nodes)) out.nodes[id] = [+ll[0].toFixed(5), +ll[1].toFixed(5)]
const only = process.argv[2]?.split(',')
const prev = only && existsSync(new URL('../src/sim/roads.json', import.meta.url)) ? JSON.parse(readFileSync(new URL('../src/sim/roads.json', import.meta.url), 'utf8')).segments : {}
for (const sg of SEGS) {
  if (only && !only.includes(sg.id)) { out.segments[sg.id] = prev[sg.id]; continue }
  const A = nodes[sg.from], B = nodes[sg.to], straight = dist(A, B)
  const key = ROAD[sg.id]
  let pick = shortestOnRoads(A, B, key)
  if (!pick || pick.km / straight > 1.9) {
    const cands = pick ? [pick] : []
    const fwd = await osrm([A, B]); if (fwd) cands.push({ ...fwd, how: 'osrm' })
    const rev = await osrm([B, A]); if (rev) cands.push({ ...rev, line: rev.line.reverse(), how: 'osrm rev' })
    cands.sort((a, b) => a.km - b.km); pick = cands[0]
    await sleep(200)
  }
  if (pick.km / straight > 1.4) {
    const loc = shortestOnRoads(A, B, key, await localWays(sg.id, A, B))
    if (loc && loc.km < pick.km * 0.95) pick = { ...loc, how: 'local graph' }
  }
  const line = [A, ...pick.line, B]
  out.segments[sg.id] = { pts: simplify(line).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]), km: +pick.km.toFixed(2) }
  const ratio = pick.km / straight
  console.log(`${sg.id.padEnd(12)} ${pick.how.padEnd(13)} road ${pick.km.toFixed(1).padStart(5)} km / straight ${straight.toFixed(1).padStart(4)} km  x${ratio.toFixed(2)}${ratio > 1.6 ? '  <-- CHECK' : ''}  pts ${out.segments[sg.id].pts.length}`)
}
writeFileSync(new URL('../src/sim/roads.json', import.meta.url), JSON.stringify(out))
