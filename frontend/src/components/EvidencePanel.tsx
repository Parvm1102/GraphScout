import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { api, type AblationBlock, type AblationResponse, type EvalResponse, type ExpertAgreement } from '../api'
import { useStore } from '../store'
import { AMBER, TEAM_BLUE, TEAM_RED } from '../lib/pitch'
import { BasisBadge } from './Badge'
import Ticker from './Ticker'

const CHALK = 'rgba(255,255,255,0.45)'

export default function EvidencePanel() {
  const our = useStore((s) => s.our)
  const their = useStore((s) => s.their)
  const setHover = useStore((s) => s.setHover)
  const optFinal = useStore((s) => s.optimize.final)
  const [ev, setEv] = useState<EvalResponse | null>(null)
  const [abl, setAbl] = useState<AblationResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    const onErr = (e: Error) => { if (e.name !== 'AbortError') setErr(e.message) }
    api.evals(ac.signal).then(setEv).catch(onErr)
    api.ablation(our, their, ac.signal).then(setAbl).catch(onErr)
    return () => ac.abort()
  }, [our, their])

  const available = !!ev && ev.available !== false
  const comparison = ev?.evolved_vs_greedy?.comparison ?? optFinal?.comparison ?? abl?.comparison

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[14px] font-semibold">Evidence · every metric beside its baseline</div>
        <div className="text-[11px] text-ink-3">{ev?.reporting_rules ?? 'counts beside percentages; every metric beside its baseline; fixed seeds (42)'}. Allowed claims: {ev?.calibration?.allowed_claims.join(' · ') ?? 'agrees with elite targeting out-of-sample · predicts structural impact of real absences · objective tracks xG'}.</div>
      </div>
      {err && <div className="text-[12px]" style={{ color: '#FCA5A5' }}>{err}</div>}
      {!available && ev && (
        <div className="text-[11.5px] rounded-md px-3 py-2" style={{ background: 'rgba(245,158,11,0.08)', color: '#FBBF24' }}>
          Evaluations have not been run yet ({ev.note ?? 'run scripts/run_evals.py'}). The score-ablation chart below needs no eval run; the expert-agreement, absence-prediction and C-vs-xG panels appear once the evals exist.
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr' }}>
        {available && ev?.expert_agreement_demo && <ExpertCard demo={ev.expert_agreement_demo} all={ev.expert_agreement_all ?? null} folds={ev.expert_folds_demo ?? []} setHover={setHover} />}
        {abl && <AblationCard inSample={abl.score_ablation_in_sample} heldOut={abl.score_ablation_held_out} theirColor={TEAM_RED} setHover={setHover} />}
        {comparison && comparison.length > 0 && <GreedyCard comparison={comparison} our={our} their={their} />}
        {available && ev?.c_vs_xg && <XgCard c={ev.c_vs_xg} absence={ev.absence_prediction ?? null} />}
      </div>
    </div>
  )
}

function Card({ title, sub, children, basis }: { title: string; sub?: string; children: React.ReactNode; basis?: 'modeled' | 'empirical' }) {
  return (
    <div className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div>
        <div className="panel-title flex items-center gap-1.5">{title} {basis && <BasisBadge basis={basis} />}</div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function ExpertCard({ demo, all, folds, setHover }: { demo: ExpertAgreement; all: ExpertAgreement | null; folds: EvalResponse['expert_folds_demo'] & object; setHover: (r: string[]) => void }) {
  const [scope, setScope] = useState<'demo' | 'all'>('demo')
  const a = scope === 'all' && all ? all : demo
  const data = [
    { name: 'Graph Scout', rate: a.hit_rate * 100, label: `${a.hits} of ${a.n}`, fill: AMBER },
    { name: 'Chance', rate: a.chance_rate_analytic * 100, label: `${(a.chance_rate_analytic * 100).toFixed(0)}% analytic · ${(a.chance_rate_permutation * 100).toFixed(0)}% permuted`, fill: CHALK },
    { name: 'Most touches', rate: a.most_touches_rate * 100, label: `${a.most_touches_hits} of ${a.n}`, fill: 'rgba(255,255,255,0.22)' },
  ]
  return (
    <Card title="4E.1 · Expert agreement, leave-one-out" basis="empirical"
      sub={`Does the blind top pick match the target elite staffs actually pressed? Hit rate vs chance and vs a most-touches heuristic · permutation p = ${a.permutation_p_value.toFixed(2)} · mean Spearman ${a.spearman_mean.toFixed(2)}`}>
      <div className="flex gap-1">
        <button className="chip" data-on={scope === 'demo'} onClick={() => setScope('demo')}>demo teams · n {demo.n}</button>
        {all && <button className="chip" data-on={scope === 'all'} onClick={() => setScope('all')}>all teams · n {all.n}</button>}
      </div>
      <div style={{ height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 190, bottom: 0, left: 0 }}>
            <XAxis type="number" domain={[0, 50]} hide />
            <YAxis type="category" dataKey="name" width={96} tick={{ fill: '#C7D4CC', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Bar dataKey="rate" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive animationDuration={700}>
              {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
              <LabelList dataKey="label" position="right" formatter={(v: unknown) => String(v)} style={{ fill: '#E7EEE9', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[11px] num">
        hit rate <span className="font-semibold" style={{ color: AMBER }}><Ticker value={a.hit_rate * 100} format={(v) => `${v.toFixed(1)}%`} /></span> ({a.hits} of {a.n}) vs chance <span className="text-ink">{(a.chance_rate_analytic * 100).toFixed(1)}%</span> vs most-touches <span className="text-ink">{(a.most_touches_rate * 100).toFixed(1)}%</span> ({a.most_touches_hits} of {a.n})
      </div>
      {scope === 'demo' && folds.length > 0 && (
        <div className="flex flex-wrap gap-1" title="one square per held-out match; filled = top pick matched">
          {folds.map((f) => (
            <span key={`${f.team}-${f.match_id}`} className="inline-block rounded-[3px] cursor-default" style={{ width: 14, height: 14, background: f.hit ? AMBER : 'rgba(255,255,255,0.1)', border: `1px solid ${f.hit ? AMBER : 'rgba(255,255,255,0.18)'}` }}
              onMouseEnter={() => setHover([`match:${f.match_id}`])} onMouseLeave={() => setHover([])}
              title={`${f.team} · match ${f.match_id} · predicted ${f.prediction} · truth rank ${f.truth_rank} of ${f.n} · ${f.hit ? 'hit' : 'miss'}`} />
          ))}
          <span className="text-[10.5px] text-ink-3 ml-1">{folds.filter((f) => f.hit).length} of {folds.length} held-out matches hit</span>
        </div>
      )}
    </Card>
  )
}

function AblationCard({ inSample, heldOut, theirColor, setHover }: { inSample: AblationBlock; heldOut?: AblationBlock; theirColor: string; setHover: (r: string[]) => void }) {
  const [variant, setVariant] = useState<'in' | 'out'>('in')
  const b = variant === 'out' && heldOut ? heldOut : inSample
  const pts = useMemo(() => b.rows.flatMap((r, i) => [
    { x: 1 + ((i % 5) - 2) * 0.06, y: r.top.dC, kind: 'top', name: r.top.name, team: r.team, match: r.match_id },
    { x: 2 + ((i % 5) - 2) * 0.06, y: r.median.dC, kind: 'median', name: r.median.name, team: r.team, match: r.match_id },
  ]), [b])
  return (
    <Card title="Score ablation · top-S_p vs median player" basis="modeled"
      sub={`Suppress (k = ${b.k}) the top-ranked player vs the median-ranked one in each of ${b.n} matches. Top more damaging in ${b.top_more_damaging_in} of ${b.n}.`}>
      <div className="flex gap-1">
        <button className="chip" data-on={variant === 'in'} onClick={() => setVariant('in')}>in-sample</button>
        {heldOut && <button className="chip" data-on={variant === 'out'} onClick={() => setVariant('out')}>held-out ranking</button>}
      </div>
      <div style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
            <XAxis type="number" dataKey="x" domain={[0.5, 2.5]} ticks={[1, 2]} tickFormatter={(v: number) => (v === 1 ? 'top S_p' : 'median S_p')} tick={{ fill: '#C7D4CC', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
            <YAxis type="number" dataKey="y" tick={{ fill: '#9FB3A8', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
            <ZAxis range={[36, 36]} />
            <Tooltip cursor={false} content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload as (typeof pts)[number]
              return <div className="rounded-md px-2 py-1 text-[11px] num" style={{ background: '#0B1A11', border: '1px solid rgba(255,255,255,0.12)' }}>{d.name} · {d.team} · {d.match} · ΔC {d.y.toFixed(1)}%</div>
            }} />
            <ReferenceLine segment={[{ x: 0.75, y: b.top_mean }, { x: 1.25, y: b.top_mean }]} stroke={theirColor} strokeWidth={2} />
            <ReferenceLine segment={[{ x: 1.75, y: b.median_mean }, { x: 2.25, y: b.median_mean }]} stroke={CHALK} strokeWidth={2} />
            <Scatter data={pts} isAnimationActive animationDuration={600} onMouseEnter={(d: unknown) => { const p = d as { payload?: (typeof pts)[number] }; if (p.payload) setHover([`match:${p.payload.match}`]) }} onMouseLeave={() => setHover([])}>
              {pts.map((p, i) => <Cell key={i} fill={p.kind === 'top' ? theirColor : CHALK} fillOpacity={0.8} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[11px] num">
        top-S_p mean <span className="font-semibold" style={{ color: theirColor }}><Ticker value={b.top_mean} format={(v) => `${v.toFixed(1)}%`} /></span> ± {b.top_std.toFixed(1)} · median-player mean <span className="text-ink font-semibold"><Ticker value={b.median_mean} format={(v) => `${v.toFixed(1)}%`} /></span> ± {b.median_std.toFixed(1)} · n {b.n}
      </div>
    </Card>
  )
}

function GreedyCard({ comparison, our, their }: { comparison: NonNullable<EvalResponse['evolved_vs_greedy']>['comparison'] & object; our: string; their: string }) {
  const data = comparison.map((c) => ({ budget: `${c.budget}`, greedy: c.greedy_dC ?? 0, ga: c.ga_dC ?? 0 }))
  const min = Math.floor(Math.min(0, ...data.flatMap((d) => [d.greedy, d.ga])) * 1.15 / 5) * 5
  return (
    <Card title={`Evolved vs greedy at equal budget · ${our} v ${their}`} basis="modeled" sub="Best plan found per commitment budget; the GA is reported as matching greedy where it did not beat it.">
      <div className="grid gap-3" style={{ gridTemplateColumns: '3fr 2fr' }}>
        <div style={{ height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }} barGap={3}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="budget" tick={{ fill: '#C7D4CC', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} label={{ value: 'commitments', position: 'insideBottomRight', offset: -2, fill: '#5F7369', fontSize: 10 }} />
              <YAxis domain={[min, 0]} tick={{ fill: '#9FB3A8', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v)}%`} allowDecimals={false} />
              <Bar dataKey="greedy" name="greedy" fill={CHALK} radius={[3, 3, 0, 0]} isAnimationActive animationDuration={700} />
              <Bar dataKey="ga" name="evolved" fill={AMBER} radius={[3, 3, 0, 0]} isAnimationActive animationDuration={700} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="tbl self-start">
          <thead><tr><th className="r">budget</th><th className="r">greedy</th><th className="r" style={{ color: AMBER }}>evolved</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.budget}><td className="r num">{d.budget}</td><td className="r num text-ink-2">{d.greedy.toFixed(1)}%</td><td className="r num font-semibold" style={{ color: AMBER }}>{d.ga.toFixed(1)}%</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-[10.5px] text-ink-3">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: AMBER }} /> evolved (GA)</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: CHALK }} /> greedy</span>
        <span className="ml-auto num">ΔC % mean over {their} matches</span>
      </div>
    </Card>
  )
}

function XgCard({ c, absence }: { c: NonNullable<EvalResponse['c_vs_xg']>; absence: EvalResponse['absence_prediction'] }) {
  const subsets = absence?.subsets ? Object.entries(absence.subsets) : []
  const absData = subsets.map(([name, b]) => ({ name: name.replace(/\s*\(.*\)/, '').replace(/_/g, ' '), detail: name.replace(/_/g, ' '), model: b.mae, zero: b.mae_always_zero, n: b.n, beats: b.beats_zero_forecaster, r: b.pearson_r }))
  return (
    <Card title="4E.3 · Construct validity (C vs xG) and 4E.2 · absence prediction" basis="empirical"
      sub={`Does circulation C track chance creation? n = ${c.n} team-matches. Correlation, not causation.`}>
      {c.points?.length ? (
        <div style={{ height: 150 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" dataKey="C" name="C" tick={{ fill: '#9FB3A8', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
              <YAxis type="number" dataKey="xg" name="xG" tick={{ fill: '#9FB3A8', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Scatter data={c.points} fill={TEAM_BLUE} fillOpacity={0.7} isAnimationActive animationDuration={600} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-w-[460px]">
          <Tile label="Pearson r" value={c.pearson_r} fmt={(v) => v.toFixed(2)} note={`p ${c.pearson_p < 0.001 ? '< 0.001' : c.pearson_p.toFixed(3)}`} />
          <Tile label="Spearman ρ" value={c.spearman_r} fmt={(v) => v.toFixed(2)} note={`p ${c.spearman_p < 0.001 ? '< 0.001' : c.spearman_p.toFixed(3)}`} />
          <Tile label="Baseline" value={0} fmt={() => 'r = 0'} note={`null · n ${c.n}`} dim />
        </div>
      )}
      {absence && absData.length > 0 && (
        <>
          <div className="text-[11px] text-ink-3 mt-1">4E.2 · predicted vs observed ΔC for real absences (n {absence.n}): mean absolute error of the model beside an always-zero forecaster.</div>
          <div style={{ height: 110 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={absData} layout="vertical" margin={{ top: 2, right: 90, bottom: 0, left: 0 }} barGap={2}>
                <XAxis type="number" hide domain={[0, Math.max(...absData.flatMap((d) => [d.model, d.zero])) * 1.1]} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fill: '#C7D4CC', fontSize: 10.5 }} axisLine={false} tickLine={false} />
                <Bar dataKey="model" name="model MAE" fill={TEAM_BLUE} barSize={10} radius={[0, 3, 3, 0]} isAnimationActive animationDuration={600}>
                  <LabelList dataKey="model" position="right" formatter={(v: unknown) => `MAE ${Number(v).toFixed(1)}`} style={{ fill: '#93C5FD', fontSize: 10 }} />
                </Bar>
                <Bar dataKey="zero" name="always-zero MAE" fill={CHALK} barSize={10} radius={[0, 3, 3, 0]} isAnimationActive animationDuration={600}>
                  <LabelList dataKey="zero" position="right" formatter={(v: unknown) => `zero ${Number(v).toFixed(1)}`} style={{ fill: '#9FB3A8', fontSize: 10 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10.5px] text-ink-3 num">
            {absData.map((d) => <span key={d.name} className="block">{d.detail}: n {d.n}, r {d.r.toFixed(2)}, {d.beats ? 'beats' : 'does not beat'} the zero forecaster</span>)}
          </div>
        </>
      )}
    </Card>
  )
}

function Tile({ label, value, fmt, note, dim }: { label: string; value: number; fmt: (v: number) => string; note?: string; dim?: boolean }) {
  return (
    <div className="rounded-md px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <div className="panel-title">{label}</div>
      <div className="text-[20px] font-semibold" style={{ color: dim ? '#5F7369' : '#93C5FD' }}><Ticker value={value} format={fmt} /></div>
      {note && <div className="text-[10.5px] text-ink-3 num">{note}</div>}
    </div>
  )
}
