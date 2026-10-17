export default function Footer() {
  return (
    <footer className="flex items-center justify-between gap-4 px-4 py-2 border-t border-white/[0.07] text-[11px] text-ink-3">
      <span>Graph Scout · pass graphs in FalkorDB · numbers labelled <span className="badge badge-modeled">modeled</span> come from the reweighting model, <span className="badge badge-empirical">empirical</span> from observed absence windows</span>
      <a className="flex items-center gap-2 hover:text-ink transition-colors" href="https://github.com/statsbomb/open-data" target="_blank" rel="noreferrer">
        <span>Data: StatsBomb Open Data</span>
        <img src="/statsbomb.png" alt="StatsBomb" style={{ height: 16, width: 'auto' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
      </a>
    </footer>
  )
}
