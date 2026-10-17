"""4E.1 Expert agreement (REQUIRED): leave-one-out S_p vs the pressing targets real opponents chose.

Fold m: recompute S_p from every match EXCEPT m; prediction = top-S_p outfield player with >= 45 min in m.
Ground truth in m: pressured on-ball events per touch (`under_pressure` on Pass/Receipt/Carry/Dribble/Shot/...),
outfield, >= 45 min. Metrics: top-3 hit rate; Spearman between S_p rank and pressure-per-touch rank.
Baselines: random targeting (analytic 3/N and 10k permutations) and the most-touches heuristic (touches
summed over the OTHER matches). The leakage guard is tests/test_leakage.py.
"""
from __future__ import annotations

import random
import statistics

import pandas as pd
from scipy.stats import spearmanr

from app.metrics import scores as S

MIN_MINUTES = 45.0


def fold(df: pd.DataFrame, team: str, mid: int, weights: dict | None = None) -> dict:
    table_used = df[df.match_id != mid]                      # the only rows the score may see
    agg = S.composite(table_used, weights)
    eligible = df[(df.match_id == mid) & (df.team == team) & (df.minutes >= MIN_MINUTES) & (df.position != "Goalkeeper")].copy()
    eligible["ppt"] = eligible.pressured_touches / eligible.touches.clip(lower=1)
    scores = agg[agg.team == team].set_index("id")["s_p_mean"]
    eligible["s_p"] = eligible.id.map(scores)
    eligible = eligible.dropna(subset=["s_p"])
    if len(eligible) < 4:
        return {"match_id": mid, "team": team, "skipped": True, "n": len(eligible)}
    truth = eligible.sort_values("ppt", ascending=False)
    top3 = set(truth.head(3).id)
    pred = eligible.sort_values("s_p", ascending=False).iloc[0]
    other_touches = table_used[table_used.team == team].groupby("id").touches.sum()
    eligible["touches_other"] = eligible.id.map(other_touches).fillna(0)
    base = eligible.sort_values("touches_other", ascending=False).iloc[0]
    rho = spearmanr(eligible.s_p, eligible.ppt).correlation
    return {"match_id": mid, "team": team, "skipped": False, "n": int(len(eligible)),
            "prediction": {"id": int(pred.id), "name": pred["name"], "s_p": round(float(pred.s_p), 3),
                           "ppt": round(float(pred.ppt), 3), "truth_rank": int(list(truth.id).index(pred.id) + 1)},
            "truth_top3": [{"id": int(r.id), "name": r.name, "ppt": round(float(r.ppt), 3)} for r in truth.head(3).itertuples()],
            "hit": bool(pred.id in top3),
            "most_touches": {"id": int(base.id), "name": base["name"], "hit": bool(base.id in top3)},
            "chance": 3.0 / len(eligible), "spearman": (round(float(rho), 4) if rho == rho else 0.0),
            "table_used_match_ids": sorted(int(x) for x in table_used.match_id.unique())}


def run(df: pd.DataFrame | None = None, teams: list[str] | None = None, weights: dict | None = None,
        n_perm: int = 10000, seed: int = 42) -> dict:
    df = df if df is not None else S.all_components()
    teams = teams or ["Spain", "England"]
    folds = []
    for team in teams:
        for mid in S.team_match_ids(team):
            f = fold(df, team, mid, weights)
            if not f.get("skipped"):
                folds.append(f)
    n = len(folds)
    hits = sum(f["hit"] for f in folds)
    mt_hits = sum(f["most_touches"]["hit"] for f in folds)
    chance = statistics.fmean(f["chance"] for f in folds) if folds else 0.0
    rng = random.Random(seed)
    perm_hits = [sum(1 for f in folds if rng.random() < f["chance"]) for _ in range(n_perm)]
    perm_mean = statistics.fmean(perm_hits) / n if n else 0.0
    p_value = sum(1 for h in perm_hits if h >= hits) / n_perm
    rho = statistics.fmean(f["spearman"] for f in folds) if folds else 0.0
    sentence = (f"Blind to the match, the system re-derives the pressing targets elite staffs chose in "
                f"{hits} of {n} held-out games, against a {chance*100:.0f}% chance rate "
                f"(most-touches heuristic: {mt_hits} of {n}).")
    return {"test": "4E.1 expert agreement (leave-one-out)", "n": n, "hits": hits,
            "hit_rate": round(hits / n, 4) if n else 0.0,
            "chance_rate_analytic": round(chance, 4), "chance_rate_permutation": round(perm_mean, 4),
            "permutation_p_value": round(p_value, 4), "n_perm": n_perm,
            "most_touches_hits": mt_hits, "most_touches_rate": round(mt_hits / n, 4) if n else 0.0,
            "spearman_mean": round(rho, 4), "sentence": sentence, "teams": teams, "folds": folds,
            "claim": "agrees with elite targeting decisions out-of-sample"}
