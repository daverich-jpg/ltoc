// Alert budget check: all three scenarios at once. Count Act now over time.
import * as E from '../src/sim/engine'
import { tierOf } from '../src/sim/derive'
const run = (label: string, claimWithinSec: number | null) => {
  E.reset(false)
  E.setInstantCommands(true)
  for (const s of ['S1', 'S2', 'S3'] as const) E.startScenario(s)
  let peak = 0; const trace: string[] = []
  for (let t = 1; t <= 240; t++) {
    E.tick(1000 / E.getState().speed)
    const S = E.getState()
    if (claimWithinSec != null) for (const i of Object.values(S.incidents)) if (i.state === 'Reported' && S.now - i.createdAt > claimWithinSec * 1000) E.startVerify(i.id)
    const act = Object.values(S.incidents).filter(i => tierOf(i, S).tier === 'act')
    peak = Math.max(peak, act.length)
    if (t % 30 === 0) trace.push(`${t}s:${act.length}`)
    if (t === 240) console.log('   at 240 s:', act.map(i => `${i.id} ${tierOf(i, S).reasons[0]}`).join(' / '))
  }
  console.log(label.padEnd(34), 'peak Act now', peak, '|', trace.join(' '))
}
run('nobody claims anything', null)
run('operator claims within 30 s', 30)
