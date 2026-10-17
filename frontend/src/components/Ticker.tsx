import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { useReduced } from '../lib/motion'

interface Props {
  value: number
  format?: (v: number) => string
  duration?: number
  className?: string
}

/** Count-up ticker: every changing number animates from its previous value to the new one. */
export default function Ticker({ value, format = (v) => v.toFixed(1), duration = 0.7, className }: Props) {
  const reduced = useReduced()
  const prev = useRef<number>(value)
  const [shown, setShown] = useState<number>(value)
  useEffect(() => {
    if (!Number.isFinite(value)) return
    if (reduced || prev.current === value) { prev.current = value; setShown(value); return }
    const ctrl = animate(prev.current, value, {
      duration, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => { prev.current = value; setShown(value) },
    })
    prev.current = value
    return () => ctrl.stop()
  }, [value, duration, reduced])
  return <span className={`num ${className ?? ''}`}>{format(shown)}</span>
}
