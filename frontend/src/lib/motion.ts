import { useReducedMotion } from 'framer-motion'

/** True when the user prefers reduced motion (or a `?nomotion=1` flag is set for screenshots). */
export function useReduced(): boolean {
  const r = useReducedMotion()
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nomotion')) return true
  return !!r
}
