// Demo mode: deterministic stand-ins used when no API key is set or on static hosting.
// Always labelled "demo" in the UI so nobody mistakes them for model output.
import { SEGMENTS } from '../sim/geo'
import type { MessageDraft, MessageFacts, ReportInput, ReportRead } from './types'

export function demoMessage(f: MessageFacts): MessageDraft {
  const lanes = f.lanesBlocked == null ? 'partly blocked' : f.lanesBlocked >= f.lanesTotal ? 'closed' : `${f.lanesBlocked} of ${f.lanesTotal} lanes blocked`
  const what = /tanker/i.test(f.kind) ? 'a broken-down tanker' : /breakdown/i.test(f.kind) ? 'a breakdown' : 'a crash'
  const route = f.diversion ? `Use ${f.diversion.label.replace(/ → /g, ', then ')}.` : 'Expect delays.'
  const crews = f.hazards.includes('injuries') ? ' Emergency crews are on the way.' : ''
  const english = `${f.corridor} ${f.direction.toLowerCase()}: ${lanes} after ${what}. ${route}${crews}`
  const pidginRoute = f.diversion ? `Abeg pass ${f.diversion.label.replace(/ → /g, ', then ')}.` : 'Hold body, go-slow dey.'
  const n = f.lanesBlocked
  const pLanes = n == null ? 'part of the road don block' : n >= f.lanesTotal ? 'the road don close' : `${n === 1 ? 'one' : n === 2 ? 'two' : n} lane${n === 1 ? '' : 's'} don block`
  const pidgin = `${f.corridor} (${f.direction.toLowerCase()}): ${pLanes} because of ${what.replace('a ', '')}. ${pidginRoute}`
  const used = ['road', 'direction', ...(f.lanesBlocked != null ? ['lanes'] : []), ...(f.diversion ? ['diversion'] : []), ...(f.hazards.length ? ['hazards'] : [])]
  return { english, pidgin, yoruba: null, used, caution: f.severity ? null : 'Severity is not confirmed yet.' }
}

const ROADS: [RegExp, string][] = [
  [/third mainland|3mb/i, 'tmb-s'], [/eko bridge|ijora/i, 'eko-appr'], [/carter/i, 'carter'],
  [/berger|ibadan/i, 'lie-ojota'], [/ojota/i, 'ikr-ojota'], [/lekki|toll plaza/i, 'lekki-epe1'], [/oshodi|apapa/i, 'aoe-osh'], [/fadeyi/i, 'ikr-anth'],
]
const find = (re: RegExp, reports: ReportInput[]) => { for (const r of [...reports].reverse()) { const m = r.text.match(re); if (m) return m[0] } return null }

export function demoRead(reports: ReportInput[]): ReportRead {
  const ev: ReportRead['evidence'] = []
  const hit = (field: ReportRead['evidence'][number]['field'], re: RegExp) => { const q = find(re, reports); if (q) ev.push({ field, quote: q }); return q }
  let segId: string | null = null
  for (const [re, id] of ROADS) { const q = hit('road', re); if (q) { segId = id; break } }
  if (segId && !SEGMENTS.some(s => s.id === segId)) segId = null
  const dir = hit('direction', /towards the island|going towards the island|inbound|towards maryland|outbound|eastbound/i)
  const veh = hit('vehicle', /trailer|tanker|bus and (a )?car|bus|car/i)
  const lanesQ = hit('lanes', /two lanes|2 lanes|lanes 3 and 4|right lane|left lane|one lane/i)
  const lanes = lanesQ ? (/two|2|3 and 4/i.test(lanesQ) ? 2 : 1) : null
  const injuries = !!(hit('injuries', /may be hurt|hurt|injur|trapped/i) || hit('injuries', /stuck/i))
  const tanker = !!hit('tanker', /tanker/i)
  const hazmat = !!hit('hazmat', /petrol|fuel smell|smell fuel|leak|fuel/i)
  const secondary = hazmat && !!hit('secondary', /fuel|petrol/i)
  return {
    segId,
    direction: dir ? (/island|inbound/i.test(dir) ? 'Inbound to Lagos Island' : dir[0].toUpperCase() + dir.slice(1)) : null,
    vehicle: veh ? veh[0].toUpperCase() + veh.slice(1) : null,
    lanesBlocked: lanes,
    hazards: { injuries, tanker, hazmat, secondary },
    evidence: ev,
  }
}
