import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { type Weights } from '../api'

const DEFAULTS: Weights = { pr: 0.3, bt: 0.3, prog: 0.25, press_resist: 0.15 }
const LABELS: { key: keyof Weights; name: string; hint: string }[] = [
  { key: 'pr', name: 'PageRank share', hint: 'how much of the team\'s pass flow routes through the player' },
  { key: 'bt', name: 'Betweenness share', hint: 'how often the player sits on shortest pass paths' },
  { key: 'prog', name: 'Progressive involvement', hint: 'share of progressive passes made or received' },
  { key: 'press_resist', name: 'Press resistance', hint: 'completion under pressure minus overall, min-maxed in squad' },
]

/** Four weights for S_p. Normalised to sum 1 before querying /api/scores so the scale stays comparable. */
export default function WeightSliders() {
  const weights = useStore((s) => s.weights)
  const setWeights = useStore((s) => s.setWeights)
  const [local, setLocal] = useState<Weights>(weights)
  const timer = useRef<number | null>(null)
  useEffect(() => setLocal(weights), [weights])

  const sum = Object.values(local).reduce((a, b) => a + b, 0) || 1
  const push = (w: Weights) => {
    setLocal(w)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const s = Object.values(w).reduce((a, b) => a + b, 0) || 1
      const norm = { pr: +(w.pr / s).toFixed(3), bt: +(w.bt / s).toFixed(3), prog: +(w.prog / s).toFixed(3), press_resist: +(w.press_resist / s).toFixed(3) }
      void setWeights(norm)
    }, 220)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="panel-title">Composite score S_p · weights</div>
          <div className="text-[11px] text-ink-3">S_p = Σ wᵢ · z(shareᵢ), z within match, mean over matches. Drag to re-rank; the pitch circles resize.</div>
        </div>
        <button className="btn" onClick={() => push(DEFAULTS)} disabled={Object.keys(DEFAULTS).every((k) => Math.abs(local[k as keyof Weights] - DEFAULTS[k as keyof Weights]) < 1e-6)}>Reset</button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {LABELS.map(({ key, name, hint }) => (
          <label key={key} className="flex flex-col gap-0.5" title={hint}>
            <span className="flex justify-between text-[11px]">
              <span className="text-ink-2">{name}</span>
              <span className="num text-ink">{(local[key] / sum).toFixed(2)}</span>
            </span>
            <input type="range" min={0} max={1} step={0.05} value={local[key]} onChange={(e) => push({ ...local, [key]: Number(e.target.value) })} aria-label={name} />
          </label>
        ))}
      </div>
    </div>
  )
}
