/** Chalk-white pitch markings at 40% opacity on the 120x80 StatsBomb pitch. */
export default function PitchMarkings({ stroke = 0.3 }: { stroke?: number }) {
  const s = { fill: 'none', stroke: 'rgba(255,255,255,0.4)', strokeWidth: stroke, vectorEffect: 'non-scaling-stroke' as const }
  return (
    <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <rect x={0} y={0} width={120} height={80} {...s} />
      <line x1={60} y1={0} x2={60} y2={80} {...s} />
      <circle cx={60} cy={40} r={10} {...s} />
      <circle cx={60} cy={40} r={0.5} fill="rgba(255,255,255,0.4)" />
      {/* penalty boxes */}
      <rect x={0} y={18} width={18} height={44} {...s} />
      <rect x={102} y={18} width={18} height={44} {...s} />
      {/* six-yard boxes */}
      <rect x={0} y={30} width={6} height={20} {...s} />
      <rect x={114} y={30} width={6} height={20} {...s} />
      {/* penalty spots + arcs */}
      <circle cx={12} cy={40} r={0.5} fill="rgba(255,255,255,0.4)" />
      <circle cx={108} cy={40} r={0.5} fill="rgba(255,255,255,0.4)" />
      <path d="M 18 32 A 10 10 0 0 1 18 48" {...s} />
      <path d="M 102 32 A 10 10 0 0 0 102 48" {...s} />
      {/* goals */}
      <rect x={-2} y={36} width={2} height={8} {...s} />
      <rect x={120} y={36} width={2} height={8} {...s} />
    </g>
  )
}
