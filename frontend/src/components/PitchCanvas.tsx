import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import PitchMarkings from './PitchMarkings'
import { type Edge, type Gene, type GeneMark, type PlanItem, isCut } from '../api'
import { useActiveHighlights, useStore, type Pos } from '../store'
import { useReduced } from '../lib/motion'
import {
  AMBER, CUT_RED, DUR, SPRING, arrowPath, edgeColor, edgePath, pathLength, radiusFor, widthFor, type Pt,
} from '../lib/pitch'

export interface PitchPlayer { id: number; name: string; jersey?: number; x: number; y: number; score: number; position?: string }

interface Props {
  players: PitchPlayer[]
  edges: Edge[]
  teamColor: string
  plan?: PlanItem[] | null
  genes?: Gene[] | null
  otherPositions?: Record<number, Pos>
  onPlayerClick?: (id: number) => void
  onEdgeClick?: (src: number, dst: number) => void
  selectedPlayer?: number | null
  selectedEdge?: { src: number; dst: number } | null
  compact?: boolean
  particles?: boolean
  idPrefix?: string
  className?: string
}

const MAX_PARTICLES = 120

export default function PitchCanvas({
  players, edges, teamColor, plan, genes, otherPositions = {}, onPlayerClick, onEdgeClick,
  selectedPlayer, selectedEdge, compact = false, particles = true, idPrefix = 'p', className,
}: Props) {
  const reduced = useReduced()
  const hl = useActiveHighlights()
  const setHover = useStore((s) => s.setHover)
  const [hovered, setHovered] = useState<number | null>(null)

  const byId = useMemo(() => {
    const m = new Map<number, PitchPlayer>()
    players.forEach((p) => m.set(p.id, p))
    return m
  }, [players])

  const [lo, hi] = useMemo(() => {
    const v = players.map((p) => p.score).filter(Number.isFinite)
    return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1]
  }, [players])
  const rOf = (p: PitchPlayer) => (compact ? radiusFor(p.score, lo, hi) * 0.8 : radiusFor(p.score, lo, hi))

  const maxCompleted = useMemo(() => Math.max(1, ...edges.map((e) => e.completed)), [edges])

  // highlight sets
  const hlPlayers = useMemo(() => { const s = new Set<number>(); hl.forEach((r) => { if (r.startsWith('player:')) s.add(Number(r.slice(7))) }); return s }, [hl])
  const hlEdges = useMemo(() => { const s = new Set<string>(); hl.forEach((r) => { if (r.startsWith('edge:')) s.add(r.slice(5)) }); return s }, [hl])
  const hlEdgeEnds = useMemo(() => { const s = new Set<number>(); hlEdges.forEach((k) => { const [a, b] = k.split('->'); s.add(Number(a)); s.add(Number(b)) }); return s }, [hlEdges])
  const hasHL = hlPlayers.size + hlEdges.size > 0

  // simulation overlays
  const suppressed = useMemo(() => {
    const m = new Map<number, { presser?: number; k: number; deleted: boolean }>()
    plan?.forEach((p) => { if ((p.type === 'suppress' || p.type === 'delete') && p.target_player != null) m.set(p.target_player, { presser: p.presser, k: p.k, deleted: p.type === 'delete' }) })
    genes?.forEach((g) => { if (!isCut(g)) m.set((g.target as GeneMark).id, { presser: g.presser.id, k: g.k, deleted: false }) })
    return m
  }, [plan, genes])
  const cutLanes = useMemo(() => {
    const m = new Map<string, number | undefined>()
    plan?.forEach((p) => { if (p.type === 'cut_lane' && p.edge) m.set(`${p.edge.src}->${p.edge.dst}`, p.presser) })
    genes?.forEach((g) => { if (isCut(g)) m.set(`${g.target.src}->${g.target.dst}`, g.presser.id) })
    return m
  }, [plan, genes])
  const pressers = useMemo(() => {
    const ids = new Set<number>()
    suppressed.forEach((v) => { if (v.presser != null) ids.add(v.presser) })
    cutLanes.forEach((v) => { if (v != null) ids.add(v) })
    return [...ids].map((id) => otherPositions[id]).filter((p): p is Pos => !!p)
  }, [suppressed, cutLanes, otherPositions])

  // edges with geometry
  const drawn = useMemo(() => {
    return edges
      .map((e, i) => {
        const a = byId.get(e.src), b = byId.get(e.dst)
        if (!a || !b || a.id === b.id) return null
        const pa: Pt = { x: a.x, y: a.y }, pb: Pt = { x: b.x, y: b.y }
        const shorten = rOf(b) + 0.3
        const progShare = e.completed > 0 ? e.progressive / e.completed : 0
        return {
          key: `${e.src}->${e.dst}`, e, i,
          d: edgePath(pa, pb, 0.16, shorten), arrow: arrowPath(pa, pb, 0.16, shorten, 1.0 + widthFor(e.completed, maxCompleted) * 0.6),
          w: widthFor(e.completed, maxCompleted), color: edgeColor(teamColor, progShare), len: pathLength(pa, pb),
        }
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, byId, maxCompleted, teamColor, lo, hi, compact])

  // particle allocation (density ∝ count, capped)
  const particleAlloc = useMemo(() => {
    if (!particles || reduced || compact) return new Map<string, number>()
    const total = drawn.reduce((s, d) => s + d.e.count, 0) || 1
    const m = new Map<string, number>()
    let used = 0
    const sorted = [...drawn].sort((a, b) => b.e.count - a.e.count)
    for (const d of sorted) {
      const n = Math.floor((MAX_PARTICLES * d.e.count) / total)
      if (n > 0) { m.set(d.key, n); used += n }
    }
    for (const d of sorted) { if (used >= MAX_PARTICLES) break; if (!m.has(d.key) && d.e.count >= 2) { m.set(d.key, 1); used++ } }
    return m
  }, [drawn, particles, reduced, compact])

  const edgeOpacity = (key: string, src: number, dst: number, w = 0.6) => {
    // low-volume lanes recede so the structure reads first
    let base = (compact ? 0.55 : 0.78) * (0.42 + 0.58 * Math.min(1, w / 1.2))
    if (cutLanes.has(key)) return 0.9
    if (hasHL) {
      if (hlEdges.has(key)) base = 1
      else if (hlPlayers.has(src) || hlPlayers.has(dst)) base = 0.75
      else base = 0.07
    } else if (hovered != null) {
      base = src === hovered || dst === hovered ? 0.95 : 0.14
    } else if (selectedPlayer != null) {
      base = src === selectedPlayer || dst === selectedPlayer ? 0.95 : 0.22
    }
    if (selectedEdge && selectedEdge.src === src && selectedEdge.dst === dst) base = 1
    if (suppressed.has(src) || suppressed.has(dst)) base *= 0.55
    return base
  }
  const playerOpacity = (id: number) => {
    const s = suppressed.get(id)
    let base = 1
    if (hasHL) base = hlPlayers.has(id) || hlEdgeEnds.has(id) ? 1 : 0.3
    if (s) base = Math.min(base, s.deleted ? 0.15 : 0.3)
    return base
  }

  const tr = reduced ? { duration: 0 } : undefined
  const netTr = (i: number) => (reduced ? { duration: 0 } : { d: { duration: DUR.net, delay: i * DUR.stagger, ease: [0.22, 1, 0.36, 1] as const }, strokeWidth: SPRING, stroke: { duration: 0.6 }, opacity: { duration: 0.45 } })

  return (
    <svg viewBox="-3 -3 126 86" className={className} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Pass network on the pitch">
      <defs>
        <radialGradient id={`${idPrefix}-glow`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={-3} y={-3} width={126} height={86} fill="#07120B" />
      <PitchMarkings stroke={compact ? 0.28 : 0.32} />
      {!compact && (
        <text x={117.5} y={78.2} fontSize={2.2} fill="rgba(255,255,255,0.3)" textAnchor="end" fontWeight={600} letterSpacing={0.2}>ATTACK</text>
      )}

      {/* edges */}
      <g fill="none" strokeLinecap="round">
        <AnimatePresence initial={false}>
          {drawn.map((d) => {
            const isCutLane = cutLanes.has(d.key)
            const isEst = d.e.est
            const op = edgeOpacity(d.key, d.e.src, d.e.dst, d.w)
            return (
              <motion.g key={d.key} initial={{ opacity: 0 }} animate={{ opacity: op }} exit={{ opacity: 0 }} transition={tr ?? { duration: 0.45 }}>
                <motion.path
                  id={`${idPrefix}-e-${d.e.src}-${d.e.dst}`}
                  initial={{ d: d.d, strokeWidth: 0, stroke: d.color }}
                  animate={isCutLane
                    ? { d: d.d, strokeWidth: Math.max(d.w, 0.35), stroke: reduced ? CUT_RED : [CUT_RED, CUT_RED, 'rgba(239,68,68,0.45)'] }
                    : { d: d.d, strokeWidth: d.w, stroke: d.color }}
                  exit={{ strokeWidth: 0 }}
                  transition={isCutLane && !reduced ? { ...netTr(d.i), stroke: { duration: 1.4, times: [0, 0.5, 1] } } : netTr(d.i)}
                  strokeDasharray={isEst ? '1.1 0.7' : isCutLane ? '0.9 0.6' : undefined}
                  style={{ cursor: onEdgeClick ? 'pointer' : 'default' }}
                  onClick={() => onEdgeClick?.(d.e.src, d.e.dst)}
                >
                  <title>{`${byId.get(d.e.src)?.name} -> ${byId.get(d.e.dst)?.name}: ${d.e.completed} of ${d.e.count} completed, ${d.e.progressive} progressive${isEst ? ' (estimated)' : ''}`}</title>
                </motion.path>
                <motion.path
                  initial={{ d: d.arrow, fill: d.color }}
                  animate={{ d: d.arrow, fill: isCutLane ? CUT_RED : d.color }}
                  transition={netTr(d.i)}
                  stroke="none"
                  style={{ pointerEvents: 'none' }}
                />
              </motion.g>
            )
          })}
        </AnimatePresence>
      </g>

      {/* flow particles (density ∝ volume), disabled under reduced motion */}
      {particleAlloc.size > 0 && (
        <g fill="#ffffff" style={{ pointerEvents: 'none' }}>
          {drawn.map((d) => {
            const n = particleAlloc.get(d.key) ?? 0
            if (!n) return null
            const dur = Math.max(1.6, Math.min(4.2, d.len / 22))
            const op = Math.min(0.85, 0.35 + edgeOpacity(d.key, d.e.src, d.e.dst, d.w) * 0.5)
            return Array.from({ length: n }, (_, k) => (
              <circle key={`${d.key}-${k}`} r={0.32} opacity={op}>
                <animateMotion dur={`${dur.toFixed(2)}s`} begin={`${(-(k / n) * dur).toFixed(2)}s`} repeatCount="indefinite" rotate="auto">
                  <mpath href={`#${idPrefix}-e-${d.e.src}-${d.e.dst}`} />
                </animateMotion>
              </circle>
            ))
          })}
        </g>
      )}

      {/* leashes: suppressed target -> presser (amber) and cut lanes -> presser (red, faint) */}
      <g fill="none">
        {[...suppressed.entries()].map(([tid, s]) => {
          const t = byId.get(tid); const pr = s.presser != null ? otherPositions[s.presser] : undefined
          if (!t || !pr) return null
          return (
            <motion.line key={`leash-${tid}`} x1={pr.x} y1={pr.y} x2={t.x} y2={t.y}
              stroke={AMBER} strokeWidth={0.45} strokeDasharray="1.4 0.9" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.95 }} exit={{ opacity: 0 }}
              transition={tr ?? { duration: 0.8, ease: 'easeOut' }} />
          )
        })}
        {[...cutLanes.entries()].map(([key, presserId]) => {
          const [a, b] = key.split('->').map(Number)
          const pa = byId.get(a), pb = byId.get(b)
          const pr = presserId != null ? otherPositions[presserId] : undefined
          if (!pa || !pb) return null
          const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2
          return (
            <g key={`cut-${key}`}>
              <motion.circle cx={mx} cy={my} r={1.2} fill="none" stroke={CUT_RED} strokeWidth={0.35}
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.9 }} transition={tr ?? SPRING} style={{ transformOrigin: `${mx}px ${my}px` }} />
              <line x1={mx - 0.8} y1={my - 0.8} x2={mx + 0.8} y2={my + 0.8} stroke={CUT_RED} strokeWidth={0.35} />
              <line x1={mx + 0.8} y1={my - 0.8} x2={mx - 0.8} y2={my + 0.8} stroke={CUT_RED} strokeWidth={0.35} />
              {pr && <motion.line x1={pr.x} y1={pr.y} x2={mx} y2={my} stroke={AMBER} strokeWidth={0.35} strokeDasharray="1 0.9" strokeOpacity={0.7}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={tr ?? { duration: 0.8 }} />}
            </g>
          )
        })}
      </g>

      {/* pressers from the other side (mirrored), amber-outlined */}
      <g>
        {pressers.map((pr) => (
          <motion.g key={`pr-${pr.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tr ?? { duration: 0.35 }}>
            <motion.circle cx={pr.x} cy={pr.y} r={compact ? 1.6 : 2.1} fill="#07120B" stroke={AMBER} strokeWidth={0.45} />
            <text x={pr.x} y={pr.y + 0.75} fontSize={compact ? 1.5 : 1.9} fontWeight={700} fill={AMBER} textAnchor="middle">{pr.jersey ?? ''}</text>
            {!compact && <text x={pr.x} y={pr.y - 3} fontSize={2} fill={AMBER} textAnchor="middle" fontWeight={600}>{shortName(pr.name)}</text>}
          </motion.g>
        ))}
      </g>

      {/* players */}
      <g>
        <AnimatePresence initial={false}>
          {players.map((p, i) => {
            const r = rOf(p)
            const op = playerOpacity(p.id)
            const isSel = selectedPlayer === p.id
            const isHL = hlPlayers.has(p.id) || hlEdgeEnds.has(p.id)
            const sup = suppressed.get(p.id)
            const showName = !compact && (hovered === p.id || isSel || isHL || !!sup)
            return (
              <motion.g key={p.id}
                initial={{ opacity: 0 }} animate={{ opacity: op }} exit={{ opacity: 0 }}
                transition={tr ?? { duration: 0.5, delay: i * 0.02 }}
                style={{ cursor: onPlayerClick ? 'pointer' : 'default' }}
                onMouseEnter={() => { setHovered(p.id); if (!compact) setHover([`player:${p.id}`]) }}
                onMouseLeave={() => { setHovered(null); if (!compact) setHover([]) }}
                onClick={() => onPlayerClick?.(p.id)}
              >
                {(isSel || isHL) && (
                  <motion.circle animate={{ cx: p.x, cy: p.y, r: r + 2.2 }} transition={tr ?? SPRING} fill={`url(#${idPrefix}-glow)`} />
                )}
                {sup && (
                  <motion.circle animate={{ cx: p.x, cy: p.y, r: r + 1.1 }} transition={tr ?? SPRING} fill="none" stroke={AMBER} strokeWidth={0.4} strokeDasharray="1 0.7" />
                )}
                <motion.circle
                  initial={false}
                  animate={{ cx: p.x, cy: p.y, r }}
                  transition={tr ?? { ...SPRING, delay: i * 0.02 }}
                  fill={teamColor} fillOpacity={0.92}
                  stroke={isSel ? '#ffffff' : 'rgba(255,255,255,0.75)'} strokeWidth={isSel ? 0.5 : 0.25}
                >
                  <title>{`${p.name} (${p.jersey ?? '-'}) S_p ${p.score.toFixed(2)}`}</title>
                </motion.circle>
                <motion.text animate={{ x: p.x, y: p.y + r * 0.42 }} transition={tr ?? { ...SPRING, delay: i * 0.02 }}
                  fontSize={Math.max(1.5, r * 0.95)} fontWeight={700} fill="#ffffff" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                  {p.jersey ?? ''}
                </motion.text>
                {showName && (
                  <motion.text animate={{ x: p.x, y: p.y - r - 1 }} initial={{ opacity: 0 }} transition={tr ?? SPRING}
                    fontSize={2.1} fontWeight={600} fill="#E7EEE9" textAnchor="middle" style={{ pointerEvents: 'none', paintOrder: 'stroke' }} stroke="#07120B" strokeWidth={0.6}>
                    {p.name}
                  </motion.text>
                )}
              </motion.g>
            )
          })}
        </AnimatePresence>
      </g>
    </svg>
  )
}

export function shortName(n: string): string {
  const parts = n.split(' ')
  return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : n
}
