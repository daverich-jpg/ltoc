// Seed data. Agency names are real. Call signs, bases, camera locations and response
// behaviour are ASSUMED or SIMULATED, never a claim about how the real agencies operate.
import type { AgencyId, Camera, HistoryRecord, Playbook, Unit, UnitType, Channel } from './types'
import { nodeById, SEGMENTS } from './geo'

export const AGENCIES: Record<AgencyId, { name: string; short: string; role: string }> = {
  LASTMA: { name: 'Lagos State Traffic Management Authority', short: 'LASTMA', role: 'Traffic control and scene management' },
  LASEMA: { name: 'Lagos State Emergency Management Agency', short: 'LASEMA', role: 'Rescue and heavy-duty recovery' },
  LASAMBUS: { name: 'Lagos State Ambulance Service', short: 'LASAMBUS', role: 'Pre-hospital care' },
  FIRE: { name: 'Lagos State Fire and Rescue Service', short: 'Fire', role: 'Fire, hazmat and extrication' },
  POLICE: { name: 'Nigeria Police Force, Lagos Command', short: 'Police', role: 'Security, wreck custody' },
  FRSC: { name: 'Federal Road Safety Corps', short: 'FRSC', role: 'Highway safety and crash records' },
  PRIVATE: { name: 'Private recovery operators', short: 'Private', role: 'Tow capacity under call-off (assumed)' },
}

const u = (id: string, agency: AgencyId, type: UnitType, base: string, ackDelay = 25, ackChannel: Channel = 'radio', extra: Partial<Unit> = {}): Unit => ({
  id, callsign: id, agency, type, base, baseName: nodeById[base].name, state: 'Available', stateAt: 0, stateChannel: 'radio', posNode: base, posAt: 0, ackDelay, ackChannel, ...extra,
})

export function seedUnits(): Unit[] {
  return [
    u('LT-P21', 'LASTMA', 'patrol', 'adekunle', 18, 'radio'),
    u('LT-P07', 'LASTMA', 'patrol', 'oworonshoki', 22, 'radio'),
    u('LT-P14', 'LASTMA', 'patrol', 'ojota', 20, 'radio'),
    u('LT-P33', 'LASTMA', 'patrol', 'obalende', 24, 'radio'),
    u('LT-P40', 'LASTMA', 'patrol', 'lekki1', 20, 'radio'),
    u('LT-P12', 'LASTMA', 'patrol', 'ijora', 19, 'radio'),
    u('LT-P09', 'LASTMA', 'patrol', 'oshodi', 21, 'radio'),
    u('LSM-R04', 'LASEMA', 'rescue', 'yaba', 35, 'terminal'),
    u('LSM-R02', 'LASEMA', 'rescue', 'cms', 30, 'terminal'),
    u('LSM-R07', 'LASEMA', 'rescue', 'ikeja', 32, 'terminal'),
    u('AMB-12', 'LASAMBUS', 'ambulance', 'yaba', 40, 'phone'),
    u('AMB-05', 'LASAMBUS', 'ambulance', 'obalende', 35, 'phone'),
    u('AMB-19', 'LASAMBUS', 'ambulance', 'maryland', 38, 'phone'),
    u('FS-03', 'FIRE', 'fire', 'oyingbo', 30, 'radio'),
    u('FS-08', 'FIRE', 'fire', 'ijora', 28, 'radio'),
    u('POL-11', 'POLICE', 'police', 'adeniji', 30, 'phone'),
    u('POL-04', 'POLICE', 'police', 'ojota', 30, 'phone'),
    u('FRSC-RS2', 'FRSC', 'patrol', 'berger', 30, 'phone'),
    u('LSM-HD1', 'LASEMA', 'recovery', 'ojota', 45, 'terminal', { capacity: 'Heavy-duty crane, 60 t', owner: 'public' }),
    u('LT-TOW3', 'LASTMA', 'recovery', 'yaba', 30, 'radio', { capacity: 'Tow truck, 15 t', owner: 'public' }),
    u('LT-TOW9', 'LASTMA', 'recovery', 'lekki1', 30, 'radio', { capacity: 'Tow truck, 15 t', owner: 'public' }),
    u('PT-7', 'PRIVATE', 'recovery', 'oyingbo', 50, 'phone', { capacity: 'Heavy tow, 40 t', owner: 'private' }),
    u('PT-2', 'PRIVATE', 'recovery', 'apapa', 55, 'phone', { capacity: 'Heavy tow, 25 t', owner: 'private' }),
  ]
}

export const CAMERAS: Camera[] = [
  { id: 'TMB-C03', name: 'Third Mainland, Adekunle link south', segId: 'tmb-s', t: 0.28, status: 'ok', assumed: true },
  { id: 'TMB-C01', name: 'Third Mainland, Oworonshoki end', segId: 'tmb-n', t: 0.12, status: 'ok', assumed: true },
  { id: 'EKO-C01', name: 'Eko Bridge approach, Ijora', segId: 'eko-appr', t: 0.7, status: 'ok', assumed: true },
  { id: 'CAR-C01', name: 'Carter Bridge, Iddo end', segId: 'carter', t: 0.35, status: 'ok', assumed: true },
  { id: 'OJT-C02', name: 'Ojota interchange', segId: 'ikr-ojota', t: 0.2, status: 'ok', assumed: true },
  { id: 'OSH-C04', name: 'Oshodi interchange', segId: 'aoe-osh', t: 0.15, status: 'offline', assumed: true },
  { id: 'LKE-C02', name: 'Lekki toll plaza', segId: 'lekki-epe1', t: 0.1, status: 'ok', assumed: true },
]

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'PB-TMB-IN',
    name: 'Third Mainland inbound blockage',
    trigger: 'Two or more inbound lanes blocked on Third Mainland Bridge south of the Adekunle link',
    segTrigger: ['tmb-s', 'tmb-n'],
    steps: [
      'LASTMA patrol to hold traffic at the Adekunle link and filter the open lanes',
      'Divert inbound traffic off at the Adekunle link to Herbert Macaulay Way',
      'Route onward via Iddo and Carter Bridge to Lagos Island',
      'Request heavy recovery early: trailer recovery on a bridge deck is slow',
      'Notify LASEMA, Police and FRSC',
    ],
    diversion: { label: 'Adekunle link → Herbert Macaulay Way → Carter Bridge', segs: ['tmb-link', 'hmw-s', 'carter', 'isl-adj'], closes: ['tmb-s'] },
    notify: ['LASEMA', 'POLICE', 'FRSC'],
    message: 'Third Mainland Bridge inbound (towards Lagos Island) is partly blocked after the Adekunle link following a crash. Expect delays. Leave the bridge at the Adekunle link and use Herbert Macaulay Way and Carter Bridge. Emergency crews are on the way.',
  },
  {
    id: 'PB-EKO-HAZ',
    name: 'Tanker incident on a bridge approach',
    trigger: 'Tanker or hazardous cargo on an approach to Eko or Carter Bridge',
    segTrigger: ['eko-appr', 'eko', 'carter'],
    steps: [
      'Fire service first: hazmat assessment before any recovery',
      'Hold a 300 m cordon upstream (assumed distance, to validate)',
      'Close the Eko Bridge inbound approach and divert via Ojuelegba, Herbert Macaulay Way and Carter Bridge',
      'No towing until Fire confirms the load is safe',
      'Notify LASEMA, Police and the tanker owner',
    ],
    diversion: { label: 'Costain → Ojuelegba → Yaba → Herbert Macaulay → Carter Bridge', segs: ['western', 'ojuel-yaba', 'hmw-n', 'hmw-s', 'carter'], closes: ['eko-appr', 'eko'] },
    notify: ['FIRE', 'LASEMA', 'POLICE'],
    message: 'Eko Bridge inbound is closed at Ijora while a broken-down tanker is made safe. Please avoid the area. Use Herbert Macaulay Way and Carter Bridge to reach Lagos Island.',
  },
  {
    id: 'PB-OJT-BRT',
    name: 'Ojota crash, BRT lane relief',
    trigger: 'Crash at the Ojota interchange blocking inbound lanes',
    segTrigger: ['ikr-ojota', 'lie-ojota', 'ikr-ketu'],
    steps: [
      'Open the BRT lane past the scene under LASTMA control',
      'Hold buses at Ojota for two minutes while the lane is released',
      'Notify LAMATA BRT control (simulated contact)',
    ],
    diversion: { label: 'BRT lane past the scene (Ojota – Maryland)', segs: ['ikr-ojota'], closes: [] },
    notify: ['POLICE'],
    message: 'Crash on Ikorodu Road inbound at Ojota. One lane is blocked. Traffic is being filtered through the BRT lane. Expect short delays.',
  },
]

// Simulated history: 14 days at roughly five crashes a day (PRD §2), heavy-vehicle weighted.
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 } }
export function genHistory(now: number): HistoryRecord[] {
  const r = rng(20261118)
  const weights: Record<string, number> = { 'tmb-n': 5, 'tmb-s': 6, 'aoe-osh': 7, 'aoe-cele': 8, 'aoe-apapa': 9, 'lie-ojota': 7, 'lie-kara': 6, 'ikr-ojota': 5, 'eko-appr': 4, 'apapa-rd': 6, 'lekki-epe1': 4, 'lekki-epe2': 5, 'carter': 3, 'gbg-osh': 3 }
  const pool: string[] = []
  for (const sg of SEGMENTS) for (let i = 0; i < (weights[sg.id] ?? 1); i++) pool.push(sg.id)
  const vehicles = ['Trailer', 'Tanker', 'Trailer', 'Bus', 'Car', 'Trailer', 'Car', 'Tanker', 'Motorcycle', 'Bus']
  const out: HistoryRecord[] = []
  const n = 68
  for (let i = 0; i < n; i++) {
    const day = Math.floor(r() * 14) + 1
    const hour = [6, 7, 7, 8, 8, 9, 12, 16, 17, 18, 18, 19, 21, 23, 2][Math.floor(r() * 15)]
    const createdAt = now - day * 86400000 + (hour - 7) * 3600000 + Math.floor(r() * 3600000)
    const heavy = 0
    out.push({
      id: `INC-${(146 - n + i).toString().padStart(4, '0')}`,
      segId: pool[Math.floor(r() * pool.length)],
      vehicle: vehicles[Math.floor(r() * vehicles.length)],
      createdAt,
      verifySec: Math.round(60 + r() * 300 + (r() < 0.15 ? 600 : 0)),
      assignSec: Math.round(45 + r() * 220 + heavy),
      arriveSec: Math.round(360 + r() * 1100),
      clearSec: Math.round(1800 + r() * 5400 + (r() < 0.2 ? 7200 : 0)),
    })
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}
