// LTOC AI proxy: keeps the API key server-side. Two structured, single-call tasks.
//   POST /api/ai/message { facts: MessageFacts }        → { mode: 'live', data: MessageDraft } | { mode: 'unavailable' }
//   POST /api/ai/read    { reports: ReportInput[] }     → { mode: 'live', data: ReportRead }   | { mode: 'unavailable' }
// 'unavailable' (no credentials, refusal, error) makes the client fall back to its labelled demo mode.
import Anthropic from '@anthropic-ai/sdk'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SEGMENTS } from '../src/sim/geo'
import { MESSAGE_SCHEMA, READ_SCHEMA, type MessageFacts, type ReportInput } from '../src/ai/types'

const MODEL = 'claude-opus-5-5'

export function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || existsSync(join(homedir(), '.config', 'anthropic')))
}
let client: Anthropic | null = null
const getClient = () => (client ??= new Anthropic())

const MESSAGE_SYSTEM = `You write public traffic messages for the Lagos Traffic Operations Centre (LTOC). A supervisor reviews every message before it is published.

Write for drivers reading on a phone or hearing it on radio:
- At most 2 short sentences, under 240 characters. Lead with the road and direction, then what to do.
- Use only the facts you are given. Never invent casualties, causes, times, or reopening estimates.
- If a diversion is given, name it as the route to use. Otherwise say to expect delays.
- No blame, no vehicle owners, no injury details beyond "emergency crews are on the way" when injuries are flagged.
- Nigerian English spelling. Use the road names exactly as given.

Return:
- english: the message.
- pidgin: the same message in Nigerian Pidgin, as Lagos radio would say it.
- yoruba: the same message in Yoruba, or null if you are not confident it is correct.
- used: the fact names you relied on, from: road, direction, lanes, severity, diversion, hazards.
- caution: one short sentence if any fact the message depends on is missing or unconfirmed (for example, severity not set), else null.`

const READ_SYSTEM = `You read incident reports for the Lagos Traffic Operations Centre. Reports are call-taker summaries from the State Emergency Centre (767/112), officer radio reports, and driver reports. Extract what the reports say. You only suggest; an operator confirms.

Road segments (id: name):
${SEGMENTS.map(s => `${s.id}: ${s.name}`).join('\n')}

Rules:
- segId: the single segment the reports describe, or null if unclear. Lagos shorthand: "3MB" is Third Mainland Bridge; "the Island" means Lagos Island (inbound).
- direction: short phrase like "Inbound to Lagos Island", or null.
- vehicle: e.g. "Trailer", "Tanker (petrol)", "Bus and car", or null.
- lanesBlocked: a number only if a report states it ("two lanes", "right lane", "lanes 3 and 4"), else null.
- hazards: true only when a report says so. injuries: someone hurt, trapped or stuck. tanker: a tanker is involved. hazmat: fuel, chemicals, leak or smell of fuel. secondary: risk of a second incident (fuel, fire, stopped traffic on a bridge).
- evidence: for every non-null field and every true hazard, quote the exact words from a report that support it. Quotes must be copied verbatim.
- If reports disagree, prefer the most recent officer report, then the most specific report.`

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c; if (data.length > 100_000) reject(new Error('body too large')) })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

async function structured(system: string, user: string, schema: Record<string, unknown>): Promise<unknown | null> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // Short, well-specified extraction and writing tasks: low effort keeps them quick.
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  })
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null
  const text = response.content.find(b => b.type === 'text')
  return text && text.type === 'text' ? JSON.parse(text.text) : null
}

export async function handleAI(req: IncomingMessage, res: ServerResponse, task: 'message' | 'read') {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
  const reply = (body: object) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
  let body: { facts?: MessageFacts; reports?: ReportInput[] }
  try { body = JSON.parse(await readBody(req)) } catch { res.statusCode = 400; return res.end() }
  if (!hasCredentials()) return reply({ mode: 'unavailable' })
  try {
    if (task === 'message') {
      if (!body.facts) { res.statusCode = 400; return res.end() }
      const data = await structured(MESSAGE_SYSTEM, `Facts (JSON):\n${JSON.stringify(body.facts)}`, MESSAGE_SCHEMA)
      return reply(data ? { mode: 'live', data } : { mode: 'unavailable' })
    }
    const reports = (body.reports ?? []).slice(0, 12).map(r => ({ ...r, text: String(r.text).slice(0, 1500) }))
    if (!reports.length) { res.statusCode = 400; return res.end() }
    const data = await structured(READ_SYSTEM, reports.map(r => `[${r.label} · ${r.reportedAt}]\n${r.text}`).join('\n\n'), READ_SCHEMA)
    return reply(data ? { mode: 'live', data } : { mode: 'unavailable' })
  } catch (err) {
    if (!(err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)) console.error('[ltoc-ai]', err)
    return reply({ mode: 'unavailable' })
  }
}
