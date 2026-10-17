import { useStore } from '../store'

/** Six toggleable match-time windows (multi-select, at least one). Re-queries /api/network on change. */
export default function WindowBrush() {
  const all = useStore((s) => s.matches?.windows ?? s.windows)
  const windows = useStore((s) => s.windows)
  const toggle = useStore((s) => s.toggleWindow)
  const loading = useStore((s) => s.networkLoading)
  const network = useStore((s) => s.network)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="panel-title mr-1">Windows</span>
      <div className="flex gap-1">
        {all.map((w) => {
          const on = windows.includes(w)
          return (
            <button key={w} className="chip num" data-on={on} onClick={() => toggle(w)} aria-pressed={on}
              style={on ? { borderColor: 'color-mix(in srgb, var(--team) 70%, transparent)', background: 'var(--team-soft)', color: '#E7EEE9' } : undefined}>
              {w}'
            </button>
          )
        })}
      </div>
      <span className="text-[11px] text-ink-3 ml-auto num">
        {loading ? 'loading…' : `${windows.length} of ${all.length} windows · ${network?.players.length ?? 0} players · ${network?.edges.length ?? 0} lanes`}
      </span>
    </div>
  )
}
