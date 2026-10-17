// Geometry helpers for the 120x80 StatsBomb pitch (attacking left -> right).

export const PITCH_W = 120
export const PITCH_H = 80

export interface Pt { x: number; y: number }

/** Mirror a position from the other team's attacking frame into this one. */
export const mirror = (p: Pt): Pt => ({ x: PITCH_W - p.x, y: PITCH_H - p.y })

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Map composite score to circle radius in pitch units [1.6, 3.4]. */
export function radiusFor(score: number, lo: number, hi: number): number {
  if (!Number.isFinite(score) || hi - lo < 1e-6) return 2.3
  const t = clamp((score - lo) / (hi - lo), 0, 1)
  return lerp(1.6, 3.4, t)
}

/** Map completed passes on an edge to stroke width [0.15, 1.2] (sqrt scale for legibility). */
export function widthFor(completed: number, maxCompleted: number): number {
  if (maxCompleted <= 0) return 0.15
  const t = Math.sqrt(clamp(completed / maxCompleted, 0, 1))
  return lerp(0.15, 1.2, t)
}

/** Quadratic curve from a to b, bent to the right-hand side so a->b and b->a separate. */
export function edgePath(a: Pt, b: Pt, bend = 0.16, shorten = 0): string {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  const mx = (a.x + b.x) / 2 + nx * len * bend
  const my = (a.y + b.y) / 2 + ny * len * bend
  // shorten the tail so the arrowhead sits on the circle rim
  let ex = b.x, ey = b.y
  if (shorten > 0) {
    const tx = b.x - mx, ty = b.y - my
    const tl = Math.hypot(tx, ty) || 1
    ex = b.x - (tx / tl) * shorten
    ey = b.y - (ty / tl) * shorten
  }
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${mx.toFixed(2)} ${my.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`
}

/** Arrowhead polygon at the end of edgePath(a,b). */
export function arrowPath(a: Pt, b: Pt, bend = 0.16, shorten = 0, size = 1.1): string {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  const mx = (a.x + b.x) / 2 + nx * len * bend
  const my = (a.y + b.y) / 2 + ny * len * bend
  let tx = b.x - mx, ty = b.y - my
  const tl = Math.hypot(tx, ty) || 1
  tx /= tl; ty /= tl
  const ex = b.x - tx * shorten, ey = b.y - ty * shorten
  const bx = ex - tx * size, by = ey - ty * size
  const px = -ty * size * 0.55, py = tx * size * 0.55
  return `M ${ex.toFixed(2)} ${ey.toFixed(2)} L ${(bx + px).toFixed(2)} ${(by + py).toFixed(2)} L ${(bx - px).toFixed(2)} ${(by - py).toFixed(2)} Z`
}

export function pathLength(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// ---- color -----------------------------------------------------------------
export const TEAM_RED = '#E11D48'
export const TEAM_BLUE = '#60A5FA'
export const AMBER = '#F59E0B'
export const CUT_RED = '#EF4444'

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA), b = hexToRgb(hexB)
  const c = a.map((v, i) => Math.round(lerp(v, b[i], clamp(t, 0, 1))))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
/** Edge color: team color at low progressive share, brightened toward a chalk tint at high share. */
export function edgeColor(teamColor: string, progShare: number): string {
  return mix(teamColor, '#FFFFFF', clamp(progShare, 0, 1) * 0.75)
}

/** Diverging-free sequential scale for ΔC: 0 -> faint, most negative -> strong team color. */
export function heatColor(teamColor: string, t: number): string {
  // t in [0,1]; low = near-bg, high = team color
  return mix('#13271C', teamColor, clamp(t, 0, 1))
}

export const fmt = {
  pct: (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`,
  num: (v: number, d = 2) => v.toFixed(d),
  int: (v: number) => Math.round(v).toString(),
  signed: (v: number, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`,
}

export const DUR = { ui: 0.26, net: 0.75, stagger: 0.004 }
export const SPRING = { type: 'spring' as const, stiffness: 120, damping: 22, mass: 0.9 }
