// CCTV frame renderer. A small Three.js scene of a Lagos divided expressway seen from a pole camera:
// real perspective, soft sun shadows, shaded vehicles (cars, danfo buses, trucks), streetlights and
// a sign gantry; water and parapets when the segment is a bridge. Rendered once per frame request to
// a JPEG and cached, so no WebGL context stays alive. Loaded lazily, only when a camera frame opens.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export interface CamSpec {
  key: string
  seed: number
  lanes: number // per direction
  bridge: boolean
  /** what the camera actually shows; null = normal traffic (unverified or false report) */
  scene: null | { vehicle: string; lanesBlocked: number }
  /** a patrol unit confirmed on scene: parked behind the incident with its light bar on */
  patrol?: boolean
}

const W = 1120, H = 490 // 16:7
const LANE = 3.5
const cache = new Map<string, Promise<string>>()

export function renderCamFrame(spec: CamSpec): Promise<string> {
  let p = cache.get(spec.key)
  if (!p) { p = new Promise(res => requestAnimationFrame(() => res(draw(spec)))); cache.set(spec.key, p) }
  return p
}

// ---------- deterministic randomness ----------
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// ---------- materials ----------
const M = {
  asphalt: (tex: THREE.Texture) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xb9b5ad, roughness: 0.9 }),
  kerb: new THREE.MeshStandardMaterial({ color: 0xd6d2c8, roughness: 0.85 }),
  sidewalk: new THREE.MeshStandardMaterial({ color: 0xa8a49b, roughness: 0.95 }),
  verge: new THREE.MeshStandardMaterial({ color: 0x8d8a6a, roughness: 1 }),
  white: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.7 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xe2b23a, roughness: 0.7 }),
  water: new THREE.MeshStandardMaterial({ color: 0x67838c, roughness: 0.45, metalness: 0.1 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1b2229, roughness: 0.15, metalness: 0.6 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8a1410, emissive: 0x5a0a06, roughness: 0.5 }),
  head: new THREE.MeshStandardMaterial({ color: 0xf2f0e6, emissive: 0x6b6a62, roughness: 0.4 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 1.2 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x8f9396, roughness: 0.6, metalness: 0.4 }),
  sign: new THREE.MeshStandardMaterial({ color: 0x1f6b45, roughness: 0.6 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc9ccce, roughness: 0.35, metalness: 0.7 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xe8611a, roughness: 0.6 }),
}
const paint = new Map<number, THREE.MeshStandardMaterial>()
const paintOf = (c: number, metal = 0.35) => { let m = paint.get(c); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.38, metalness: metal }); paint.set(c, m) } return m }

function asphaltTexture(r: () => number) {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#3d3f42'; g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 9000; i++) { const v = 50 + r() * 30; g.fillStyle = `rgba(${v},${v},${v + 2},${0.25 + r() * 0.3})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 1.5, 1 + r() * 1.5) }
  // tyre wear: darker bands where wheels run
  for (const x of [52, 92, 164, 204]) { const gr = g.createLinearGradient(x - 14, 0, x + 14, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 14, 0, 28, 256) }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  return t
}

// ---------- geometry helpers ----------
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o }
const rbox = (w: number, h: number, d: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o }
const flat = (w: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); o.rotation.x = -Math.PI / 2; o.position.set(x, y, z); o.receiveShadow = true; return o }
function wheels(g: THREE.Group, w: number, zs: number[], r = 0.34) {
  for (const z of zs) for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.24, 14), M.tyre); t.rotation.z = Math.PI / 2; t.position.set(s * (w / 2 - 0.08), r, z); t.castShadow = true; g.add(t) }
}

// Vehicles face -Z (driving away from the camera); rotate π for oncoming.
type Kind = 'car' | 'suv' | 'danfo' | 'truck'
const CAR_COLOURS = [0xe9e9e6, 0xe9e9e6, 0xc2c5c8, 0xb0b3b6, 0x6e7276, 0x1c1e21, 0x1c1e21, 0x2b3a52, 0x8b2a24, 0xc8b897, 0x3f5a46]
function vehicle(kind: Kind, colour: number, hazard = false) {
  const g = new THREE.Group()
  if (kind === 'car' || kind === 'suv') {
    const suv = kind === 'suv', w = suv ? 1.95 : 1.8, L = suv ? 4.7 : 4.4, bh = suv ? 0.8 : 0.66
    g.add(rbox(w, bh, L, 0.22, paintOf(colour), 0, 0.32 + bh / 2, 0))
    const ch = suv ? 0.72 : 0.58, cl = suv ? 2.9 : 2.25
    const cab = rbox(w - 0.18, ch, cl, 0.2, M.glass, 0, 0.32 + bh + ch / 2 - 0.04, suv ? 0.25 : 0.2); g.add(cab)
    g.add(rbox(w - 0.22, 0.06, cl - 0.35, 0.03, paintOf(colour), 0, 0.32 + bh + ch - 0.06, suv ? 0.25 : 0.2)) // roof skin
    for (const s of [-1, 1]) { g.add(box(0.32, 0.12, 0.05, hazard ? M.amber : M.tail, s * (w / 2 - 0.25), 0.32 + bh - 0.12, L / 2)); g.add(box(0.3, 0.1, 0.05, M.head, s * (w / 2 - 0.25), 0.32 + bh - 0.14, -L / 2)) }
    wheels(g, w, [L / 2 - 0.85, -L / 2 + 0.85])
  } else if (kind === 'danfo') {
    // Lagos yellow minibus with the black band
    const w = 2.0, L = 5.2, y = 0.38
    g.add(rbox(w, 1.95, L, 0.18, paintOf(0xe9b519, 0.1), 0, y + 0.975, 0))
    for (const s of [-1, 1]) { g.add(box(0.02, 0.5, L - 1.6, M.glass, s * (w / 2 + 0.005), y + 1.45, 0.3)); g.add(box(0.02, 0.1, L - 0.3, M.stripe, s * (w / 2 + 0.006), y + 0.95, 0)) }
    g.add(box(w - 0.3, 0.55, 0.02, M.glass, 0, y + 1.45, -L / 2 - 0.005))
    g.add(box(w - 0.4, 0.45, 0.02, M.glass, 0, y + 1.5, L / 2 + 0.005))
    for (const s of [-1, 1]) g.add(box(0.2, 0.25, 0.04, hazard ? M.amber : M.tail, s * (w / 2 - 0.2), y + 0.55, L / 2 + 0.01))
    wheels(g, w, [L / 2 - 1, -L / 2 + 1], 0.38)
  } else {
    const w = 2.45, y = 0.5
    g.add(rbox(w, 2.3, 2.1, 0.15, paintOf(colour, 0.2), 0, y + 1.25, -4.4))
    g.add(box(w - 0.2, 0.7, 0.02, M.glass, 0, y + 1.9, -5.46))
    g.add(rbox(w, 2.9, 7.4, 0.08, paintOf(0xd8d6d0, 0.1), 0, y + 1.55, 0.6))
    g.add(box(0.04, 2.6, 0.03, M.stripe, 0, y + 1.55, 4.31)) // rear doors
    g.add(box(w, 0.22, 0.2, M.stripe, 0, y + 0.1, 4.25)) // bumper
    for (const s of [-1, 1]) g.add(box(0.25, 0.15, 0.04, hazard ? M.amber : M.tail, s * (w / 2 - 0.2), y + 0.25, 4.36))
    wheels(g, w, [-4.2, 2.4, 3.6], 0.5)
  }
  return g
}

function tanker(hazard: boolean) {
  const g = new THREE.Group(), w = 2.45
  g.add(rbox(w, 2.3, 2.1, 0.15, paintOf(0xb63a2a, 0.2), 0, 1.75, -5.2))
  g.add(box(w - 0.2, 0.7, 0.02, M.glass, 0, 2.4, -6.26))
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, 7.4, 6, 18), M.steel); tank.rotation.x = Math.PI / 2; tank.position.set(0, 2.05, 0.4); tank.castShadow = true; g.add(tank)
  g.add(box(w - 0.3, 0.25, 9, M.stripe, 0, 0.75, 0.2))
  for (const s of [-1, 1]) g.add(box(0.25, 0.15, 0.04, hazard ? M.amber : M.tail, s * (w / 2 - 0.2), 0.75, 4.75))
  wheels(g, w, [-5, 2.6, 3.8], 0.5)
  return g
}

function jackknifedTrailer() {
  const g = new THREE.Group()
  const cab = new THREE.Group(); cab.add(rbox(2.45, 2.3, 2.3, 0.15, paintOf(0x2f4f7a, 0.2), 0, 1.75, 0)); cab.add(box(2.25, 0.7, 0.02, M.glass, 0, 2.4, -1.16)); wheels(cab, 2.45, [0.6], 0.5)
  cab.position.set(-1.2, 0, -7.4); cab.rotation.y = 0.85; g.add(cab)
  const box1 = new THREE.Group(); box1.add(rbox(2.5, 2.9, 12, 0.06, paintOf(0xcfd0cc, 0.1), 0, 2.0, 0)); box1.add(box(2.4, 0.3, 11.6, M.stripe, 0, 0.6, 0)); wheels(box1, 2.5, [4.2, 5.4], 0.5)
  box1.rotation.y = -0.38; g.add(box1)
  return g
}

function patrolCar() {
  const g = vehicle('car', 0xf1f1ee)
  g.add(box(1.6, 0.06, 0.02, paintOf(0x7a1f2b), 0, 0.72, 2.21)) // maroon band
  for (const s of [-1, 1]) g.add(box(0.02, 0.14, 3.6, paintOf(0x7a1f2b), s * 0.905, 0.75, 0))
  const lb = new THREE.Group()
  lb.add(box(0.5, 0.12, 0.28, new THREE.MeshStandardMaterial({ color: 0x2a6bff, emissive: 0x2a6bff, emissiveIntensity: 1.6 }), -0.3, 0, 0))
  lb.add(box(0.5, 0.12, 0.28, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9 }), 0.3, 0, 0))
  lb.position.set(0, 1.62, 0.2); g.add(lb)
  return g
}

function warningTriangle() {
  const s = new THREE.Shape(); s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0, 0.52); s.closePath()
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshStandardMaterial({ color: 0xd62a1a, emissive: 0x5a0a06, side: THREE.DoubleSide })); m.castShadow = true
  return m
}
function cone() { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.75, 14), M.orange); c.position.y = 0.375; c.castShadow = true; g.add(c); g.add(box(0.5, 0.04, 0.5, M.stripe, 0, 0.02, 0)); return g }

// ---------- scene ----------
function draw(spec: CamSpec): string {
  const r = rng(spec.seed * 2654435761 + spec.key.length * 97)
  const N = Math.max(2, Math.min(4, spec.lanes))
  const cw = N * LANE // carriageway width
  const MED = 2.2 // median incl. kerbs
  const SH = 1.0 // shoulder
  const xA = (lane: number) => MED / 2 + 0.4 + (lane + 0.5) * LANE // away (right) carriageway, lane 0 = inner
  const xB = (lane: number) => -(MED / 2 + 0.4 + (lane + 0.5) * LANE) // oncoming (left)
  const LEN = 320, Z0 = 30, Z1 = Z0 - LEN

  const scene = new THREE.Scene()
  const sky = new THREE.Color(0xc9d2d6)
  scene.background = sky
  scene.fog = new THREE.Fog(sky, 90, 260)

  scene.add(new THREE.HemisphereLight(0xe4ecf0, 0x6a675c, 1.25))
  const sun = new THREE.DirectionalLight(0xfff3df, 2.1)
  sun.position.set(-40, 60, 25); sun.target.position.set(0, 0, -40)
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 70, bottom: -90, near: 1, far: 220 })
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3
  scene.add(sun, sun.target)

  // ground: water for bridges, sand/scrub verge otherwise
  scene.add(flat(600, 700, spec.bridge ? M.water : M.verge, 0, spec.bridge ? -4 : -0.02, -150))
  if (spec.bridge) { const deck = box(2 * (cw + SH + MED / 2 + 1.6), 1.4, LEN, M.concrete, 0, -0.72, Z0 - LEN / 2); deck.castShadow = false; scene.add(deck) }

  const tex = asphaltTexture(r); tex.repeat.set(1, LEN / 14)
  const asphalt = M.asphalt(tex)
  for (const s of [-1, 1]) {
    const cx = s * (MED / 2 + (cw + SH + 0.4) / 2)
    scene.add(flat(cw + SH + 0.4, LEN, asphalt, cx, 0, Z0 - LEN / 2))
    // edge lines: yellow by the median, white outside
    scene.add(flat(0.15, LEN, M.yellow, s * (MED / 2 + 0.25), 0.012, Z0 - LEN / 2))
    scene.add(flat(0.15, LEN, M.white, s * (MED / 2 + 0.4 + cw + 0.1), 0.012, Z0 - LEN / 2))
    // dashed lane lines
    for (let l = 1; l < N; l++) for (let z = Z0; z > Z1; z -= 12) scene.add(flat(0.13, 3.2, M.white, s * (MED / 2 + 0.4 + l * LANE), 0.012, z))
    const outer = s * (MED / 2 + 0.4 + cw + SH)
    if (spec.bridge) scene.add(box(0.45, 1.05, LEN, M.concrete, outer + s * 0.3, 0.52, Z0 - LEN / 2))
    else { scene.add(box(0.3, 0.18, LEN, M.kerb, outer + s * 0.15, 0.09, Z0 - LEN / 2)); scene.add(flat(3, LEN, M.sidewalk, outer + s * 1.8, 0.16, Z0 - LEN / 2)) }
  }
  // median: kerbed concrete strip
  scene.add(box(MED - 0.2, 0.3, LEN, M.kerb, 0, 0.15, Z0 - LEN / 2))

  // streetlights on the median, double arms
  for (let z = 10; z > Z1 + 20; z -= 36) {
    scene.add(box(0.22, 10, 0.22, M.pole, 0, 5, z))
    for (const s of [-1, 1]) { const arm = box(3.2, 0.12, 0.12, M.pole, s * 1.6, 9.9, z); scene.add(arm); scene.add(box(0.9, 0.18, 0.4, M.pole, s * 3.1, 9.78, z)) }
  }
  // overhead sign gantry across the away carriageway
  const gz = -118, gx0 = MED / 2 + 0.2, gx1 = MED / 2 + 0.4 + cw + SH + 0.4
  scene.add(box(0.35, 7.2, 0.35, M.pole, gx0, 3.6, gz), box(0.35, 7.2, 0.35, M.pole, gx1, 3.6, gz), box(gx1 - gx0, 0.35, 0.35, M.pole, (gx0 + gx1) / 2, 7.1, gz))
  scene.add(box(Math.min(7, cw - 1), 2.2, 0.15, M.sign, (gx0 + gx1) / 2 + 0.6, 6.0, gz + 0.3))
  scene.add(box(Math.min(5.2, cw - 2.5), 0.18, 0.02, M.white, (gx0 + gx1) / 2 + 0.6, 6.4, gz + 0.38), box(Math.min(3.6, cw - 3.5), 0.14, 0.02, M.white, (gx0 + gx1) / 2 + 0.1, 5.85, gz + 0.38))

  // distant city: low blocks off the road (not on bridges, where the lagoon opens up)
  if (!spec.bridge) {
    const bm = [0xbdb6a8, 0xa9a59c, 0xcfc7b6, 0x9a958b, 0xd7d1c4].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }))
    for (let i = 0; i < 60; i++) {
      const s = i % 2 ? 1 : -1, z = 10 - r() * 260, x = s * (cw + 22 + r() * 60), h = 3 + r() * (r() < 0.12 ? 22 : 8)
      scene.add(box(5 + r() * 9, h, 5 + r() * 9, bm[i % bm.length], x, h / 2, z))
    }
    const leaf = [0x4f6140, 0x5a6b46, 0x46573a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }))
    for (let i = 0; i < 30; i++) {
      const sd = i % 2 ? 1 : -1, x = sd * (cw + 6 + r() * 5), z = 10 - r() * 200
      scene.add(box(0.22, 2.6, 0.22, new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 1 }), x, 1.3, z))
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(1.1 + r() * 0.9, 16, 12), leaf[(i + k) % 3]); b.position.set(x + (r() - 0.5) * 1.6, 3.2 + r() * 1.2, z + (r() - 0.5) * 1.6); b.scale.y = 0.8; b.castShadow = true; b.receiveShadow = true; scene.add(b) }
    }
  } else {
    // far shoreline
    scene.add(box(600, 3, 30, new THREE.MeshStandardMaterial({ color: 0x8e9583, roughness: 1 }), 0, -2.4, -330))
  }

  // ---------- traffic ----------
  const pick = (): { kind: Kind; colour: number } => { const v = r(); const kind: Kind = v < 0.6 ? 'car' : v < 0.76 ? 'suv' : v < 0.95 ? 'danfo' : 'truck'; return { kind, colour: CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)] } }
  const len = (k: Kind) => k === 'truck' ? 11 : k === 'danfo' ? 5.2 : k === 'suv' ? 4.7 : 4.4
  const put = (o: THREE.Object3D, x: number, z: number, yaw = 0) => { o.position.set(x, 0, z); o.rotation.y = yaw; scene.add(o) }

  const S = spec.scene
  const truckQueue = !!S && /truck/i.test(S.vehicle)
  const blocked = S && !truckQueue ? Math.min(N, Math.max(1, S.lanesBlocked || 1)) : 0
  const IZ = -36 // incident position
  const queue = !!S // upstream congestion when something is on the road

  // away carriageway
  for (let l = 0; l < N; l++) {
    const isBlocked = l >= N - blocked
    let z = 6 - r() * 6
    while (z > Z1 + 40) {
      const v = pick(), L = len(v.kind)
      const zc = z - L / 2
      const beforeInc = zc > IZ + 6
      const gap = truckQueue ? 2 + r() * 2.5 : queue && beforeInc ? 3 + r() * 5 : 16 + r() * 34
      if (!(isBlocked && zc < IZ + 30 && zc > IZ - 45)) { // blocked lane: stop short of the incident, then clear road past it
        put(vehicle(truckQueue && r() < 0.8 ? 'truck' : v.kind, v.colour), xA(l) + (r() - 0.5) * 0.35, zc, (r() - 0.5) * 0.03)
      }
      z -= L + gap
    }
  }
  // oncoming carriageway: free flow (a little slower near the incident: rubbernecking)
  for (let l = 0; l < N; l++) {
    let z = Z1 + 50 + r() * 20
    while (z < 8) {
      const v = pick(), L = len(v.kind)
      put(vehicle(v.kind, v.colour), xB(l) + (r() - 0.5) * 0.35, z + L / 2, Math.PI + (r() - 0.5) * 0.03)
      z += L + (Math.abs(z - IZ) < 30 && S ? 6 + r() * 8 : 16 + r() * 36)
    }
  }

  // ---------- the incident ----------
  if (S && !truckQueue) {
    const v = S.vehicle.toLowerCase()
    const lx = xA(N - 1) // outer lane
    const span = blocked * LANE
    const cx = MED / 2 + 0.4 + cw - span / 2
    if (/trailer/.test(v)) {
      const t = jackknifedTrailer(); put(t, cx + 0.4, IZ - 2, 0.0)
      const car = vehicle('car', 0xc2c5c8, true); put(car, xA(N - blocked) - 0.6, IZ + 9.5, 0.25)
    } else if (/tanker/.test(v)) {
      put(tanker(true), lx + 0.35, IZ, -0.04)
    } else if (/bus/.test(v)) {
      put(vehicle('danfo', 0, true), lx - 0.2, IZ, 0.32)
      put(vehicle('car', 0x8b2a24, true), lx - 1.6, IZ + 5.6, -0.5)
    } else {
      put(vehicle('car', 0xe9e9e6, true), lx + 0.55, IZ, 0.09) // broken down, nosed to the shoulder
    }
    // warning triangle and a cone taper behind it
    const tri = warningTriangle(); tri.position.set(lx, 0, IZ + 22); scene.add(tri)
    for (let i = 0; i < 5; i++) put(cone(), lx + LANE / 2 - 0.3 - (i / 4) * span, IZ + 19 - i * 2.2)
    if (spec.patrol) put(patrolCar(), lx + 0.2, IZ + 11, 0.04)
  }

  // ---------- camera: pole-mounted over the median, looking along the away carriageway ----------
  // PTZ zoomed toward the incident, like an operator would; wide when there's nothing to look at
  const cam = new THREE.PerspectiveCamera(S ? 17 : 34, W / H, 0.5, 500)
  cam.position.set(MED / 2 + 0.6, 14, S ? 42 : 30)
  cam.lookAt(S ? xA(N - 1) - 3 : MED / 2 + cw * 0.5, 0, S ? IZ + 2 : IZ - 8)

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(1); renderer.setSize(W, H, false)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0
  renderer.render(scene, cam)
  const url = renderer.domElement.toDataURL('image/jpeg', 0.86)

  scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose() })
  tex.dispose(); asphalt.dispose()
  renderer.dispose(); renderer.forceContextLoss()
  return url
}
