import { useMemo } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useStore } from '../store'
import { AMBER } from '../lib/pitch'
import { geneLabel } from '../lib/genes'
import { BasisBadge } from './Badge'

/** Total modeled ΔC per commitment (greedy order) with ±1 std band; the knee is marked. */
export default function CommitmentCurve() {
  const opt = useStore((s) => s.optimize)
  const steps = opt.greedy?.steps ?? opt.final?.greedy.steps ?? []
  const knee = opt.greedy?.knee ?? opt.final?.greedy.knee ?? 0
  const data = useMemo(() => [
    { c: 0, dC: 0, band: [0, 0] as [number, number], marginal: 0, label: 'no commitments' },
    ...steps.map((s, i) => ({ c: i + 1, dC: s.dC_mean, band: [s.dC_mean - s.dC_std, s.dC_mean + s.dC_std] as [number, number], marginal: s.marginal, label: geneLabel(s.gene) })),
  ], [steps])
  if (!steps.length) return null
  const kneePt = data.find((d) => d.c === knee)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="panel-title flex items-center gap-1.5">Commitment curve <BasisBadge basis="modeled" /></div>
        <div className="text-[11px] text-ink-3">total ΔC after each greedy pick, band = ±1 std over {opt.start?.match_ids.length ?? opt.final?.champion.verified.per_match.length ?? ''} matches · knee at <span className="num text-ink">{knee}</span></div>
      </div>
      <div style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 0, left: -14 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="c" type="number" domain={[0, steps.length]} ticks={data.map((d) => d.c)} tick={{ fill: '#9FB3A8', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false}
              label={{ value: 'commitments', position: 'insideBottomRight', offset: -2, fill: '#5F7369', fontSize: 10 }} />
            <YAxis tick={{ fill: '#9FB3A8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.15)' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload as (typeof data)[number]
              return (
                <div className="rounded-md px-2.5 py-1.5 text-[11px]" style={{ background: '#0B1A11', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <div className="font-semibold">{d.c === 0 ? 'Baseline' : `Pick ${d.c}: ${d.label}`}</div>
                  <div className="num text-ink-2">ΔC {d.dC.toFixed(2)}% · band {d.band[0].toFixed(1)} to {d.band[1].toFixed(1)}{d.c ? ` · marginal ${d.marginal.toFixed(2)}` : ''}</div>
                </div>
              )
            }} />
            <Area type="monotone" dataKey="band" stroke="none" fill={AMBER} fillOpacity={0.12} isAnimationActive animationDuration={700} />
            <Line type="monotone" dataKey="dC" stroke={AMBER} strokeWidth={2} dot={{ r: 3.5, fill: '#07120B', stroke: AMBER, strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive animationDuration={800} />
            {kneePt && <ReferenceDot x={kneePt.c} y={kneePt.dC} r={7} fill="none" stroke={AMBER} strokeWidth={1.5} label={{ value: 'knee', position: 'top', fill: AMBER, fontSize: 10, fontWeight: 600 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
