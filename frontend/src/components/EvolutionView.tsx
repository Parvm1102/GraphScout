import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PitchCanvas, { type PitchPlayer } from './PitchCanvas'
import Ticker from './Ticker'
import { BasisBadge, TierBadge } from './Badge'
import { otherPositions, useStore, colorFor } from '../store'
import { type Edge, type Gene, isCut } from '../api'
import { AMBER, CUT_RED } from '../lib/pitch'
import { geneLabel, geneRefs } from '../lib/genes'
import { useReduced } from '../lib/motion'

const REVEAL_MS = 120

/** Fitness climbing live over generations, the champion's genes on a mini-pitch, closing frame = evolved vs greedy + gene ablation. */
export default function EvolutionView() {
  const opt = useStore((s) => s.optimize)
  const our = useStore((s) => s.our)
  const their = useStore((s) => s.their)
  const scores = useStore((s) => s.scores)
  const setHover = useStore((s) => s.setHover)
  const reduced = useReduced()
  const gens = opt.generations
  const final = opt.final

  // buffer the generation events and reveal them at our own pace
  const [revealed, setRevealed] = useState(0)
  const runKey = opt.start?.run_id ?? final?.run_id ?? ''
  const lastKey = useRef(runKey)
  useEffect(() => { if (lastKey.current !== runKey) { lastKey.current = runKey; setRevealed(0) } }, [runKey])
  useEffect(() => {
    if (revealed >= gens.length) return
    if (reduced) { setRevealed(gens.length); return }
    const t = window.setTimeout(() => setRevealed((r) => r + 1), REVEAL_MS)
    return () => window.clearTimeout(t)
  }, [revealed, gens.length, reduced])

  const shown = gens.slice(0, revealed)
  const cur = shown[shown.length - 1]
  const genes: Gene[] = cur?.champion_genes ?? final?.champion.genes ?? []
  const closing = !!final && revealed >= gens.length && opt.status === 'done'

  // mini-pitch: their players from tournament averages; lanes from the candidate pool
  const theirColor = colorFor(their, our)
  const players: PitchPlayer[] = useMemo(() => {
    const s = scores[their]
    if (!s) return []
    return s.players.slice().sort((a, b) => b.minutes - a.minutes).slice(0, 14)
      .map((p) => ({ id: p.id, name: p.name, jersey: p.jersey, x: p.avg_x, y: p.avg_y, score: p.s_p_mean }))
  }, [scores, their])
  const edges: Edge[] = useMemo(() => {
    const out = new Map<string, Edge>()
    opt.start?.lanes.forEach((l) => out.set(`${l.src}->${l.dst}`, { src: l.src, dst: l.dst, count: l.completed ?? l.progressive, completed: l.completed ?? l.progressive, progressive: l.progressive, est: false }))
    for (const g of genes) if (isCut(g)) { const k = `${g.target.src}->${g.target.dst}`; if (!out.has(k)) out.set(k, { src: g.target.src, dst: g.target.dst, count: 10, completed: 10, progressive: 6, est: false }) }
    return [...out.values()]
  }, [opt.start, genes])
  const others = useMemo(() => otherPositions({ team: their, our, their, scores }), [their, our, scores])

  const chartData = shown.map((g) => ({ gen: g.gen, best: g.best_fitness, mean: g.mean_fitness, dC: g.best_dC_mean }))
  const yMax = Math.ceil(Math.max(1, ...gens.map((g) => g.best_fitness)) * 1.15)

  if (!gens.length && opt.status !== 'running') return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="panel-title flex items-center gap-1.5">Evolution <BasisBadge basis="modeled" /></div>
          <div className="text-[11px] text-ink-3">fitness = −mean ΔC − 1.5 × committed players (higher is better); champion genes drawn on {their}'s shape</div>
        </div>
        <div className="text-right text-[11px] text-ink-3 num">
          generation <span className="text-ink font-semibold">{cur ? cur.gen : 0}</span> of {Math.max(0, gens.length - 1)}
          {cur && <> · best ΔC <span className="font-semibold" style={{ color: AMBER }}><Ticker value={cur.best_dC_mean} format={(v) => `${v.toFixed(1)}%`} duration={0.3} /></span> ± {cur.best_dC_std.toFixed(1)}</>}
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="gen" type="number" domain={[0, Math.max(1, gens.length - 1)]} tick={{ fill: '#9FB3A8', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} allowDecimals={false} />
              <YAxis domain={[0, yMax]} tick={{ fill: '#9FB3A8', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v.toFixed(0)} allowDecimals={false} />
              <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.15)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as (typeof chartData)[number]
                return <div className="rounded-md px-2 py-1 text-[11px] num" style={{ background: '#0B1A11', border: '1px solid rgba(255,255,255,0.12)' }}>gen {d.gen} · best {d.best.toFixed(2)} · mean {d.mean.toFixed(2)} · ΔC {d.dC.toFixed(1)}%</div>
              }} />
              <Line type="monotone" dataKey="mean" stroke="rgba(255,255,255,0.3)" strokeWidth={1.2} dot={false} isAnimationActive={false} name="population mean" />
              <Line type="monotone" dataKey="best" stroke={AMBER} strokeWidth={2} dot={false} isAnimationActive={false} name="best" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-3 text-[10px] text-ink-3 -mt-1 pl-5">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-[2px]" style={{ background: AMBER }} /> best fitness</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-[2px]" style={{ background: 'rgba(255,255,255,0.3)' }} /> population mean</span>
          </div>
        </div>
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <PitchCanvas players={players} edges={edges} teamColor={theirColor} genes={genes} otherPositions={others} compact particles={false} idPrefix="mini" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {genes.map((g) => (
            <motion.span key={geneLabel(g)} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: reduced ? 0 : 0.25 }}
              className="chip flex items-center gap-1.5" style={{ borderColor: isCut(g) ? 'rgba(239,68,68,0.5)' : 'rgba(245,158,11,0.5)', color: '#E7EEE9' }}
              onMouseEnter={() => setHover(geneRefs(g))} onMouseLeave={() => setHover([])}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: isCut(g) ? CUT_RED : AMBER }} />
              {geneLabel(g)} <span className="num text-[10px] text-ink-3">k {g.k.toFixed(2)}</span>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {closing && final && (
          <motion.div key="closing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.35 }} className="flex flex-col gap-3">
            <ClosingFrame final={final} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ClosingFrame({ final }: { final: NonNullable<ReturnType<typeof useStore.getState>['optimize']['final']> }) {
  const setHover = useStore((s) => s.setHover)
  const champ = final.champion
  const eq = final.greedy.equal_budget
  const bars = [
    { name: `Evolved (GA) · ${champ.committed} commitments`, dC: champ.verified.dC_mean, std: champ.verified.dC_std, fill: AMBER },
    { name: `Greedy · ${eq.genes.length} commitments`, dC: eq.dC_mean, std: eq.dC_std, fill: 'rgba(255,255,255,0.35)' },
  ]
  const scale = Math.max(0.1, ...bars.map((b) => Math.abs(b.dC) + b.std))
  const abl = final.ablation.slice().sort((a, b) => a.marginal_dC - b.marginal_dC)
  const ablScale = Math.max(0.1, ...abl.map((a) => Math.abs(a.marginal_dC)))
  const same = Math.abs(champ.verified.dC_mean - eq.dC_mean) < 0.05
  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="rounded-lg p-2.5 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="panel-title flex items-center gap-1.5 flex-wrap">Evolved vs greedy · equal budget <TierBadge tier={champ.verified.tier} /></div>
          {bars.map((b) => (
            <div key={b.name} className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px]"><span className="text-ink-2">{b.name}</span><span className="num font-semibold" style={{ color: b.fill === AMBER ? AMBER : '#E7EEE9' }}><Ticker value={b.dC} format={(v) => `${v.toFixed(1)}%`} /> <span className="text-ink-3 font-normal">± {b.std.toFixed(1)}</span></span></div>
              <div className="relative h-[10px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <motion.div className="h-full rounded-full" style={{ background: b.fill }} initial={{ width: 0 }} animate={{ width: `${(Math.abs(b.dC) / scale) * 100}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }} />
                <div className="absolute top-0 h-full" style={{ left: `${(Math.max(0, Math.abs(b.dC) - b.std) / scale) * 100}%`, width: `${((2 * b.std) / scale) * 100}%`, borderLeft: '1px solid rgba(255,255,255,0.5)', borderRight: '1px solid rgba(255,255,255,0.5)' }} />
              </div>
            </div>
          ))}
          <div className="text-[11px] text-ink-3">{same ? 'The GA matched greedy on this matchup: no better 4-gene plan exists in the pool, so it is reported as a tie, never inflated.' : 'Bars show mean ΔC over the matches; ticks mark ±1 std.'}</div>
        </div>
        <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="panel-title">Gene ablation · marginal ΔC when each gene is removed</div>
          <div className="flex flex-col gap-2 mt-2">
            {abl.map((a) => (
              <div key={a.cell} className="flex flex-col gap-1 text-[11px]" onMouseEnter={() => setHover(geneRefs(a.gene))} onMouseLeave={() => setHover([])}>
                <div className="flex justify-between gap-2"><span className="truncate" title={geneLabel(a.gene, false)}>{geneLabel(a.gene)}</span><span className="num shrink-0"><Ticker value={a.marginal_dC} format={(v) => `${v.toFixed(2)}%`} /> <span className="text-ink-3">· {a.dC_without.toFixed(1)}% without</span></span></div>
                <div className="h-[7px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <motion.div className="h-full rounded-full" style={{ background: isCut(a.gene) ? CUT_RED : AMBER }} initial={{ width: 0 }} animate={{ width: `${(Math.abs(a.marginal_dC) / ablScale) * 100}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3 num">
        <span>run <span className="text-ink">{final.run_id}</span></span>
        <span>plan <span className="text-ink">{final.plan_id}</span></span>
        <span><span className="text-ink">{final.evaluations}</span> evaluations · <span className="text-ink">{final.seconds.toFixed(1)}</span> s</span>
        <span>verified over <span className="text-ink">{champ.verified.per_match.length}</span> matches (Tier {champ.verified.tier}; tier B {champ.tier_b_dC_mean.toFixed(1)}%)</span>
      </div>
    </>
  )
}
