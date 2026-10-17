"""4E.3 Construct validity: un-normalised circulation C_raw per team-match vs total StatsBomb shot xG.
Correlation only, never causation."""
from __future__ import annotations

import pandas as pd
from scipy.stats import pearsonr, spearmanr

from app.metrics import scores as S
from app.metrics.circulation import c_raw, components
from app.sim.tier_b import load_edge_list


def run(write_baselines: bool = True) -> dict:
    """Also caches each team-match baseline (M0, V0, D0, C_raw) onto the catalog PLAYED edge (brief 2.1/2.5)."""
    from app.graph import cypher as Q
    from app.graph import db
    rows = []
    cat = db.catalog()
    for m in S.catalog_matches():
        for t in m["teams"]:
            el = load_edge_list(int(m["id"]), t["team"])
            comp = components(el)
            rows.append({"match_id": int(m["id"]), "team": t["team"], "xg": float(t.get("xg") or 0.0),
                         "goals": t.get("goals"), "C_raw": round(c_raw(comp), 2), "M": comp.M, "V": comp.V, "D": comp.D})
            if write_baselines:
                cat.query(Q.CAT_SET_TEAM_MATCH_PROPS, {"team": t["team"], "mid": int(m["id"]),
                                                       "props": {"M0": comp.M, "V0": comp.V, "D0": comp.D, "C_raw": round(c_raw(comp), 2), "C_base": 100.0}})
    df = pd.DataFrame(rows)
    pr = pearsonr(df.C_raw, df.xg); sr = spearmanr(df.C_raw, df.xg)
    return {"test": "4E.3 construct validity (C vs xG)", "n": int(len(df)),
            "pearson_r": round(float(pr.statistic), 4), "pearson_p": round(float(pr.pvalue), 4),
            "spearman_r": round(float(sr.correlation), 4), "spearman_p": round(float(sr.pvalue), 4),
            "rows": rows, "claim": "objective tracks xG (correlation, not causation)"}
