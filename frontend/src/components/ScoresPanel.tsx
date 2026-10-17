import WeightSliders from './WeightSliders'
import ScoresTable from './ScoresTable'
import { useStore } from '../store'
import { BasisBadge } from './Badge'

export default function ScoresPanel() {
  const team = useStore((s) => s.team)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[14px] font-semibold flex items-center gap-2">Who matters · {team} <BasisBadge basis="empirical" /></div>
        <div className="text-[11px] text-ink-3">Shares are measured on the observed pass graph of each match; only the weighting is a choice.</div>
      </div>
      <WeightSliders />
      <ScoresTable />
    </div>
  )
}
