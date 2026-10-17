import { useEffect, useState } from 'react'
import { API_BASE } from '../api'

/** Free hosting (Render) sleeps after 15 idle minutes; the first request then takes ~45 s. Probe /api/health on
 *  mount and, if it has not answered within 2.5 s, tell the visitor what is happening instead of showing an empty
 *  pitch. The probe itself is what wakes the service. */
export default function ColdStartNotice() {
  const [state, setState] = useState<'probing' | 'waking' | 'ready' | 'down'>('probing')
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    let done = false
    const slow = window.setTimeout(() => { if (!done) setState('waking') }, 2500)
    const tick = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    const started = Date.now()
    const probe = async (attempt: number): Promise<void> => {
      try {
        const r = await fetch(`${API_BASE}/api/health`, { cache: 'no-store' })
        if (!r.ok) throw new Error(String(r.status))
        done = true; setState('ready')
      } catch {
        if (Date.now() - started > 120_000) { done = true; setState('down'); return }
        await new Promise((res) => setTimeout(res, 3000))
        return probe(attempt + 1)
      }
    }
    void probe(0)
    return () => { done = true; window.clearTimeout(slow); window.clearInterval(tick) }
  }, [])
  if (state === 'probing' || state === 'ready') return null
  return (
    <div role="status" className="mx-3 mt-3 rounded-md border px-3 py-2 text-[12px] flex items-center gap-3"
      style={{ borderColor: 'rgba(229,231,235,0.18)', background: 'rgba(229,231,235,0.05)', color: '#E5E7EB' }}>
      {state === 'waking' ? (
        <>
          <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ background: '#E5E7EB' }} />
          <span>
            Waking the analysis server. Free hosting sleeps after 15 idle minutes; it usually answers within a minute.
            <span className="num" style={{ color: '#9CA3AF' }}> {seconds}s</span>
          </span>
        </>
      ) : (
        <span>The analysis server is not responding. Reload in a minute, or run it locally (see the README).</span>
      )}
    </div>
  )
}
