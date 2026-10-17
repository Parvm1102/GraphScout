"""Validation ablation (brief Phase 3, required chart): for every ingested match of the demo teams,
dC from suppressing the top-S_p player at k=0.3 vs dC from suppressing the median player (Tier A).
Writes eval/score_ablation.png + eval/score_ablation.json."""
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from app import config  # noqa: E402
from app.metrics import scores as S  # noqa: E402
from app.sim.tier_a import simulate_match  # noqa: E402

K = 0.3
MIN_MIN = 45.0


def main() -> None:
    df = S.all_components()
    teams = sys.argv[1:] or ["Spain", "England"]
    rows = []
    variant = (sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ("in_sample", "held_out") else "in_sample")
    teams = [t for t in teams if t not in ("in_sample", "held_out")] or ["Spain", "England"]
    for team in teams:
        for mid in S.team_match_ids(team):
            agg = S.composite(df) if variant == "in_sample" else S.composite(df, exclude_match=mid)
            played = df[(df.match_id == mid) & (df.team == team) & (df.minutes >= MIN_MIN) & (df.position != "Goalkeeper")]
            cand = agg[(agg.team == team) & (agg.id.isin(played.id))].reset_index(drop=True)
            if len(cand) < 3:
                continue
            top = cand.iloc[0]
            med = cand.iloc[len(cand) // 2]
            r_top = simulate_match(mid, team, [{"type": "suppress", "target_player": int(top.id), "k": K}])
            r_med = simulate_match(mid, team, [{"type": "suppress", "target_player": int(med.id), "k": K}])
            rows.append({"team": team, "match_id": mid, "top": {"id": int(top.id), "name": top["name"], "dC": r_top["dC_pct"]},
                         "median": {"id": int(med.id), "name": med["name"], "dC": r_med["dC_pct"]}})
            print(f"{team:8} {mid}  top {top['name'][:18]:<18} dC={r_top['dC_pct']:7.2f}   median {med['name'][:18]:<18} dC={r_med['dC_pct']:7.2f}")
    tops = [r["top"]["dC"] for r in rows]; meds = [r["median"]["dC"] for r in rows]
    summary = {"k": K, "variant": variant, "n": len(rows), "top_mean": round(statistics.fmean(tops), 2), "top_std": round(statistics.pstdev(tops), 2),
               "median_mean": round(statistics.fmean(meds), 2), "median_std": round(statistics.pstdev(meds), 2),
               "top_more_damaging_in": sum(1 for a, b in zip(tops, meds) if a < b), "rows": rows}
    config.EVAL_DIR.mkdir(exist_ok=True)
    (config.EVAL_DIR / f"score_ablation_{variant}.json").write_text(json.dumps(summary, indent=1))

    fig, ax = plt.subplots(figsize=(7, 4.2), facecolor="#07120B")
    ax.set_facecolor("#07120B")
    for i, (vals, label, col) in enumerate(((tops, "top-S_p player", "#F59E0B"), (meds, "median player", "#9CA3AF"))):
        ax.scatter([i + (j % 5 - 2) * 0.04 for j in range(len(vals))], vals, color=col, s=36, alpha=0.9, label=label, zorder=3)
        ax.hlines(statistics.fmean(vals), i - 0.25, i + 0.25, color=col, lw=2)
    ax.set_xticks([0, 1]); ax.set_xticklabels([f"top-S_p\nmean {summary['top_mean']:+.1f}", f"median\nmean {summary['median_mean']:+.1f}"], color="#E5E7EB")
    ax.set_ylabel("ΔC % (suppress at k=0.3, Tier A)", color="#E5E7EB"); ax.tick_params(colors="#E5E7EB")
    for s in ax.spines.values():
        s.set_color("#374151")
    ax.set_title(f"Score ablation ({variant.replace('_', '-')} S_p): top-S_p vs median suppression, {len(rows)} team-matches "
                 f"(top more damaging in {summary['top_more_damaging_in']} of {len(rows)})", color="#E5E7EB", fontsize=10)
    ax.axhline(0, color="#4B5563", lw=0.8)
    fig.tight_layout(); fig.savefig(config.EVAL_DIR / f"score_ablation_{variant}.png", dpi=150, facecolor=fig.get_facecolor())
    print(json.dumps({k: v for k, v in summary.items() if k != "rows"}))


if __name__ == "__main__":
    main()
