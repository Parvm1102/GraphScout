import { useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import PitchMarkings from './components/PitchMarkings'
import { api, type Edge, type NetworkResponse, type PerMatch, type PlanItem } from './api'
import { AMBER, TEAM_RED, TEAM_BLUE, arrowPath, edgeColor, edgePath, mirror, radiusFor, widthFor } from './lib/pitch'

gsap.registerPlugin(ScrollTrigger)

interface Data {
  network: NetworkResponse
  after: Edge[] | null
  pm: PerMatch | null
  plan: PlanItem[]
  presser: { x: number; y: number; name: string; jersey?: number } | null
  teamColor: string
  team: string
  our: string
}

/** Landing: four pinned, scroll-scrubbed scenes (GSAP + ScrollTrigger + Lenis, landing only). */
export default function Landing({ onEnter }: { onEnter: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const m = await api.matches()
        const team = m.their
        const played = m.matches.filter((x) => x.home === team || x.away === team)
        const match = played[played.length - 1]?.id ?? m.matches[0].id
        const [network, scores, ourScores] = await Promise.all([api.network(match, team, m.windows), api.scores(team), api.scores(m.our)])
        const target = scores.players.slice().sort((a, b) => b.s_p_mean - a.s_p_mean)[0]
        const presserP = ourScores.players.slice().sort((a, b) => (b.pressures ?? 0) - (a.pressures ?? 0))[0]
        let after: Edge[] | null = null, pm: PerMatch | null = null, plan: PlanItem[] = []
        try {
          const sim = await api.simulate({ team, interventions: [{ type: 'suppress', target_player: target.id, presser: presserP?.id }], match_ids: [match] })
          pm = sim.per_match.find((p) => p.match_id === match) ?? null
          after = pm?.network_after ?? null
          plan = sim.plan
        } catch { /* landing still renders the before state */ }
        const pos = presserP ? mirror({ x: presserP.avg_x, y: presserP.avg_y }) : null
        if (alive) setData({ network, after, pm, plan, presser: pos && presserP ? { ...pos, name: presserP.name, jersey: presserP.jersey } : null, teamColor: team === m.our ? TEAM_BLUE : TEAM_RED, team, our: m.our })
      } catch (e) { if (alive) setErr((e as Error).message) }
    })()
    return () => { alive = false }
  }, [])

  return (
    <div style={{ background: '#07120B', color: '#E7EEE9', minHeight: '100vh' }}>
      <nav className="fixed top-0 inset-x-0 z-20 flex items-center justify-between px-6 py-3" style={{ background: 'linear-gradient(#07120B 60%, rgba(7,18,11,0))' }}>
        <span className="text-[15px] font-bold tracking-tight">Graph Scout</span>
        <button className="btn" onClick={onEnter}>Open the app</button>
      </nav>
      {err && <div className="pt-24 px-6 text-[13px]" style={{ color: '#FCA5A5' }}>{err} — <button className="underline" onClick={onEnter}>open the app</button></div>}
      {data ? <Scenes data={data} onEnter={onEnter} reduced={reduced} /> : !err && (
        <div className="h-screen flex items-center justify-center text-ink-3 text-[13px]">Loading the pass graph…</div>
      )}
    </div>
  )
}

function Scenes({ data, onEnter, reduced }: { data: Data; onEnter: () => void; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const dcRef = useRef<HTMLSpanElement>(null)
  const { network, after, pm, plan, presser, teamColor, team, our } = data

  const players = useMemo(() => {
    const v = network.players.map((p) => p.s_p_mean)
    const lo = Math.min(...v), hi = Math.max(...v)
    return network.players.map((p) => ({ ...p, r: radiusFor(p.s_p_mean, lo, hi) }))
  }, [network])
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const maxC = Math.max(1, ...network.edges.map((e) => e.completed), ...(after ?? []).map((e) => e.completed))
  const afterMap = useMemo(() => new Map((after ?? []).map((e) => [`${e.src}->${e.dst}`, e])), [after])
  const beforeKeys = useMemo(() => new Set(network.edges.map((e) => `${e.src}->${e.dst}`)), [network])
  const extraAfter = useMemo(() => (after ?? []).filter((e) => !beforeKeys.has(`${e.src}->${e.dst}`) && (e.completed > 0 || e.count > 0)), [after, beforeKeys])
  const targetId = plan.find((p) => p.type === 'suppress')?.target_player ?? null
  const target = targetId != null ? byId.get(targetId) : undefined
  const sortedEdges = useMemo(() => network.edges.slice().sort((a, b) => b.completed - a.completed), [network])
  const rows = sortedEdges.slice(0, 18)

  useEffect(() => {
    if (!root.current) return
    if (reduced) return
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (t: number) => lenis.raf(t * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    const ctx = gsap.context(() => {
      // Scene 1: pitch assembles from particles and the headline types on as the page loads
      // (played on load rather than scrubbed so the first frame is never an empty pitch)
      const s1 = gsap.timeline({ defaults: { ease: 'power2.out' } })
      s1.from('[data-s1-player]', { attr: { cx: () => gsap.utils.random(-10, 130), cy: () => gsap.utils.random(-10, 90) }, opacity: 0, stagger: { each: 0.03, from: 'random' }, duration: 1.1 }, 0)
      s1.from('[data-s1-edge]', { strokeDashoffset: (_i, el) => (el as SVGPathElement).getTotalLength(), opacity: 0, stagger: { each: 0.004, from: 'random' }, ease: 'none', duration: 0.9 }, 0.4)
      s1.from('[data-s1-arrow]', { opacity: 0, duration: 0.3 }, 1.2)
      s1.fromTo('[data-s1-headline]', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', ease: 'steps(42)', duration: 1.1 }, 0.1)
      s1.from('[data-s1-sub]', { opacity: 0, y: 12, duration: 0.5 }, 1.0)

      // Scene 2: event table morphs into the graph
      const s2 = gsap.timeline({ scrollTrigger: { trigger: '[data-scene="2"]', start: 'top top', end: '+=120%', scrub: 0.6, pin: true } })
      // rows converge toward the graph panel on the right as they shrink away
      s2.to('[data-s2-row]', {
        x: () => window.innerWidth * 0.48,
        y: (i, el) => 160 - i * ((el as HTMLElement).offsetHeight || 28),
        scale: 0.2, opacity: 0, stagger: { each: 0.03 }, ease: 'power2.inOut', duration: 1,
      }, 0.1)
      s2.from('[data-s2-graph]', { opacity: 0, duration: 0.6 }, 0.6)
      s2.from('[data-s2-copy]', { opacity: 0, y: 16, duration: 0.4 }, 0.8)

      // Scene 3: scrub a suppression before -> after
      const s3 = gsap.timeline({ scrollTrigger: { trigger: '[data-scene="3"]', start: 'top top', end: '+=160%', scrub: 0.6, pin: true } })
      if (after && pm) {
        s3.to('[data-s3-edge]', { attr: { 'stroke-width': (_i, el) => Number((el as SVGPathElement).dataset.after ?? 0) }, ease: 'none', duration: 1 }, 0)
        s3.to('[data-s3-extra]', { opacity: 0.8, ease: 'none', duration: 1 }, 0)
        s3.to('[data-s3-target]', { opacity: 0.3, ease: 'none', duration: 0.6 }, 0.1)
        s3.from('[data-s3-leash]', { strokeDashoffset: (_i, el) => (el as SVGLineElement).getTotalLength(), ease: 'none', duration: 0.8 }, 0.1)
        s3.from('[data-s3-presser]', { opacity: 0, duration: 0.3 }, 0.05)
        const counter = { v: 0 }
        s3.to(counter, { v: pm.dC_pct, ease: 'none', duration: 1, onUpdate: () => { if (dcRef.current) dcRef.current.textContent = `${counter.v > 0 ? '+' : ''}${counter.v.toFixed(1)}%` } }, 0)
        s3.from('[data-s3-after]', { opacity: 0, duration: 0.3 }, 0.7)
      }

      // Scene 4: CTA
      gsap.from('[data-s4]', { opacity: 0, y: 24, stagger: 0.08, duration: 0.6, scrollTrigger: { trigger: '[data-scene="4"]', start: 'top 70%' } })
    }, root)

    return () => { ctx.revert(); gsap.ticker.remove(tick); lenis.destroy() }
  }, [reduced, after, pm])

  const edgeEls = (variant: 's1' | 's2' | 's3') => network.edges.map((e, i) => {
    const a = byId.get(e.src), b = byId.get(e.dst)
    if (!a || !b) return null
    const pa = { x: a.avg_x, y: a.avg_y }, pb = { x: b.avg_x, y: b.avg_y }
    const w = widthFor(e.completed, maxC)
    const col = edgeColor(teamColor, e.completed ? e.progressive / e.completed : 0)
    const aft = afterMap.get(`${e.src}->${e.dst}`)
    const wAfter = aft ? widthFor(aft.completed, maxC) : 0
    const op = 0.78 * (0.42 + 0.58 * Math.min(1, w / 1.2))
    return (
      <g key={`${variant}-${i}`}>
        <path d={edgePath(pa, pb, 0.16, b.r + 0.3)} fill="none" stroke={col} strokeWidth={w} strokeOpacity={op} strokeLinecap="round"
          {...(variant === 's1' ? { 'data-s1-edge': '', strokeDasharray: 1000, strokeDashoffset: 0 } : {})}
          {...(variant === 's3' ? { 'data-s3-edge': '', 'data-after': wAfter.toFixed(3), strokeDasharray: aft?.est ? '1.1 0.7' : undefined } : {})} />
        <path d={arrowPath(pa, pb, 0.16, b.r + 0.3, 1.0 + w * 0.6)} fill={col} fillOpacity={op} {...(variant === 's1' ? { 'data-s1-arrow': '' } : {})} />
      </g>
    )
  })
  const playerEls = (variant: 's1' | 's2' | 's3') => players.map((p) => (
    <g key={`${variant}-p-${p.id}`} {...(variant === 's3' && p.id === targetId ? { 'data-s3-target': '' } : {})}>
      <circle cx={p.avg_x} cy={p.avg_y} r={p.r} fill={teamColor} fillOpacity={0.92} stroke="rgba(255,255,255,0.75)" strokeWidth={0.25} {...(variant === 's1' ? { 'data-s1-player': '' } : {})} />
      <text x={p.avg_x} y={p.avg_y + p.r * 0.42} fontSize={Math.max(1.5, p.r * 0.95)} fontWeight={700} fill="#fff" textAnchor="middle" {...(variant === 's1' ? { 'data-s1-player': '', style: { pointerEvents: 'none' } } : {})}>{p.jersey}</text>
    </g>
  ))
  const svgProps = { viewBox: '-3 -3 126 86', style: { width: '100%', height: 'auto', display: 'block' as const } }

  return (
    <div ref={root}>
      {/* Scene 1 */}
      <section data-scene="1" className="min-h-screen grid items-center gap-8 px-6 md:px-14 pt-16 pb-10" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 6fr)' }}>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-3 mb-3">Opposition preparation on the pass graph</div>
          <h1 data-s1-headline className="text-[44px] md:text-[56px] leading-[1.02] font-bold tracking-tight m-0" style={{ whiteSpace: 'normal' }}>Find the pass that holds the opponent together.</h1>
          <p data-s1-sub className="text-[15px] text-ink-2 mt-5 max-w-[46ch] leading-relaxed">
            Graph Scout turns {team}'s StatsBomb events into a weighted pass graph in FalkorDB, scores who carries the circulation, and simulates what a press does to it by reweighting observed passes. Nothing is invented: every number traces to events.
          </p>
          <div className="flex items-center gap-3 mt-6">
            <button className="btn btn-team" style={{ ['--team' as string]: teamColor, ['--team-soft' as string]: `${teamColor}2E` }} onClick={onEnter}>Open the app</button>
            <span className="text-[11px] text-ink-3">scroll to see how it works</span>
          </div>
        </div>
        <div className="panel p-2">
          <svg {...svgProps} role="img" aria-label={`${team} pass network`}>
            <rect x={-3} y={-3} width={126} height={86} fill="#07120B" />
            <PitchMarkings />
            <g fill="none">{edgeEls('s1')}</g>
            <g>{playerEls('s1')}</g>
          </svg>
          <div className="flex justify-between text-[11px] text-ink-3 px-2 pt-1 num">
            <span>{team} · {network.players.length} players · {network.edges.length} lanes · {network.totals.completed} of {network.totals.count} passes completed</span>
            <span>circle = composite score S_p · width = completed passes · tint = progressive share</span>
          </div>
        </div>
      </section>

      {/* Scene 2 */}
      <section data-scene="2" className="min-h-screen grid items-center gap-8 px-6 md:px-14" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 6fr)' }}>
        <div className="relative">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-3 mb-3">The problem</div>
          <h2 className="text-[34px] leading-tight font-bold tracking-tight m-0">Thousands of events. One structure.</h2>
          <div className="mt-5 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>lane</th><th className="r">completed</th><th className="r">progressive</th><th className="r">from (x, y)</th></tr></thead>
              <tbody>
                {rows.map((e, i) => {
                  const a = byId.get(e.src), b = byId.get(e.dst)
                  if (!a || !b) return null
                  return (
                    <tr key={i} data-s2-row>
                      <td>{a.name} <span className="text-ink-3">→</span> {b.name}</td>
                      <td className="r num">{e.completed}</td>
                      <td className="r num">{e.progressive}</td>
                      <td className="r num text-ink-3">{a.avg_x.toFixed(1)}, {a.avg_y.toFixed(1)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p data-s2-copy className="text-[14px] text-ink-2 mt-4 max-w-[46ch] leading-relaxed">Event logs tell you what happened. The graph tells you what depends on what: PageRank for flow, betweenness for the players everything routes through, max-flow and progressive volume for how the ball actually reaches the box.</p>
        </div>
        <div data-s2-graph className="panel p-2">
          <svg {...svgProps} role="img" aria-label="Clean pass graph">
            <rect x={-3} y={-3} width={126} height={86} fill="#07120B" />
            <PitchMarkings />
            <g fill="none">{edgeEls('s2')}</g>
            <g>{playerEls('s2')}</g>
          </svg>
        </div>
      </section>

      {/* Scene 3 */}
      <section data-scene="3" className="min-h-screen grid items-center gap-8 px-6 md:px-14" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 6fr)' }}>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-3 mb-3">The simulation</div>
          <h2 className="text-[34px] leading-tight font-bold tracking-tight m-0">Mark one player. Watch the circulation drop.</h2>
          <p className="text-[14px] text-ink-2 mt-4 max-w-[46ch] leading-relaxed">
            {target ? `${presser ? `${presser.name} marks ${target.name}` : `${target.name} is suppressed`}: his passes are scaled by the matchup factor k = ${(plan[0]?.k ?? 0.3).toFixed(2)} and the removed volume is redistributed onto lanes his teammates already use. The graph is re-solved in FalkorDB; nothing is invented.` : 'Scroll to scrub a suppression from before to after.'}
          </p>
          <div className="mt-6 flex items-end gap-6">
            <div>
              <div className="panel-title flex items-center gap-1.5">ΔC · this match <span className="badge badge-modeled">modeled</span></div>
              <div className="text-[48px] font-semibold leading-none mt-1 num" style={{ color: teamColor }}><span ref={dcRef}>+0.0%</span></div>
            </div>
            {pm && (
              <div data-s3-after className="grid grid-cols-3 gap-3 text-[12px] pb-2">
                {([['M', pm.M_before, pm.M_after], ['V', pm.V_before, pm.V_after], ['D', pm.D_before, pm.D_after]] as const).map(([k, b, a]) => (
                  <div key={k}><div className="text-ink-3 font-semibold">{k}</div><div className="num"><span className="text-ink-3">{b}</span> → <span className="font-semibold">{a}</span></div></div>
                ))}
              </div>
            )}
          </div>
          {pm && <p className="text-[11px] text-ink-3 mt-4 max-w-[46ch]">Modeled, not observed: {pm.removed} passes removed, {pm.redistributed} redistributed. Where a player actually missed minutes, the app shows the empirical drop beside this number.</p>}
        </div>
        <div className="panel p-2">
          <svg {...svgProps} role="img" aria-label="Suppression before and after">
            <rect x={-3} y={-3} width={126} height={86} fill="#07120B" />
            <PitchMarkings />
            <g fill="none">{edgeEls('s3')}</g>
            <g fill="none">
              {extraAfter.map((e, i) => {
                const a = byId.get(e.src), b = byId.get(e.dst)
                if (!a || !b) return null
                const pa = { x: a.avg_x, y: a.avg_y }, pb = { x: b.avg_x, y: b.avg_y }
                return <path key={i} data-s3-extra d={edgePath(pa, pb, 0.16, b.r + 0.3)} stroke={edgeColor(teamColor, e.completed ? e.progressive / e.completed : 0)} strokeWidth={widthFor(e.completed, maxC)} strokeDasharray="1.1 0.7" opacity={0} strokeLinecap="round" />
              })}
            </g>
            {target && presser && (
              <line data-s3-leash x1={presser.x} y1={presser.y} x2={target.avg_x} y2={target.avg_y} stroke={AMBER} strokeWidth={0.45} strokeDasharray="1.4 0.9" strokeLinecap="round" pathLength={100} />
            )}
            <g>{playerEls('s3')}</g>
            {presser && (
              <g data-s3-presser>
                <circle cx={presser.x} cy={presser.y} r={2.1} fill="#07120B" stroke={AMBER} strokeWidth={0.45} />
                <text x={presser.x} y={presser.y + 0.75} fontSize={1.9} fontWeight={700} fill={AMBER} textAnchor="middle">{presser.jersey ?? ''}</text>
                <text x={presser.x} y={presser.y - 3} fontSize={2} fill={AMBER} textAnchor="middle" fontWeight={600}>{presser.name}</text>
              </g>
            )}
          </svg>
        </div>
      </section>

      {/* Scene 4 */}
      <section data-scene="4" className="min-h-[80vh] flex flex-col items-center justify-center text-center px-6">
        <div data-s4 className="text-[11px] uppercase tracking-[0.18em] text-ink-3 mb-3">{our} against {team}</div>
        <h2 data-s4 className="text-[40px] leading-tight font-bold tracking-tight m-0 max-w-[22ch]">Four commitments, searched by a genetic algorithm and re-verified in the graph.</h2>
        <p data-s4 className="text-[14px] text-ink-2 mt-4 max-w-[52ch] leading-relaxed">Greedy seeds the pool, the GA searches mark-and-cut plans, every champion is re-simulated in FalkorDB and reported beside its greedy baseline. An agent answers questions with tools, never with invented numbers.</p>
        <button data-s4 className="btn btn-team mt-8 text-[14px] px-5 py-2.5" style={{ ['--team' as string]: teamColor, ['--team-soft' as string]: `${teamColor}2E` }} onClick={onEnter}>Open the app</button>
        <footer data-s4 className="mt-20 mb-8 flex items-center gap-3 text-[11px] text-ink-3">
          <a className="flex items-center gap-2 hover:text-ink transition-colors" href="https://github.com/statsbomb/open-data" target="_blank" rel="noreferrer">
            <span>Data: StatsBomb Open Data</span>
            <img src="/statsbomb.png" alt="StatsBomb" style={{ height: 16, width: 'auto' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          </a>
          <span>·</span><span>Graphs in FalkorDB</span>
        </footer>
      </section>
    </div>
  )
}
