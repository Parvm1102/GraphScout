import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { type GreedyMatrix, type GreedyStep } from '../api'
import { AMBER, TEAM_RED, TEAM_BLUE, heatColor } from '../lib/pitch'
import { geneLabel, parseCell, shortName } from '../lib/genes'
import { useReduced } from '../lib/motion'
import Ticker from './Ticker'

/** Pressers x (targets + lanes). Cells colored by mean ΔC (more negative = stronger), dimmed by low overlap. */
export default function AssignmentHeatmap() {
  const opt = useStore((s) => s.optimize)
  const our = useStore((s) => s.our)
  const setHover = useStore((s) => s.setHover)
  const reduced = useReduced()
  const theirColor = useStore((s) => (s.their === s.our ? TEAM_BLUE : TEAM_RED))

  const steps: GreedyStep[] = opt.greedy?.steps ?? opt.final?.greedy.steps ?? []
  const matrices: GreedyMatrix[] = opt.greedy?.matrices ?? []
  const nSteps = steps.length
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)

  // reset playback on a new run
  useEffect(() => { setStep(matrices.length ? 0 : nSteps); setPlaying(false) }, [opt.start?.run_id, opt.final?.run_id, matrices.length, nSteps])

  useEffect(() => {
    if (!playing) return
    if (step >= nSteps) { setPlaying(false); return }
    timer.current = window.setTimeout(() => setStep((s) => s + 1), reduced ? 300 : 1200)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [playing, step, nSteps, reduced])

  // names
  const names = useMemo(() => {
    const m = new Map<string, string>()
    opt.start?.pressers.forEach((p) => m.set(`p:${p.id}`, p.name))
    opt.start?.targets.forEach((t) => m.set(`mark:${t.id}`, t.name))
    opt.start?.lanes.forEach((l) => m.set(`cut:${l.src}->${l.dst}`, `${shortName(l.src_name)} → ${shortName(l.dst_name)}`))
    for (const s of steps) {
      m.set(`p:${s.gene.presser.id}`, s.gene.presser.name)
      const c = parseCell(s.cell)
      if (c.action === 'mark' && 'name' in s.gene.target) m.set(c.col, s.gene.target.name)
      if (c.action === 'cut' && 'src_name' in s.gene.target) m.set(c.col, `${shortName(s.gene.target.src_name)} → ${shortName(s.gene.target.dst_name)}`)
    }
    return m
  }, [opt.start, steps])

  const rows = useMemo(() => {
    const ids = opt.start?.pressers.map((p) => p.id) ?? []
    if (ids.length) return ids
    const set = new Set<number>()
    matrices[0] && Object.keys(matrices[0].cells).forEach((k) => set.add(parseCell(k).presser))
    steps.forEach((s) => set.add(s.gene.presser.id))
    return [...set]
  }, [opt.start, matrices, steps])
  const cols = useMemo(() => {
    const marks = opt.start?.targets.map((t) => `mark:${t.id}`) ?? []
    const cuts = opt.start?.lanes.map((l) => `cut:${l.src}->${l.dst}`) ?? []
    if (marks.length + cuts.length) return [...marks, ...cuts]
    const set = new Set<string>()
    matrices[0] && Object.keys(matrices[0].cells).forEach((k) => set.add(parseCell(k).col))
    steps.forEach((s) => set.add(parseCell(s.cell).col))
    return [...set].sort((a, b) => (a.startsWith('mark') === b.startsWith('mark') ? 0 : a.startsWith('mark') ? -1 : 1))
  }, [opt.start, matrices, steps])

  const curIdx = Math.min(step, Math.max(0, matrices.length - 1))
  const matrix = matrices[curIdx]
  const locked = useMemo(() => new Map(steps.slice(0, step).map((s, i) => [s.cell, i + 1])), [steps, step])
  const lockedPressers = new Set([...locked.keys()].map((c) => parseCell(c).presser))
  const lockedCols = new Set([...locked.keys()].map((c) => parseCell(c).col))

  const [vmin, vmax] = useMemo(() => {
    const vals = matrix ? Object.values(matrix.cells).map((c) => c.dC_mean) : []
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [-1, 0]
  }, [matrix])
  const overlapMax = useMemo(() => {
    const vals = matrix ? Object.values(matrix.cells).map((c) => c.overlap ?? 0) : []
    return Math.max(0.01, ...vals)
  }, [matrix])

  if (!steps.length) return null
  const total = step > 0 ? steps[step - 1].dC_mean : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="panel-title">Assignment matrix · {our} pressers × targets and lanes</div>
          <div className="text-[11px] text-ink-3">mean ΔC over the matches if that cell is added to the locked picks; faded cells share little ground with the target</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button className="btn" disabled={step <= 0} onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)) }}>‹</button>
          <button className="btn btn-amber" onClick={() => { if (step >= nSteps) setStep(0); setPlaying(true) }} disabled={playing || !matrices.length}>
            {playing ? 'Playing…' : step >= nSteps ? 'Replay greedy' : 'Play greedy'}
          </button>
          <button className="btn" disabled={step >= nSteps} onClick={() => { setPlaying(false); setStep((s) => Math.min(nSteps, s + 1)) }}>›</button>
        </div>
      </div>

      {!matrices.length && (
        <div className="text-[11px] rounded-md px-2 py-1.5" style={{ background: 'rgba(245,158,11,0.08)', color: '#FBBF24' }}>
          Cached run: the step matrices are only streamed live. Run the optimizer to watch the matrix re-cool between picks; the locked picks are shown.
        </div>
      )}

      <div className="overflow-x-auto scroll-thin">
        <div className="grid gap-[3px] text-[11px]" style={{ gridTemplateColumns: `108px repeat(${cols.length}, minmax(52px, 1fr))` }}>
          <div />
          {cols.map((c) => (
            <div key={c} className="text-center leading-tight pb-1 px-0.5" style={{ color: lockedCols.has(c) ? AMBER : c.startsWith('cut') ? '#FCA5A5' : '#9FB3A8' }}>
              <div className="text-[9px] uppercase tracking-wider opacity-70">{c.startsWith('cut') ? 'cut lane' : 'mark'}</div>
              <div className="font-medium truncate" title={names.get(c)}>{c.startsWith('mark') ? shortName(names.get(c) ?? c) : names.get(c) ?? c}</div>
            </div>
          ))}
          {rows.map((p) => (
            <RowCells key={p} presser={p} name={names.get(`p:${p}`) ?? String(p)} cols={cols} matrix={matrix} locked={locked}
              rowLocked={lockedPressers.has(p)} lockedCols={lockedCols} vmin={vmin} vmax={vmax} overlapMax={overlapMax}
              color={theirColor} reduced={reduced} setHover={setHover} />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-ink-2">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {steps.map((s, i) => (
            <span key={s.cell} className="flex items-center gap-1" style={{ opacity: i < step ? 1 : 0.35, transition: 'opacity 300ms' }}>
              <Num n={i + 1} on={i < step} /> {geneLabel(s.gene)} <span className="num text-ink-3">{s.marginal.toFixed(1)}</span>
            </span>
          ))}
        </div>
        <div className="shrink-0 pl-3">
          locked <span className="num text-ink">{step} of {nSteps}</span> · ΔC <span className="num font-semibold" style={{ color: AMBER }}><Ticker value={total} format={(v) => `${v.toFixed(1)}%`} /></span>
        </div>
      </div>
    </div>
  )
}

function Num({ n, on }: { n: number; on: boolean }) {
  return (
    <span className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[10px] font-bold num"
      style={{ background: on ? AMBER : 'transparent', color: on ? '#07120B' : '#9FB3A8', border: `1px solid ${on ? AMBER : 'rgba(255,255,255,0.25)'}` }}>{n}</span>
  )
}

function RowCells(props: {
  presser: number; name: string; cols: string[]; matrix?: GreedyMatrix; locked: Map<string, number>; rowLocked: boolean; lockedCols: Set<string>
  vmin: number; vmax: number; overlapMax: number; color: string; reduced: boolean; setHover: (r: string[]) => void
}) {
  const { presser, name, cols, matrix, locked, rowLocked, lockedCols, vmin, vmax, overlapMax, color, reduced, setHover } = props
  return (
    <>
      <div className="flex items-center pr-2 truncate font-medium" style={{ color: rowLocked ? AMBER : '#C7D4CC' }} title={name}>{shortName(name)}</div>
      {cols.map((c, j) => {
        const key = `${presser}:${c}`
        const lockNo = locked.get(key)
        const cell = matrix?.cells[key]
        const dead = !cell && !lockNo
        const t = cell ? (vmax - vmin > 1e-9 ? (cell.dC_mean - vmax) / (vmin - vmax) : 0.5) : 0
        const ov = cell?.overlap == null ? 1 : Math.max(0.25, Math.min(1, (cell.overlap ?? 0) / overlapMax))
        const bg = lockNo ? 'rgba(245,158,11,0.16)' : cell ? heatColor(color, 0.12 + 0.88 * t) : 'rgba(255,255,255,0.025)'
        const refsFor = () => {
          const pc = parseCell(key)
          return pc.action === 'cut' ? [`player:${presser}`, `edge:${pc.src}->${pc.dst}`] : [`player:${presser}`, `player:${pc.target}`]
        }
        return (
          <motion.div key={key} layout
            className="relative rounded-[5px] h-[34px] flex items-center justify-center num"
            initial={false}
            animate={{ backgroundColor: bg, opacity: dead ? (rowLocked || lockedCols.has(c) ? 0.25 : 0.4) : lockNo ? 1 : ov }}
            transition={reduced ? { duration: 0 } : { duration: 0.55, delay: j * 0.04, ease: [0.22, 1, 0.36, 1] }}
            style={{ border: lockNo ? `1.5px solid ${AMBER}` : '1px solid rgba(255,255,255,0.04)', color: t > 0.6 || lockNo ? '#fff' : '#C7D4CC', cursor: 'default' }}
            onMouseEnter={() => setHover(refsFor())} onMouseLeave={() => setHover([])}
            title={cell ? `ΔC ${cell.dC_mean.toFixed(2)}% ± ${cell.dC_std.toFixed(2)} · marginal ${cell.marginal.toFixed(2)}${cell.k != null ? ` · k ${cell.k.toFixed(2)}` : ''}${cell.overlap != null ? ` · overlap ${cell.overlap.toFixed(2)}` : ''}` : lockNo ? `locked pick ${lockNo}` : 'not in this step (presser or target already committed)'}>
            {lockNo ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: AMBER }}><Num n={lockNo} on /> </span>
            ) : cell ? (
              <span className="text-[11px] font-semibold">{cell.dC_mean.toFixed(1)}</span>
            ) : (
              <span className="text-ink-3">·</span>
            )}
          </motion.div>
        )
      })}
    </>
  )
}
