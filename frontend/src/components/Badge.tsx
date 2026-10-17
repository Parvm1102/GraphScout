export function BasisBadge({ basis }: { basis: 'modeled' | 'empirical' | string }) {
  const cls = basis === 'empirical' ? 'badge badge-empirical' : 'badge badge-modeled'
  return <span className={cls} title={basis === 'empirical' ? 'From observed absence windows' : 'From the reweighting model'}>{basis}</span>
}
export function AmberBadge({ children }: { children: React.ReactNode }) {
  return <span className="badge badge-amber">{children}</span>
}
export function TierBadge({ tier }: { tier: string }) {
  return <span className="badge badge-tier" title="Re-simulated in FalkorDB (Tier A), not the fast in-memory tier">Tier {tier} verified</span>
}
