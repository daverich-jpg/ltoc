import { fastForwardTo, STAGES, getState } from '../src/sim/engine'
import { tierOf } from '../src/sim/derive'
for (const st of STAGES) {
  const id = fastForwardTo(st.id)
  const S = getState()
  const inc = id ? S.incidents[id] : undefined
  console.log(st.id.padEnd(8), id, inc?.state, inc?.verif, 'sev', inc?.severity, 'tier', inc && tierOf(inc, S).tier, '| units', inc?.assignments.map(a => a.unitId + ':' + a.history.at(-1)!.state).join(' '), '| div', inc?.diversion?.status, '| t+', inc && Math.round((S.now - inc.createdAt)/1000)+'s', '| events', inc?.timeline.length)
}
