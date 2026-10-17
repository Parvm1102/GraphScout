import { type Gene, type GeneCut, type GeneMark, isCut } from '../api'

export const shortName = (n: string): string => {
  const parts = n.split(' ')
  return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : n
}

export function geneLabel(g: Gene, short = true): string {
  const nm = short ? shortName : (x: string) => x
  if (isCut(g)) return `${nm(g.presser.name)} cuts ${nm(g.target.src_name)} → ${nm(g.target.dst_name)}`
  return `${nm(g.presser.name)} marks ${nm((g.target as GeneMark).name)}`
}
export function geneTarget(g: Gene): string {
  if (isCut(g)) return `${shortName(g.target.src_name)} → ${shortName(g.target.dst_name)}`
  return shortName((g.target as GeneMark).name)
}
export function geneCell(g: Gene): string {
  if (isCut(g)) return `${g.presser.id}:cut:${g.target.src}->${g.target.dst}`
  return `${g.presser.id}:mark:${(g.target as GeneMark).id}`
}
export function geneRefs(g: Gene): string[] {
  if (g.refs?.length) return g.refs
  if (isCut(g)) return [`player:${g.presser.id}`, `edge:${g.target.src}->${g.target.dst}`]
  return [`player:${g.presser.id}`, `player:${(g.target as GeneMark).id}`]
}

/** "3943:mark:6765" | "3943:cut:17620->68574" */
export function parseCell(cell: string): { presser: number; action: 'mark' | 'cut'; col: string; target?: number; src?: number; dst?: number } {
  const [p, action, rest] = cell.split(':') as [string, 'mark' | 'cut', string]
  if (action === 'cut') {
    const [s, d] = rest.split('->').map(Number)
    return { presser: Number(p), action, col: `cut:${rest}`, src: s, dst: d }
  }
  return { presser: Number(p), action, col: `mark:${rest}`, target: Number(rest) }
}
export const cutTarget = (g: Gene) => g.target as GeneCut
