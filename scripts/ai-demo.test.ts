import { demoRead, demoMessage } from '../src/ai/demo'
const r = demoRead([{ id: '1', label: 'call', reportedAt: '07:42', text: 'Caller says a trailer has hit the barrier on Third Mainland Bridge going towards the Island, just past the Adekunle exit. A car is stuck behind it and someone may be hurt.' }, { id: '2', label: 'driver', reportedAt: '07:43', text: 'Crash on 3MB inbound, two lanes blocked, traffic stopped.' }])
console.log(r.segId, r.lanesBlocked, r.hazards, r.evidence.map(e => `${e.field}:${e.quote}`).join(' | '))
console.log(demoMessage({ incidentId: 'x', kind: 'Breakdown, Car', road: 'r', corridor: 'Lekki–Epe Expressway', direction: 'Eastbound', lanesBlocked: 1, lanesTotal: 3, severity: 'Minor', diversion: null, hazards: [] }).pidgin)
