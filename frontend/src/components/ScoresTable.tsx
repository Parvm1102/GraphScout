import { motion } from 'framer-motion'
import Ticker from './Ticker'
import { useActiveHighlights, useStore, useTeamColor } from '../store'
import { refs } from '../api'
import { useReduced } from '../lib/motion'

/** Ranked squad table; rows re-order with a spring, S_p values count up. */
export default function ScoresTable() {
  const team = useStore((s) => s.team)
  const scores = useStore((s) => s.scores[s.team])
  const setHover = useStore((s) => s.setHover)
  const setSimSel = useStore((s) => s.setSimSel)
  const simSel = useStore((s) => s.simSel)
  const hl = useActiveHighlights()
  const color = useTeamColor()
  const reduced = useReduced()
  if (!scores) return <div className="text-[12px] text-ink-3">Loading scores…</div>
  const players = scores.players.slice().sort((a, b) => a.rank - b.rank)
  const maxS = Math.max(...players.map((p) => p.s_p_mean))
  const minS = Math.min(...players.map((p) => p.s_p_mean))
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="tbl">
        <thead>
          <tr>
            <th className="r">#</th><th>Player</th><th>Pos</th><th className="r">S_p</th><th className="r">± std</th>
            <th className="r" title="PageRank share">PR</th><th className="r" title="Betweenness share">BT</th><th className="r" title="Progressive involvement share">Prog</th><th className="r" title="Press resistance">Press</th>
            <th className="r">Min</th><th className="r">M</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const isHL = hl.has(refs.player(p.id))
            const isSel = simSel.target === p.id
            const t = maxS - minS > 1e-9 ? (p.s_p_mean - minS) / (maxS - minS) : 0.5
            return (
              <motion.tr key={p.id} layout transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 26 }}
                className={isHL || isSel ? 'row-hl' : ''} style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover([refs.player(p.id)])} onMouseLeave={() => setHover([])}
                onClick={() => setSimSel({ mode: 'suppress', target: isSel ? null : p.id })}
                title={`Click to pick ${p.name} as the simulation target`}>
                <td className="r num text-ink-3">{p.rank}</td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center justify-center rounded-full num font-bold text-[10px] text-white" style={{ width: 20, height: 20, background: color, opacity: 0.6 + 0.4 * t }}>{p.jersey}</span>
                    <span className="font-medium">{p.name}</span>
                  </span>
                </td>
                <td className="text-ink-3 text-[11px]">{abbrPos(p.position)}</td>
                <td className="r font-semibold"><Ticker value={p.s_p_mean} format={(v) => v.toFixed(2)} duration={0.6} /></td>
                <td className="r text-ink-3"><Ticker value={p.s_p_std} format={(v) => v.toFixed(2)} duration={0.6} /></td>
                <td className="r"><Ticker value={p.pr_share * 100} format={(v) => `${v.toFixed(1)}%`} /></td>
                <td className="r"><Ticker value={p.bt_share * 100} format={(v) => `${v.toFixed(1)}%`} /></td>
                <td className="r"><Ticker value={p.prog_share * 100} format={(v) => `${v.toFixed(1)}%`} /></td>
                <td className="r"><Ticker value={p.press_resist} format={(v) => v.toFixed(2)} /></td>
                <td className="r text-ink-3">{Math.round(p.minutes)}</td>
                <td className="r text-ink-3">{p.n_matches}</td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
      <div className="text-[10.5px] text-ink-3 mt-1.5">{team} · {players.length} players · shares are within-match means over each player's matches; press resistance is tournament-level, min-maxed within the squad.</div>
    </div>
  )
}

function abbrPos(p: string): string {
  return p.replace('Right ', 'R').replace('Left ', 'L').replace('Center ', 'C').replace('Centre ', 'C')
    .replace('Defensive Midfield', 'DM').replace('Attacking Midfield', 'AM').replace('Midfield', 'M').replace('Forward', 'F').replace('Back', 'B').replace('Wing', 'W').replace('Goalkeeper', 'GK')
}
