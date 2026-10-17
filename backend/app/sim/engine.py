"""Simulation service (Phase 4.1): request -> resolve k -> empirical check -> Tier A per match -> diff."""
from __future__ import annotations

import statistics

from app.metrics import formulas as F
from app.metrics import scores as S
from app.sim.empirical import empirical_window
from app.sim.tier_a import simulate_match


def resolve_interventions(team: str, interventions: list[dict], df=None, exclude_match: int | None = None) -> list[dict]:
    """Attach a concrete k (and its provenance) to every intervention."""
    df = df if df is not None else S.all_components()
    klook = S.k_lookup(df, exclude_match)
    plan = []
    for iv in interventions:
        t = iv["type"]
        out = {"type": t}
        if t in ("suppress", "delete"):
            out["target_player"] = int(iv["target_player"])
            if t == "delete":
                out["k"] = 0.0
            elif iv.get("k_override") is not None:
                out["k"] = round(F.clamp(float(iv["k_override"]), 0.0, 1.0), F.K_DECIMALS)
                out["k_source"] = "override"
            elif iv.get("presser") is not None:
                out["presser"] = int(iv["presser"])
                out["k"], out["k_detail"] = klook(out["presser"], out["target_player"])
                out["k_source"] = "matchup"
            else:
                out["k"] = F.K_DEFAULT
                out["k_source"] = "default"
            if iv.get("presser") is not None:
                out["presser"] = int(iv["presser"])
        elif t == "cut_lane":
            out["edge"] = {"src": int(iv["edge"]["src"]), "dst": int(iv["edge"]["dst"])}
            out["k"] = round(float(iv["k_override"]), F.K_DECIMALS) if iv.get("k_override") is not None else F.K_LANE
            out["k_source"] = "override" if iv.get("k_override") is not None else "k_lane"
            if iv.get("presser") is not None:
                out["presser"] = int(iv["presser"])
        else:
            raise ValueError(f"unknown intervention type {t!r}")
        plan.append(out)
    return plan


def plan_refs(plan: list[dict]) -> list[str]:
    refs = []
    for iv in plan:
        if "target_player" in iv:
            refs.append(f"player:{iv['target_player']}")
        if "edge" in iv:
            refs.append(f"edge:{iv['edge']['src']}->{iv['edge']['dst']}")
        if iv.get("presser") is not None:
            refs.append(f"player:{iv['presser']}")
    return sorted(set(refs))


def simulate(team: str, interventions: list[dict], match_ids: list[int] | None = None,
             windows: list[str] | None = None, with_empirical: bool = True) -> dict:
    mids = match_ids or S.team_match_ids(team)
    plan = resolve_interventions(team, interventions)
    per = [simulate_match(mid, team, plan, windows) for mid in mids]
    vals = [p["dC_pct"] for p in per]
    empirical = []
    if with_empirical:
        for iv in plan:
            if iv["type"] in ("suppress", "delete"):
                e = empirical_window(team, iv["target_player"])
                if e:
                    empirical.append(e)
    return {
        "team": team, "match_ids": mids, "windows": windows or list(F.WINDOWS), "plan": plan, "basis": "modeled",
        "aggregate": {"dC_mean": round(statistics.fmean(vals), 3) if vals else 0.0,
                      "dC_std": round(statistics.pstdev(vals), 3) if len(vals) > 1 else 0.0, "n": len(vals)},
        "per_match": per,
        "empirical": empirical,
        "refs": plan_refs(plan) + [f"match:{m}" for m in mids],
    }
