import { useEffect, useMemo, useState } from 'react'
import ColdStartNotice from './components/ColdStartNotice'
import Header from './components/Header'
import Footer from './components/Footer'
import WindowBrush from './components/WindowBrush'
import NetworkStats from './components/NetworkStats'
import SimDiff from './components/SimDiff'
import OptimizePanel from './components/OptimizePanel'
import AgentPanel from './components/AgentPanel'
import ScoresPanel from './components/ScoresPanel'
import EvidencePanel from './components/EvidencePanel'
import ErrorBoundary from './components/ErrorBoundary'
import PitchCanvas, { type PitchPlayer } from './components/PitchCanvas'
import { otherPositions, useStore, useTeamColor } from './store'

const TABS = ['Optimize', 'Agent', 'Scores', 'Evidence'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const init = useStore((s) => s.init)
  const network = useStore((s) => s.network)
  const networkAfter = useStore((s) => s.networkAfter)
  const simPlan = useStore((s) => s.simPlan)
  const scores = useStore((s) => s.scores)
  const team = useStore((s) => s.team)
  const our = useStore((s) => s.our)
  const their = useStore((s) => s.their)
  const error = useStore((s) => s.error)
  const teamColor = useTeamColor()
  const [tab, setTab] = useState<Tab>('Optimize')
  const simSel = useStore((s) => s.simSel)
  const setSimSel = useStore((s) => s.setSimSel)
  const simView = useStore((s) => s.simView)

  useEffect(() => { void init() }, [init])
  useEffect(() => {
    document.documentElement.style.setProperty('--team', teamColor)
    document.documentElement.style.setProperty('--team-soft', `${teamColor}2E`)
  }, [teamColor])

  const players: PitchPlayer[] = useMemo(() => {
    if (!network) return []
    const sc = scores[team]
    const byId = new Map(sc?.players.map((p) => [p.id, p.s_p_mean]) ?? [])
    return network.players.map((p) => ({ id: p.id, name: p.name, jersey: p.jersey, x: p.avg_x, y: p.avg_y, score: byId.get(p.id) ?? p.s_p_mean, position: p.position }))
  }, [network, scores, team])
  const edges = useMemo(() => {
    const src = simView === 'after' && networkAfter ? networkAfter : (network?.edges ?? [])
    return src.filter((e) => e.count > 0 || e.completed > 0)
  }, [network, networkAfter, simView])
  const plan = simView === 'after' ? simPlan : null
  const others = useMemo(() => otherPositions({ team, our, their, scores }), [team, our, their, scores])

  return (
    <div className="h-screen flex flex-col" style={{ background: '#07120B' }}>
      <Header />
      <ColdStartNotice />
      {error && <div className="px-4 py-1.5 text-[12px]" style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5' }}>{error}</div>}
      <main className="flex-1 min-h-0 grid gap-3 p-3" style={{ gridTemplateColumns: 'minmax(0, 7fr) minmax(400px, 5fr)' }}>
        <section className="flex flex-col gap-3 min-w-0 min-h-0 overflow-y-auto scroll-thin pr-1">
          <div className="panel p-2">
            <ErrorBoundary label="Pitch">
            <PitchCanvas players={players} edges={edges} teamColor={teamColor} plan={plan} otherPositions={others}
              selectedPlayer={simSel.mode === 'suppress' ? simSel.target : null}
              selectedEdge={simSel.mode === 'cut_lane' ? simSel.edge : null}
              onPlayerClick={(id) => setSimSel({ mode: 'suppress', target: simSel.target === id ? null : id })}
              onEdgeClick={(src, dst) => setSimSel({ mode: 'cut_lane', edge: { src, dst } })} />
            </ErrorBoundary>
          </div>
          <WindowBrush />
          <NetworkStats />
          <ErrorBoundary label="Simulate"><SimDiff /></ErrorBoundary>
        </section>
        <aside className="panel min-w-0 min-h-0 flex flex-col">
          <div className="flex border-b border-white/[0.07] px-2">
            {TABS.map((t) => <button key={t} className="tab" data-on={t === tab} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <div className="p-3 flex-1 min-h-0 overflow-y-auto scroll-thin flex flex-col">
            <ErrorBoundary key={tab} label={`${tab} panel`}>
              {tab === 'Optimize' && <OptimizePanel />}
              {tab === 'Agent' && <AgentPanel />}
              {tab === 'Scores' && <ScoresPanel />}
              {tab === 'Evidence' && <EvidencePanel />}
            </ErrorBoundary>
          </div>
        </aside>
      </main>
      <Footer />
    </div>
  )
}
