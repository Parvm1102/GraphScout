// Placeholder until the scroll scenes are built last; for now "/" enters the app directly.
import { useEffect } from 'react'
export default function Landing({ onEnter }: { onEnter: () => void }) {
  useEffect(() => { onEnter() }, [onEnter])
  return null
}
