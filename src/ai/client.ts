import type { AIResult, MessageDraft, MessageFacts, ReportInput, ReportRead } from './types'
import { demoMessage, demoRead } from './demo'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Try the live proxy; on no key, refusal, error, or static hosting, return the labelled demo result. */
async function call<T>(path: string, body: object, demo: () => T): Promise<AIResult<T>> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok && r.headers.get('content-type')?.includes('json')) {
      const j = await r.json()
      if (j.mode === 'live' && j.data) return { mode: 'live', data: j.data as T }
    }
  } catch { /* fall through to demo */ }
  await sleep(650) // demo results still take a beat, so the loading state is honest about there being work
  return { mode: 'demo', data: demo() }
}

export const draftMessage = (facts: MessageFacts) => call<MessageDraft>('./api/ai/message', { facts }, () => demoMessage(facts))
export const readReports = (reports: ReportInput[]) => call<ReportRead>('./api/ai/read', { reports }, () => demoRead(reports))
