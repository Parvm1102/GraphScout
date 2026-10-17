"""Empirical evidence (Phase 4.1 engine step 1): real minutes the target did NOT play.

For a team and player: every full 15-minute window of the team's matches in which the player was
absent (not in the lineup, or subbed off/on). If >= 20 such minutes exist, compare the team's
per-minute un-normalised circulation in those windows with its per-minute circulation in the SAME
window ids of matches/windows where he played. Observed, not modeled: basis = "empirical".
"""
from __future__ import annotations

from app.graph import cypher as Q
from app.graph import db
from app.metrics import formulas as F
from app.metrics.circulation import c_raw, components
from app.metrics.scores import team_match_ids
from app.sim.tier_b import load_edge_list

MIN_ABSENT_MINUTES = 20


def _window_bounds(i: int, end_minute: float) -> tuple[float, float]:
    lo = 15.0 * i
    hi = end_minute if i == len(F.WINDOWS) - 1 else 15.0 * (i + 1)
    return lo, hi


def appearances(player_id: int) -> dict[int, dict]:
    rows = db.q(db.catalog(), Q.CAT_APPEARANCES_OF, {"pid": player_id}, read_only=True)
    return {int(r[0]): {"team": r[1], "minutes": float(r[2]), "from_min": float(r[3]), "to_min": float(r[4]),
                        "end_minute": float(r[5])} for r in rows}


def match_end_minutes(team: str) -> dict[int, float]:
    rows = db.q(db.catalog(), Q.CAT_TEAM_MATCHES, {"team": team}, read_only=True)
    out = {}
    for r in rows:
        p = db.props(r[0])
        out[int(p["id"])] = float(p.get("end_minute", 90))
    return out


def absence_windows(team: str, player_id: int) -> list[dict]:
    """Per team match: window ids where the player was absent for the whole window, and where present."""
    apps = appearances(player_id)
    out = []
    for mid, end_minute in match_end_minutes(team).items():
        a = apps.get(mid)
        absent, present = [], []
        for i, w in enumerate(F.WINDOWS):
            lo, hi = _window_bounds(i, end_minute)
            if hi <= lo:
                continue
            if a is None or a["to_min"] <= lo or a["from_min"] >= hi:
                absent.append(w)
            elif a["from_min"] <= lo and a["to_min"] >= hi:
                present.append(w)
        absent_minutes = sum(_window_bounds(F.WINDOWS.index(w), end_minute)[1] - _window_bounds(F.WINDOWS.index(w), end_minute)[0] for w in absent)
        out.append({"match_id": mid, "absent": absent, "present": present, "absent_minutes": round(absent_minutes, 1),
                    "played": a is not None, "end_minute": end_minute})
    return out


def empirical_window(team: str, player_id: int) -> dict | None:
    aw = absence_windows(team, player_id)
    total_absent = sum(m["absent_minutes"] for m in aw)
    if total_absent < MIN_ABSENT_MINUTES:
        return {"player": player_id, "team": team, "basis": "empirical", "available": False,
                "absent_minutes": round(total_absent, 1), "reason": f"fewer than {MIN_ABSENT_MINUTES} absent minutes"}
    obs_c, obs_min, base_c, base_min = 0.0, 0.0, 0.0, 0.0
    detail = []
    absent_ids = {w for m in aw for w in m["absent"]}
    for m in aw:
        mid, end = m["match_id"], m["end_minute"]
        if m["absent"]:
            el = load_edge_list(mid, team, m["absent"])
            c = c_raw(components(el))
            obs_c += c; obs_min += m["absent_minutes"]
            detail.append({"match_id": mid, "windows": m["absent"], "minutes": m["absent_minutes"], "c_raw": round(c, 2), "kind": "absent"})
        pres = [w for w in m["present"] if w in absent_ids]
        if pres:
            el = load_edge_list(mid, team, pres)
            c = c_raw(components(el))
            mins = sum(_window_bounds(F.WINDOWS.index(w), end)[1] - _window_bounds(F.WINDOWS.index(w), end)[0] for w in pres)
            base_c += c; base_min += mins
            detail.append({"match_id": mid, "windows": pres, "minutes": round(mins, 1), "c_raw": round(c, 2), "kind": "present"})
    if obs_min <= 0 or base_min <= 0 or base_c <= 0:
        return {"player": player_id, "team": team, "basis": "empirical", "available": False,
                "absent_minutes": round(total_absent, 1), "reason": "no comparable windows with the player present"}
    rate_obs, rate_base = obs_c / obs_min, base_c / base_min
    return {"player": player_id, "team": team, "basis": "empirical", "available": True,
            "absent_minutes": round(obs_min, 1), "comparable_minutes": round(base_min, 1),
            "c_per_min_absent": round(rate_obs, 3), "c_per_min_present": round(rate_base, 3),
            "dC_pct": round((rate_obs / rate_base - 1.0) * 100.0, 2),
            "windows": detail,
            "refs": [f"match:{d['match_id']}" for d in detail if d["kind"] == "absent"] + [f"player:{player_id}"]}
