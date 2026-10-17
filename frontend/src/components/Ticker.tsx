import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { useReduced } from '../lib/motion'

interface Props {
  value: number
  format?: (v: number) => string
  duration?: number
  className?: string
  /** value to count from on first mount (default 0) */
  from?: number
}

/** Count-up ticker: every changing number animates from its previous value to the new one. */
export default function Ticker({ value, format = (v) => v.toFixed(1), duration = 0.7, className, from = 0 }: Props) {
  const reduced = useReduced()
  const prev = useRef<number | null>(null)
  const [shown, setShown] = useState<number>(reduced ? value : from)
  useEffect(() => {
    if (!Number.isFinite(value)) return
    const start = prev.current ?? from
    if (reduced || start === value) { prev.current = value; setShown(value); return }
    const ctrl = animate(start, value, {
      duration, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => setShown(value),
    })
    prev.current = value
    return () => ctrl.stop()
  }, [value, duration, reduced, from])
  return <span className={`num ${className ?? ''}`}>{format(shown)}</span>
}
