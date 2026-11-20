import { useEffect } from 'react'
import { LayoutGroup, MotionConfig } from 'framer-motion'
import * as E from './sim/engine'
import { Announcer, Nav, Palette, Rail, TopBar, useGlobalKeys } from './ui/Frame'
import { Workspace } from './ui/Workspace'
import { AnalyticsModule, IncidentsModule, LiveMapModule, Overview, ResponseModule } from './ui/Modules'
import { FlowsModule } from './ui/Flows'
import { useUI } from './ui/store'

export default function App() {
  const U = useUI()
  useGlobalKeys()
  useEffect(() => {
    let last = performance.now()
    const id = setInterval(() => { const n = performance.now(); E.tick(n - last); last = n }, 250)
    return () => clearInterval(id)
  }, [])
  const ws = !!U.active
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div className="app">
          <TopBar />
          <Nav />
          <Rail />
          <main className="main" id="main">
            {ws || U.module === 'map' ? <LiveMapModule focusId={U.active} wsOpen={ws} /> : null}
            {!ws && U.module === 'overview' && <Overview />}
            {!ws && U.module === 'incidents' && <IncidentsModule />}
            {!ws && U.module === 'response' && <ResponseModule />}
            {!ws && U.module === 'analytics' && <AnalyticsModule />}
            {!ws && U.module === 'flows' && <FlowsModule />}
            <Workspace />
          </main>
        </div>
        {U.palette && <Palette />}
        <Announcer />
      </LayoutGroup>
    </MotionConfig>
  )
}
