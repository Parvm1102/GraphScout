"""4E.2 Out-of-sample impact prediction: simulated ΔC vs observed ΔC in real absence windows.

Absence event = a team's top-4-by-S_p player (scores computed WITHOUT the test match) missing >= 20 full
15-minute windows' worth of minutes in a match (absent for the whole match, or subbed on/off).
Predicted ΔC: Tier B simulator built ONLY from that team's matches where he played, suppress at k=0.3
(delete for a full-match absence) over the same window ids. Observed ΔC: per-minute C_raw of the team in the
absent windows of the test match vs its per-minute C_raw in the same window ids of the other matches where he
played. Metrics: Pearson r and MAE (ΔC points) vs the always-predict-zero forecaster's MAE."""
from __future__ import annotations

import statistics

import pandas as pd
from scipy.stats import pearsonr

from app.metrics import formulas as F
from app.metrics import scores as S
from app.metrics.circulation import c_raw, c_score, components
from app.sim.empirical import absence_windows, _window_bounds
from app.sim.model import apply_plan
from app.sim.tier_b import load_edge_list

MIN_ABSENT = 20.0
K_ABSENCE = 0.3


def _c_rate(mid: int, team: str, wins: list[str], end: float, plan: list[dict] | None = None) -> tuple[float, float]:
    el = load_edge_list(mid, team, wins)
    mins = sum(_window_bounds(F.WINDOWS.index(w), end)[1] - _window_bounds(F.WINDOWS.index(w), end)[0] for w in wins)
    if plan:
        el, _ = apply_plan(el, plan)
    return c_raw(components(el)), mins


def run(teams: list[str] | None = None) -> dict:
    df = S.all_components()
    teams = teams or sorted(t for t, n in df.groupby("team").match_id.nunique().items() if n >= 3)
    rows = []
    for team in teams:
        mids = S.team_match_ids(team)
        for mid in mids:
            agg = S.composite(df, exclude_match=mid)
            top4 = agg[(agg.team == team) & (agg.position != "Goalkeeper")].head(4)
            for p in top4.itertuples():
                pid = int(p.id)
                aw = {m["match_id"]: m for m in absence_windows(team, pid)}
                test = aw.get(mid)
                if not test or test["absent_minutes"] < MIN_ABSENT:
                    continue
                played_mids = [m for m in mids if m != mid and aw.get(m, {}).get("played")]
                if len(played_mids) < 2:
                    continue
                wins = test["absent"]
                full = not test["played"]
                # observed: this match's absent windows vs same windows in matches where he played (whole windows)
                obs_c, obs_m = _c_rate(mid, team, wins, test["end_minute"])
                base_c = base_m = 0.0
                pred_c = pred_m = 0.0
                plan = [{"type": "delete" if full else "suppress", "target_player": pid, "k": 0.0 if full else K_ABSENCE}]
                for m in played_mids:
                    pres = [w for w in wins if w in aw[m]["present"]]
                    if not pres:
                        continue
                    c0, mm = _c_rate(m, team, pres, aw[m]["end_minute"])
                    c1, _ = _c_rate(m, team, pres, aw[m]["end_minute"], plan)
                    base_c += c0; base_m += mm; pred_c += c1; pred_m += mm
                if base_m <= 0 or base_c <= 0 or obs_m <= 0:
                    continue
                observed = (obs_c / obs_m) / (base_c / base_m) * 100.0 - 100.0
                predicted = (pred_c / base_c) * 100.0 - 100.0
                rows.append({"team": team, "match_id": mid, "player": pid, "name": p.name, "full_match_absence": full,
                             "absent_minutes": test["absent_minutes"], "windows": wins, "n_reference_matches": len(played_mids),
                             "predicted_dC": round(predicted, 2), "observed_dC": round(observed, 2)})
    if len(rows) < 3:
        return {"test": "4E.2 out-of-sample impact prediction", "n": len(rows), "rows": rows, "available": False}
    def metrics(sub: list[dict]) -> dict:
        pr = [r["predicted_dC"] for r in sub]; ob = [r["observed_dC"] for r in sub]
        if len(sub) < 3:
            return {"n": len(sub), "available": False}
        r = pearsonr(pr, ob)
        mae = statistics.fmean(abs(a - b) for a, b in zip(pr, ob))
        mae0 = statistics.fmean(abs(b) for b in ob)
        return {"n": len(sub), "available": True, "pearson_r": round(float(r.statistic), 4), "pearson_p": round(float(r.pvalue), 4),
                "mae": round(mae, 2), "mae_always_zero": round(mae0, 2), "beats_zero_forecaster": bool(mae < mae0),
                "observed_sd": round(statistics.pstdev(ob), 2)}
    overall = metrics(rows)
    return {"test": "4E.2 out-of-sample impact prediction", **overall, "k": K_ABSENCE,
            "subsets": {"full_match_absences (delete)": metrics([x for x in rows if x["full_match_absence"]]),
                        "substitution_windows (suppress k=0.3)": metrics([x for x in rows if not x["full_match_absence"]])},
            "note": "pre-specified split: a full-match absence is simulated with delete, a substitution window with suppress; "
                    "substitution windows are single 15-minute slices where M and D are small integers (high observed variance)",
            "rows": rows, "claim": "predicts the structural impact of real absences"}
