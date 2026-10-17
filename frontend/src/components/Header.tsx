import { motion } from 'framer-motion'
import { colorFor, useActiveHighlights, useStore } from '../store'
import { refs } from '../api'

export default function Header() {
  const matches = useStore((s) => s.matches)
  const our = useStore((s) => s.our)
  const their = useStore((s) => s.their)
  const team = useStore((s) => s.team)
  const selected = useStore((s) => s.selectedMatch)
  const setTeam = useStore((s) => s.setTeam)
  const setMatch = useStore((s) => s.setMatch)
  const setHover = useStore((s) => s.setHover)
  const hl = useActiveHighlights()
  const played = matches?.matches.filter((m) => m.home === team || m.away === team) ?? []

  return (
    <header className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.07]" style={{ background: '#081409' }}>
      <div className="flex items-baseline gap-2 shrink-0">
        <span className="text-[15px] font-bold tracking-tight">Graph Scout</span>
        <span className="text-[11px] text-ink-3 hidden md:inline">opposition preparation on the pass graph</span>
      </div>
      <div className="flex items-center gap-1 shrink-0 rounded-full border border-white/10 p-0.5">
        {[their, our].map((t) => {
          const on = t === team
          const c = colorFor(t, our)
          return (
            <button key={t} className="relative px-3 py-1 text-[12px] font-semibold rounded-full transition-colors duration-200"
              style={{ color: on ? '#fff' : '#9FB3A8' }} onClick={() => void setTeam(t)} aria-pressed={on}>
              {on && <motion.span layoutId="teamPill" className="absolute inset-0 rounded-full" style={{ background: c, opacity: 0.85 }} transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
              <span className="relative flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: on ? '#fff' : c }} />
                {t}
                <span className="text-[10px] font-medium opacity-75">{t === our ? 'us' : 'them'}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto scroll-thin min-w-0 flex-1">
        {played.map((m) => {
          const home = m.home === team
          const opp = home ? m.away : m.home
          const [hg, ag] = m.score.split('-').map(Number)
          const [gf, ga] = home ? [hg, ag] : [ag, hg]
          const on = m.id === selected
          const isHL = hl.has(refs.match(m.id))
          return (
            <button key={m.id} className="chip whitespace-nowrap flex items-center gap-1.5" data-on={on} data-hl={isHL}
              onClick={() => void setMatch(m.id)}
              onMouseEnter={() => setHover([refs.match(m.id)])} onMouseLeave={() => setHover([])}
              title={`${m.stage} · ${m.date} · ${m.home} ${m.score} ${m.away}`}>
              <span className="text-[10px] uppercase tracking-wider opacity-70">{home ? 'v' : '@'}</span>
              <span>{opp}</span>
              <span className="num font-semibold" style={{ color: gf > ga ? '#E7EEE9' : gf < ga ? '#9FB3A8' : '#C7D4CC' }}>{gf}–{ga}</span>
            </button>
          )
        })}
      </div>
    </header>
  )
}
