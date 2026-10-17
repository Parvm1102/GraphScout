import Ticker from './Ticker'
import { useStore } from '../store'
import { BasisBadge } from './Badge'

/** Circulation components for the current selection, with count-up tickers. */
export default function NetworkStats() {
  const network = useStore((s) => s.network)
  const sim = useStore((s) => s.simResult)
  const selected = useStore((s) => s.selectedMatch)
  const after = useStore((s) => s.networkAfter)
  const pm = sim?.per_match.find((p) => p.match_id === selected)
  const showAfter = !!after && !!pm
  if (!network) return null
  const comp = network.components
  const cells: { label: string; before: number; after?: number }[] = [
    { label: 'M · max-flow', before: comp.M, after: showAfter ? pm.M_after : undefined },
    { label: 'V · progressive', before: comp.V, after: showAfter ? pm.V_after : undefined },
    { label: 'D · depth', before: comp.D, after: showAfter ? pm.D_after : undefined },
  ]
  return (
    <div className="grid grid-cols-5 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="panel px-3 py-2">
          <div className="panel-title">{c.label}</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`text-[20px] font-semibold ${c.after != null ? 'text-ink-3 line-through decoration-1' : ''}`}><Ticker value={c.before} format={(v) => Math.round(v).toString()} /></span>
            {c.after != null && <span className="text-[20px] font-semibold"><Ticker value={c.after} format={(v) => Math.round(v).toString()} /></span>}
          </div>
        </div>
      ))}
      <div className="panel px-3 py-2">
        <div className="panel-title">Passes</div>
        <div className="mt-0.5 text-[13px]">
          <Ticker value={network.totals.completed} format={(v) => Math.round(v).toString()} /> of <Ticker value={network.totals.count} format={(v) => Math.round(v).toString()} />
          <span className="text-ink-3"> · </span>
          <Ticker value={network.totals.progressive} format={(v) => Math.round(v).toString()} /> <span className="text-ink-3">prog.</span>
        </div>
      </div>
      <div className="panel px-3 py-2">
        <div className="panel-title flex items-center gap-1.5">ΔC {showAfter ? <BasisBadge basis="modeled" /> : null}</div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-[20px] font-semibold" style={{ color: showAfter ? 'var(--team)' : '#5F7369' }}>
            {showAfter ? <Ticker value={pm.dC_pct} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} duration={0.9} /> : '—'}
          </span>
          <span className="text-[11px] text-ink-3">this match</span>
        </div>
      </div>
    </div>
  )
}
