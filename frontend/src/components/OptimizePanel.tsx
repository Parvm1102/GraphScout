import { useStore } from '../store'
import AssignmentHeatmap from './AssignmentHeatmap'
import CommitmentCurve from './CommitmentCurve'
import EvolutionView from './EvolutionView'
import { AmberBadge, TierBadge } from './Badge'
import Ticker from './Ticker'
import { AMBER } from '../lib/pitch'

export default function OptimizePanel() {
  const opt = useStore((s) => s.optimize)
  const run = useStore((s) => s.runOptimize)
  const our = useStore((s) => s.our)
  const their = useStore((s) => s.their)
  const running = opt.status === 'running'
  const final = opt.final
  const phase = running ? (opt.generations.length ? `evolving · gen ${opt.generations.length - 1}` : opt.greedy ? 'greedy seeded, starting GA' : opt.start ? 'building the candidate pool' : 'connecting') : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold">Press plan · {our} against {their}</div>
          <div className="text-[11px] text-ink-3">Greedy seeds the pool; the genetic algorithm searches 4-gene plans (mark a player or cut a lane). Every ΔC is modeled from reweighted observed passes.</div>
        </div>
        <button className="btn btn-amber shrink-0" onClick={() => void run('ga')} disabled={running}>{running ? 'Running…' : final ? 'Run again' : 'Run optimizer'}</button>
      </div>

      {running && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: AMBER }}>
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: AMBER }} />
          <span>{phase}</span>
          {opt.start && <span className="text-ink-3">· run {opt.start.run_id} · {opt.start.pressers.length} pressers × {opt.start.targets.length} targets + {opt.start.lanes.length} lanes</span>}
        </div>
      )}
      {opt.status === 'error' && <div className="text-[12px] rounded-md px-2 py-1.5" style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5' }}>{opt.error}</div>}

      {final && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <div className="panel-title flex items-center gap-1.5">Champion ΔC <TierBadge tier={final.champion.verified.tier} /></div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-[24px] font-semibold" style={{ color: AMBER }}><Ticker value={final.champion.verified.dC_mean} format={(v) => `${v.toFixed(1)}%`} duration={0.9} /></span>
              <span className="text-[12px] text-ink-2">± <Ticker value={final.champion.verified.dC_std} format={(v) => v.toFixed(1)} /></span>
            </div>
            <div className="text-[11px] text-ink-3">mean over {final.champion.verified.per_match.length} {their} matches · {final.champion.committed} commitments</div>
          </div>
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="panel-title">Greedy at equal budget</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-[24px] font-semibold text-ink-2"><Ticker value={final.greedy.equal_budget.dC_mean} format={(v) => `${v.toFixed(1)}%`} duration={0.9} /></span>
              <span className="text-[12px] text-ink-3">± {final.greedy.equal_budget.dC_std.toFixed(1)}</span>
            </div>
            <div className="text-[11px] text-ink-3">knee at {final.greedy.knee} commitments</div>
          </div>
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="panel-title">Run</div>
            <div className="text-[12px] mt-1 num">{final.run_id} <span className="text-ink-3">/</span> {final.plan_id}</div>
            <div className="text-[11px] text-ink-3 num">{final.evaluations} evaluations · {final.seconds.toFixed(1)} s{opt.fromCache ? ' · cached' : ''} <AmberBadge>GA</AmberBadge></div>
          </div>
        </div>
      )}

      <AssignmentHeatmap />
      <CommitmentCurve />
      <EvolutionView />

      {!final && !running && opt.status !== 'error' && (
        <div className="text-[12px] text-ink-3">No optimizer run yet for this matchup. Press Run optimizer: the start event lists the candidate pool, greedy locks four picks while the matrix re-cools, then the GA evolves for 20 generations and the champion is re-verified in FalkorDB.</div>
      )}
    </div>
  )
}
