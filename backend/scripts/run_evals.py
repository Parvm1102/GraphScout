"""Phase 4E runner: 4E.1 expert agreement (demo teams + whole tournament), 4E.3 C vs xG, evolved-vs-greedy chart,
score ablation reference. Writes eval/summary.json and the PNG charts the README embeds."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from app import config  # noqa: E402
from app.evals import expert, xg  # noqa: E402
from app.metrics import scores as S  # noqa: E402

BG, FG, AMBER, GREY, GREEN = "#07120B", "#E5E7EB", "#F59E0B", "#9CA3AF", "#34D399"


def style(ax, title):
    ax.set_facecolor(BG); ax.tick_params(colors=FG); ax.set_title(title, color=FG, fontsize=10)
    for s in ax.spines.values():
        s.set_color("#374151")
    ax.xaxis.label.set_color(FG); ax.yaxis.label.set_color(FG)


def chart_expert(res_demo: dict, res_all: dict | None, path: Path) -> None:
    fig, axes = plt.subplots(1, 2 if res_all else 1, figsize=(10 if res_all else 5.5, 4), facecolor=BG, squeeze=False)
    for ax, res, label in zip(axes[0], [res_demo, res_all] if res_all else [res_demo], ["Spain + England", "whole tournament"]):
        n = res["n"]
        vals = [res["hit_rate"], res["chance_rate_analytic"], res["most_touches_rate"]]
        labels = [f"Graph Scout\n{res['hits']} of {n}", f"random (3/N)\n{res['chance_rate_analytic']*n:.1f} of {n}", f"most touches\n{res['most_touches_hits']} of {n}"]
        bars = ax.bar(labels, vals, color=[AMBER, GREY, GREY], width=0.6)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v + 0.01, f"{v*100:.0f}%", ha="center", color=FG, fontsize=9)
        ax.set_ylim(0, max(0.6, max(vals) + 0.1)); ax.set_ylabel("top-3 hit rate (held-out)")
        style(ax, f"4E.1 expert agreement — {label}\nn={n}, Spearman {res['spearman_mean']:+.2f}, permutation p={res['permutation_p_value']:.2f}")
    fig.tight_layout(); fig.savefig(path, dpi=150, facecolor=BG); plt.close(fig)


def chart_xg(res: dict, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(5.5, 4), facecolor=BG)
    xs = [r["C_raw"] for r in res["rows"]]; ys = [r["xg"] for r in res["rows"]]
    ax.scatter(xs, ys, color=AMBER, s=26, alpha=0.85)
    ax.set_xlabel("circulation C_raw (0.5·M + 0.3·V + 0.2·D)"); ax.set_ylabel("total shot xG (StatsBomb)")
    style(ax, f"4E.3 C vs xG per team-match: Pearson r={res['pearson_r']:+.2f} (p={res['pearson_p']:.3f}), "
              f"Spearman {res['spearman_r']:+.2f} (p={res['spearman_p']:.3f}), n={res['n']}")
    fig.tight_layout(); fig.savefig(path, dpi=150, facecolor=BG); plt.close(fig)


def chart_ga(final: dict, path: Path) -> None:
    comp = final["comparison"]
    fig, ax = plt.subplots(figsize=(6.5, 4.2), facecolor=BG)
    xs = [r["budget"] for r in comp]
    w = 0.36
    g = [r.get("greedy_dC") if r.get("greedy_dC") is not None else 0 for r in comp]
    e = [r.get("ga_dC") if r.get("ga_dC") is not None else 0 for r in comp]
    b1 = ax.bar([x - w / 2 for x in xs], g, width=w, color=GREY, label="greedy (commitment curve)")
    b2 = ax.bar([x + w / 2 for x in xs], e, width=w, color=AMBER, label="evolved best at budget")
    for bars in (b1, b2):
        for b in bars:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() - 0.3, f"{b.get_height():+.1f}", ha="center", va="top", color=BG, fontsize=8, fontweight="bold")
    c = final["champion"]
    ax.scatter([c["committed"] + w / 2], [c["dC_mean"]], s=200, facecolors="none", edgecolors=GREEN, linewidths=2,
               label=f"champion: {c['committed']} players, {c['dC_mean']:+.1f}% (Tier A)", zorder=5)
    ax.axhline(0, color="#4B5563", lw=0.8)
    ax.set_xlabel("committed players"); ax.set_ylabel("ΔC % (Tier A, mean over opponent matches)"); ax.set_xticks(xs)
    ax.legend(facecolor=BG, labelcolor=FG, edgecolor="#374151", fontsize=8, loc="upper right")
    n = len(final["champion"]["verified"]["per_match"])
    style(ax, f"Evolved vs greedy at equal budget — {final['our']} v {final['their']} ({n} matches)")
    fig.tight_layout(); fig.savefig(path, dpi=150, facecolor=BG); plt.close(fig)


def main() -> None:
    config.EVAL_DIR.mkdir(exist_ok=True)
    df = S.all_components()
    demo = expert.run(df, ["Spain", "England"])
    counts = df.groupby("team").match_id.nunique()
    all_teams = sorted(t for t, n in counts.items() if n >= 3)
    res_all = expert.run(df, all_teams) if len(all_teams) > 2 else None
    chart_expert(demo, res_all, config.EVAL_DIR / "expert_agreement.png")
    print(demo["sentence"])
    if res_all:
        print(res_all["sentence"].replace("held-out games", f"held-out games across {len(all_teams)} teams"))
    x = xg.run()
    chart_xg(x, config.EVAL_DIR / "c_vs_xg.png")
    print(f"4E.3: Pearson r={x['pearson_r']} Spearman r={x['spearman_r']} n={x['n']}")

    from app.optim import run as OPT
    final = OPT.LAST.get("England|Spain|ga")
    if final is None:
        final = OPT.run_optimize(our="England", their="Spain", method="ga", write_lineage=False)
    chart_ga(final, config.EVAL_DIR / "ga_vs_greedy.png")

    abl = {}
    for v in ("in_sample", "held_out"):
        p = config.EVAL_DIR / f"score_ablation_{v}.json"
        if p.exists():
            d = json.loads(p.read_text()); abl[v] = {k: val for k, val in d.items() if k != "rows"}
    absence = None
    p = config.EVAL_DIR / "absence.json"
    if p.exists():
        a = json.loads(p.read_text())
        absence = {k: v for k, v in a.items() if k != "rows"}
        absence["rows"] = [{k: r[k] for k in ("team", "match_id", "player", "name", "full_match_absence", "absent_minutes", "predicted_dC", "observed_dC")}
                           for r in a.get("rows", [])]

    summary = {
        "expert_agreement_demo": {k: v for k, v in demo.items() if k != "folds"},
        "expert_agreement_all": ({k: v for k, v in res_all.items() if k != "folds"} if res_all else None),
        "expert_folds_demo": [{k: f[k] for k in ("team", "match_id", "n", "hit", "spearman", "chance")} | {"prediction": f["prediction"]["name"], "truth_rank": f["prediction"]["truth_rank"], "most_touches_hit": f["most_touches"]["hit"]} for f in demo["folds"]],
        "c_vs_xg": {**{k: v for k, v in x.items() if k != "rows"},
                    "points": [{"match_id": r["match_id"], "team": r["team"], "C": r["C_raw"], "xg": r["xg"]} for r in x["rows"]]},
        "absence_prediction": absence,
        "score_ablation": abl,
        "evolved_vs_greedy": {"our": final["our"], "their": final["their"], "champion_dC": final["champion"]["dC_mean"],
                              "champion_committed": final["champion"]["committed"], "greedy_equal_budget_dC": final["greedy"]["equal_budget"]["dC_mean"],
                              "comparison": final["comparison"], "gene_ablation": [{"cell": a["cell"], "marginal_dC": a["marginal_dC"]} for a in final["ablation"]]},
        "charts": ["expert_agreement.png", "c_vs_xg.png", "ga_vs_greedy.png", "score_ablation_in_sample.png", "score_ablation_held_out.png"],
        "reporting_rules": "counts beside percentages; every metric beside its baseline; fixed seeds (42); leakage guard tests/test_leakage.py",
    }
    (config.EVAL_DIR / "summary.json").write_text(json.dumps(summary, indent=1, default=str))
    print("wrote", config.EVAL_DIR / "summary.json")


if __name__ == "__main__":
    main()
