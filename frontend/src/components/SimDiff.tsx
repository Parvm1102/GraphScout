import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Ticker from './Ticker'
import { BasisBadge } from './Badge'
import { useStore, useTeamColor, useOtherColor } from '../store'
import { refs } from '../api'
import { useReduced } from '../lib/motion'
import { shortName } from './PitchCanvas'

/** Simulate panel: pick a target (pitch or list), optionally a presser, run /api/simulate, read the diff. */
export default function SimDiff() {
  const team = useStore((s) => s.team)
  const our = useStore((s) => s.our)
  const their = useStore((s) => s.their)
  const scores = useStore((s) => s.scores)
  const profile = useStore((s) => s.profile)
  const network = useStore((s) => s.network)
  const sel = useStore((s) => s.simSel)
  const setSel = useStore((s) => s.setSimSel)
  const run = useStore((s) => s.runSimulate)
  const clear = useStore((s) => s.clearSim)
  const result = useStore((s) => s.simResult)
  const loading = useStore((s) => s.simLoading)
  const error = useStore((s) => s.simError)
  const selectedMatch = useStore((s) => s.selectedMatch)
  const view = useStore((s) => s.simView)
  const setView = useStore((s) => s.setSimView)
  const setHover = useStore((s) => s.setHover)
  const teamColor = useTeamColor()
  const otherColor = useOtherColor()
  const reduced = useReduced()

  const other = team === our ? their : our
  const targets = useMemo(() => (scores[team]?.players ?? []).slice().sort((a, b) => b.s_p_mean - a.s_p_mean).slice(0, 8), [scores, team])
  const pressers = useMemo(() => (scores[other]?.players ?? []).slice().sort((a, b) => (b.pressures ?? 0) - (a.pressures ?? 0)).slice(0, 6), [scores, other])
  const lanes = useMemo(() => {
    const fromProfile = profile?.team === team ? profile.top_progressive_lanes : []
    if (fromProfile.length) return fromProfile.slice(0, 6)
    const names = new Map(network?.players.map((p) => [p.id, p.name]) ?? [])
    return (network?.edges ?? []).slice().sort((a, b) => b.progressive - a.progressive).slice(0, 6)
      .map((e) => ({ src: e.src, dst: e.dst, src_name: names.get(e.src) ?? String(e.src), dst_name: names.get(e.dst) ?? String(e.dst), progressive: e.progressive, completed: e.completed }))
  }, [profile, team, network])
  const nameOf = (id: number) => scores[team]?.players.find((p) => p.id === id)?.name ?? network?.players.find((p) => p.id === id)?.name ?? `#${id}`

  const canRun = sel.mode === 'suppress' ? sel.target != null : sel.edge != null
  const onRun = () => {
    if (!canRun) return
    void run([
      sel.mode === 'suppress'
        ? { type: 'suppress', target_player: sel.target!, ...(sel.presser != null ? { presser: sel.presser } : {}) }
        : { type: 'cut_lane', edge: sel.edge!, ...(sel.presser != null ? { presser: sel.presser } : {}) },
    ])
  }

  const pm = result?.per_match.find((p) => p.match_id === selectedMatch)
  const emp = result?.empirical.find((e) => e.available)
  const plan0 = result?.plan[0]

  return (
    <div className="panel p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="panel-title">Simulate</div>
        <div className="flex gap-1 rounded-full border border-white/10 p-0.5">
          {(['suppress', 'cut_lane'] as const).map((m) => (
            <button key={m} className="chip" data-on={sel.mode === m} style={{ border: 'none' }} onClick={() => setSel({ mode: m })}>
              {m === 'suppress' ? 'Mark a player' : 'Cut a lane'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: '3fr 2fr' }}>
      {sel.mode === 'suppress' ? (
        <div>
          <div className="text-[11px] text-ink-3 mb-1.5">Target · {team} by composite score S_p (click a circle on the pitch, or pick)</div>
          <div className="flex flex-wrap gap-1">
            {targets.map((p) => (
              <button key={p.id} className="chip flex items-center gap-1.5" data-on={sel.target === p.id}
                style={sel.target === p.id ? { borderColor: teamColor, background: `${teamColor}2E`, color: '#E7EEE9' } : undefined}
                onClick={() => setSel({ target: p.id })}
                onMouseEnter={() => setHover([refs.player(p.id)])} onMouseLeave={() => setHover([])}>
                <span className="num text-[10px] opacity-70">{p.jersey}</span>{shortName(p.name)}
                <span className="num text-[10px] opacity-70">{p.s_p_mean.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[11px] text-ink-3 mb-1.5">Lane · most progressive {team} lanes (or click a pass path)</div>
          <div className="flex flex-wrap gap-1">
            {lanes.map((l) => {
              const on = sel.edge?.src === l.src && sel.edge?.dst === l.dst
              return (
                <button key={`${l.src}-${l.dst}`} className="chip flex items-center gap-1.5" data-on={on}
                  style={on ? { borderColor: teamColor, background: `${teamColor}2E`, color: '#E7EEE9' } : undefined}
                  onClick={() => setSel({ edge: { src: l.src, dst: l.dst } })}
                  onMouseEnter={() => setHover([refs.edge(l.src, l.dst)])} onMouseLeave={() => setHover([])}>
                  {shortName(l.src_name)} <span className="opacity-60">→</span> {shortName(l.dst_name)}
                  <span className="num text-[10px] opacity-70">{l.progressive} of {l.completed}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] text-ink-3 mb-1.5">Presser · {other} (optional, sets k)</div>
        <div className="flex flex-wrap gap-1">
          <button className="chip" data-on={sel.presser == null} onClick={() => setSel({ presser: null })}>none · default k</button>
          {pressers.map((p) => (
            <button key={p.id} className="chip flex items-center gap-1.5" data-on={sel.presser === p.id}
              style={sel.presser === p.id ? { borderColor: otherColor, background: `${otherColor}2E`, color: '#E7EEE9' } : undefined}
              onClick={() => setSel({ presser: p.id })}>
              {shortName(p.name)} <span className="num text-[10px] opacity-70">{p.pressures ?? 0} pr.</span>
            </button>
          ))}
        </div>
      </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn btn-team" disabled={!canRun || loading} onClick={onRun}>{loading ? 'Simulating…' : 'Simulate'}</button>
        {result && (
          <>
            <div className="flex gap-0.5 rounded-full border border-white/10 p-0.5">
              {(['before', 'after'] as const).map((v) => (
                <button key={v} className="chip" data-on={view === v} style={{ border: 'none' }} onClick={() => setView(v)}>{v}</button>
              ))}
            </div>
            <button className="btn" onClick={clear}>Reset</button>
          </>
        )}
        {error && <span className="text-[11px]" style={{ color: '#FCA5A5' }}>{error}</span>}
      </div>

      <AnimatePresence initial={false}>
        {result && pm && (
          <motion.div key="res" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.3 }} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="flex items-center gap-1.5 panel-title">ΔC · mean over {result.aggregate.n} matches <BasisBadge basis="modeled" /></div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-[26px] font-semibold" style={{ color: teamColor }}>
                    <Ticker value={result.aggregate.dC_mean} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} duration={0.9} />
                  </span>
                  <span className="text-[12px] text-ink-2">± <Ticker value={result.aggregate.dC_std} format={(v) => v.toFixed(1)} /></span>
                </div>
                <div className="text-[11px] text-ink-3 mt-1">
                  this match <span className="num text-ink"><Ticker value={pm.dC_pct} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} /></span>
                  {plan0 && <> · k <span className="num text-ink">{plan0.k.toFixed(2)}</span> <span className="opacity-70">({plan0.k_source})</span></>}
                </div>
              </div>
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(96,165,250,0.06)' }}>
                <div className="flex items-center gap-1.5 panel-title">ΔC · observed absence <BasisBadge basis="empirical" /></div>
                {emp && emp.dC_pct != null ? (
                  <>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-[26px] font-semibold" style={{ color: '#93C5FD' }}>
                        <Ticker value={emp.dC_pct} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} duration={0.9} />
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-3 mt-1">
                      <span className="num text-ink">{Math.round(emp.absent_minutes ?? 0)}</span> absent min vs <span className="num text-ink">{Math.round(emp.comparable_minutes ?? 0)}</span> present
                      {emp.c_per_min_absent != null && <> · C/min <span className="num text-ink">{emp.c_per_min_absent.toFixed(2)}</span> vs <span className="num text-ink">{emp.c_per_min_present?.toFixed(2)}</span></>}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-ink-3 mt-2">No absence window for this target in the tournament, so there is no empirical check. Only the modeled figure applies.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[12px]">
              {([['M', pm.M_before, pm.M_after], ['V', pm.V_before, pm.V_after], ['D', pm.D_before, pm.D_after]] as const).map(([k, b, a]) => (
                <div key={k} className="flex items-baseline gap-1.5 rounded-md px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <span className="text-ink-3 font-semibold">{k}</span>
                  <span className="num text-ink-3"><Ticker value={b} format={(v) => Math.round(v).toString()} /></span>
                  <span className="text-ink-3">→</span>
                  <span className="num font-semibold"><Ticker value={a} format={(v) => Math.round(v).toString()} /></span>
                  <span className="num text-[10px] ml-auto" style={{ color: a < b ? teamColor : '#9FB3A8' }}>{a - b > 0 ? '+' : ''}{a - b}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="panel-title mb-1.5">Who inherits the betweenness · this match</div>
              <div className="flex flex-col gap-1">
                {pm.inheritance.slice(0, 5).map((h) => {
                  const w = Math.min(100, Math.abs(h.delta) * 600)
                  return (
                    <div key={h.player} className="flex items-center gap-2 text-[12px]" onMouseEnter={() => setHover([refs.player(h.player)])} onMouseLeave={() => setHover([])}>
                      <span className="w-[120px] truncate">{h.name}</span>
                      <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <motion.div className="h-full rounded-full" style={{ background: h.delta >= 0 ? teamColor : '#5F7369' }}
                          initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20, duration: reduced ? 0 : undefined }} />
                      </div>
                      <span className="num w-[108px] text-right text-ink-2">
                        {(h.old_BT_share * 100).toFixed(1)}% → <span className="text-ink"><Ticker value={h.new_BT_share * 100} format={(v) => `${v.toFixed(1)}%`} /></span>
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="text-[10.5px] text-ink-3 mt-1.5">
                {pm.removed} passes removed, {pm.redistributed} redistributed onto observed lanes (dashed = estimated). {nameOf(plan0?.target_player ?? -1) !== `#-1` && plan0?.type === 'suppress' ? `${nameOf(plan0.target_player!)} fades to 30%.` : ''}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
