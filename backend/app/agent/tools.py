"""Agent tools (Phase 5). Every tool returns data + `refs` (player:<id>, edge:<src>-><dst>, match:<id>)."""
from __future__ import annotations

import datetime as dt
import json
import uuid

from app import config
from app.graph import cypher as Q
from app.graph import db
from app.metrics import formulas as F
from app.metrics import scores as S
from app.optim import run as OPT
from app.sim import engine as SIM
from app.sim.empirical import empirical_window as _empirical_window

MAX_RESULT_CHARS = 7000


def _tournament() -> dict:
    from app.ingest.statsbomb import pick_tournament
    t = pick_tournament()
    return {"our": t["our"], "their": t["their"], "comp_id": t["comp_id"], "season_id": t["season_id"]}


def list_matches(team: str | None = None) -> dict:
    ms = S.catalog_matches()
    if team:
        ms = [m for m in ms if any(t["team"] == team for t in m["teams"])]
    rows = [{"id": int(m["id"]), "date": m.get("date"), "home": m.get("home"), "away": m.get("away"), "score": m.get("score"),
             "stage": m.get("stage"), "xg": {t["team"]: t.get("xg") for t in m["teams"]}} for m in ms]
    return {"team": team, "n": len(rows), "matches": rows, "refs": [f"match:{r['id']}" for r in rows]}


def team_profile(team: str) -> dict:
    df = S.all_components()
    agg = S.composite(df)
    regain = S.regain_profile(df)
    mine = agg[agg.team == team].copy()
    if mine.empty:
        return {"error": f"no ingested matches for team {team!r}", "teams": S.teams_in_catalog(), "refs": []}
    mine["regain"] = mine.id.map(regain).fillna(0.0)
    top = mine.head(8)
    pressers = mine.assign(pv=mine.pressures * mine.regain).sort_values("pv", ascending=False).head(6)
    from app.optim.candidates import top_lanes
    mids = S.team_match_ids(team)
    lanes = top_lanes(team, mids, 5)
    names = dict(zip(agg.id.astype(int), agg.name))
    out = {
        "team": team, "matches": mids, "n_matches": len(mids),
        "top_players_by_S_p": [{"id": int(r.id), "name": r.name, "position": r.position, "s_p_mean": round(float(r.s_p_mean), 3),
                                "s_p_std": round(float(r.s_p_std), 3), "press_resist": round(float(r.press_resist), 3),
                                "minutes": round(float(r.minutes), 1)} for r in top.itertuples()],
        "top_pressers": [{"id": int(r.id), "name": r.name, "pressures": int(r.pressures), "regain_rate": round(float(r.regain), 3)}
                         for r in pressers.itertuples()],
        "top_progressive_lanes": [{"src": l["src"], "dst": l["dst"], "src_name": names.get(l["src"]), "dst_name": names.get(l["dst"]),
                                   "progressive": l["progressive"], "completed": l["completed"]} for l in lanes],
        "definitions": {"S_p": "0.30 z(PageRank share) + 0.30 z(betweenness share) + 0.25 z(progressive involvement share) + 0.15 z(press resistance), z within match, mean over matches",
                        "press_resist": "comp rate under pressure minus overall, min-maxed within squad (tournament level)"},
    }
    out["refs"] = [f"player:{p['id']}" for p in out["top_players_by_S_p"]] + [f"edge:{l['src']}->{l['dst']}" for l in out["top_progressive_lanes"]] + [f"match:{m}" for m in mids]
    return out


def player_scores(team: str, weights: dict | None = None) -> dict:
    rows = S.player_scores(team, weights)
    keep = ["rank", "id", "name", "position", "n_matches", "minutes", "s_p_mean", "s_p_std", "pr_share", "bt_share", "prog_share", "press_resist"]
    rows = [{k: r[k] for k in keep} for r in rows[:16]]
    return {"team": team, "weights": {**F.W_S, **(weights or {})}, "players": rows, "refs": [f"player:{r['id']}" for r in rows]}


def _player_row(pid: int):
    df = S.all_components()
    sub = df[df.id == pid]
    return df, sub


def decompose_influence(player_id: int) -> dict:
    df, sub = _player_row(int(player_id))
    if sub.empty:
        return {"error": f"unknown player {player_id}", "refs": []}
    team = sub.team.iloc[0]; name = sub.name.iloc[0]
    names = dict(zip(df.id.astype(int), df.name))
    inn: dict[int, dict] = {}; out: dict[int, dict] = {}
    mids = sorted(int(m) for m in sub.match_id.unique())
    for mid in mids:
        for e in db.pull_network(db.match_graph(mid), team):
            if e["dst"] == player_id:
                o = inn.setdefault(e["src"], {"completed": 0, "progressive": 0}); o["completed"] += e["completed"]; o["progressive"] += e["progressive"]
            if e["src"] == player_id:
                o = out.setdefault(e["dst"], {"completed": 0, "progressive": 0}); o["completed"] += e["completed"]; o["progressive"] += e["progressive"]
    def top(d, key):
        rows = sorted(({"player": k, "name": names.get(k, str(k)), **v} for k, v in d.items()), key=lambda r: (-r["progressive"], -r["completed"]))[:5]
        return rows
    agg = S.composite(df); me = agg[agg.id == player_id].iloc[0]
    res = {"player": player_id, "name": name, "team": team, "position": me.position, "matches": mids,
           "s_p_mean": round(float(me.s_p_mean), 3), "s_p_std": round(float(me.s_p_std), 3),
           "shares_mean": {"pagerank": round(float(me.pr_share), 3), "betweenness": round(float(me.bt_share), 3), "progressive_involvement": round(float(me.prog_share), 3)},
           "top_in_lanes": top(inn, "in"), "top_out_lanes": top(out, "out")}
    res["refs"] = [f"player:{player_id}"] + [f"edge:{r['player']}->{player_id}" for r in res["top_in_lanes"]] + [f"edge:{player_id}->{r['player']}" for r in res["top_out_lanes"]]
    return res


def pressure_profile(player_id: int) -> dict:
    df, sub = _player_row(int(player_id))
    if sub.empty:
        return {"error": f"unknown player {player_id}", "refs": []}
    regain = S.regain_profile(df); pr = S.press_resist_profile(df)
    pz, rz = S.zone_profiles(df)
    def top_zones(h):
        tot = sum(h) or 1
        idx = sorted(range(len(h)), key=lambda i: -h[i])[:5]
        return [{"zone": F.zone_id_from_index(i), "share": round(h[i] / tot, 3)} for i in idx if h[i] > 0]
    return {"player": player_id, "name": sub.name.iloc[0], "team": sub.team.iloc[0],
            "pressures": int(sub.pressures.sum()), "regains": int(sub.regains.sum()), "regain_rate": round(float(regain.get(player_id, 0.0)), 3),
            "press_resist": round(float(pr.get(player_id, 0.5)), 3),
            "pressured_passes": int(sub.pressured_att.sum()), "passes": int(sub.pass_att.sum()),
            "pressing_zones_top": top_zones(pz.get(player_id, [0] * F.N_ZONES)),
            "receiving_zones_top": top_zones(rz.get(player_id, [0] * F.N_ZONES)),
            "note": "zones are 6x4 (c=column from own goal, r=row); pressing zones are in the presser's attacking frame",
            "refs": [f"player:{player_id}"]}


def empirical_window(team: str, player_id: int) -> dict:
    res = _empirical_window(team, int(player_id))
    if res is None:
        return {"available": False, "refs": []}
    res.setdefault("refs", [f"player:{player_id}"])
    res.pop("windows", None) if len(json.dumps(res)) > MAX_RESULT_CHARS else None
    return res


def simulate(team: str, interventions: list[dict], match_ids: list[int] | None = None, windows: list[str] | None = None) -> dict:
    res = SIM.simulate(team, interventions, match_ids, windows, with_empirical=True)
    per = [{"match_id": p["match_id"], "dC_pct": p["dC_pct"], "M": [p["M_before"], p["M_after"]], "D": [p["D_before"], p["D_after"]],
            "V": [p["V_before"], p["V_after"]], "inheritance": p["inheritance"][:3], "removed": p["removed"], "redistributed": p["redistributed"]}
           for p in res["per_match"]]
    emp = [{k: v for k, v in e.items() if k != "windows"} for e in res["empirical"]]
    return {"team": team, "plan": res["plan"], "basis": "modeled", "aggregate": res["aggregate"], "per_match": per,
            "empirical": emp, "refs": res["refs"]}


def optimize(our: str, their: str, method: str = "ga", max_commitments: int = 4, force: list[str] | None = None,
             forbid: list[str] | None = None, seed: int = 42) -> dict:
    key = f"{our}|{their}|{method}"
    final = OPT.LAST.get(key) if not (force or forbid) and max_commitments == 4 and seed == 42 else None
    if final is None:
        final = OPT.run_optimize(our=our, their=their, method=method, max_commitments=max_commitments, force=force, forbid=forbid, seed=seed)
    c = final["champion"]
    return {"run_id": final["run_id"], "plan_id": final["plan_id"], "our": our, "their": their, "method": method, "basis": "modeled",
            "champion": {"genes": c["genes"], "committed": c["committed"], "dC_mean": c["dC_mean"], "dC_std": c["dC_std"], "fitness": c["fitness"],
                         "per_match": [{"match_id": p["match_id"], "dC_pct": p["dC_pct"]} for p in c["verified"]["per_match"]]},
            "greedy": {"genes": final["greedy"]["genes"], "dC_mean": final["greedy"]["dC_mean"], "equal_budget_dC_mean": final["greedy"]["equal_budget"]["dC_mean"],
                       "steps": [{"cell": s["cell"], "dC_mean": s["dC_mean"], "marginal": s["marginal"]} for s in final["greedy"]["steps"]]},
            "gene_ablation": [{"cell": a["cell"], "marginal_dC": a["marginal_dC"]} for a in final["ablation"]],
            "evolved_vs_greedy_by_budget": final["comparison"], "evaluations": final["evaluations"], "seconds": final["seconds"],
            "refs": final["refs"]}


def eval_summary() -> dict:
    p = config.EVAL_DIR / "summary.json"
    if not p.exists():
        return {"available": False, "note": "run scripts/run_evals.py", "refs": []}
    s = json.loads(p.read_text())
    s["calibration"] = {"allowed_claims": ["agrees with elite targeting decisions out-of-sample", "predicts the structural impact of real absences", "objective tracks xG"],
                        "forbidden_claims": ["better than experts", "predicts match outcomes"],
                        "rule": "always print counts beside percentages and every metric beside its baseline"}
    s["refs"] = []
    return s


def save_plan(our: str, their: str, genes: list[dict], dC_mean: float | None = None, name: str | None = None, notes: str | None = None) -> dict:
    pid = f"plan_saved_{uuid.uuid4().hex[:8]}"
    created = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    db.catalog().query(Q.CAT_CREATE_PLAN, {"id": pid, "gen": -2, "matchup": f"{our} v {their}", "created": created,
                                           "json": json.dumps({"name": name, "genes": genes, "dC_mean": dC_mean, "notes": notes}),
                                           "fitness": float(dC_mean or 0.0), "run_id": "saved", "kind": "saved"})
    return {"plan_id": pid, "saved": True, "refs": []}


INTERVENTION_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["suppress", "cut_lane", "delete"]},
        "target_player": {"type": "integer", "description": "player id for suppress/delete"},
        "edge": {"type": "object", "properties": {"src": {"type": "integer"}, "dst": {"type": "integer"}}, "required": ["src", "dst"]},
        "presser": {"type": "integer", "description": "our player assigned to the job (gives a matchup-derived k)"},
        "k_override": {"type": "number", "description": "optional multiplier override in [0,1]"},
    },
    "required": ["type"],
}

TOOLS = [
    {"name": "list_matches", "description": "Ingested matches (optionally for one team) with scores and xG.",
     "input_schema": {"type": "object", "properties": {"team": {"type": "string"}}}},
    {"name": "team_profile", "description": "Team overview: top players by composite score S_p, top pressers (pressures x regain), top progressive lanes, match ids.",
     "input_schema": {"type": "object", "properties": {"team": {"type": "string"}}, "required": ["team"]}},
    {"name": "player_scores", "description": "Ranked composite scores S_p for a team; weights override {pr, bt, prog, press_resist}.",
     "input_schema": {"type": "object", "properties": {"team": {"type": "string"}, "weights": {"type": "object"}}, "required": ["team"]}},
    {"name": "decompose_influence", "description": "Why a player matters: PageRank/betweenness/progressive shares and top in/out lanes by progressive volume.",
     "input_schema": {"type": "object", "properties": {"player_id": {"type": "integer"}}, "required": ["player_id"]}},
    {"name": "pressure_profile", "description": "A player's pressing (volume, regain rate, zones) and receiving zones and press resistance.",
     "input_schema": {"type": "object", "properties": {"player_id": {"type": "integer"}}, "required": ["player_id"]}},
    {"name": "empirical_window", "description": "Real evidence: minutes the player did NOT play for his team and the team's observed circulation then vs comparable windows (basis empirical).",
     "input_schema": {"type": "object", "properties": {"team": {"type": "string"}, "player_id": {"type": "integer"}}, "required": ["team", "player_id"]}},
    {"name": "simulate", "description": "Counterfactual (basis modeled): clone each match graph in FalkorDB, suppress players / cut lanes / delete, reroute, recompute circulation C and return ΔC% per match plus mean±std.",
     "input_schema": {"type": "object", "properties": {"team": {"type": "string", "description": "the team being disrupted"},
                                                        "interventions": {"type": "array", "items": INTERVENTION_SCHEMA},
                                                        "match_ids": {"type": "array", "items": {"type": "integer"}},
                                                        "windows": {"type": "array", "items": {"type": "string"}}},
                      "required": ["team", "interventions"]}},
    {"name": "optimize", "description": "Evolve (GA, default) or greedily build the cheapest disruption plan of our pressers vs their key players/lanes; returns the Tier-A-verified champion, greedy baseline at equal budget, per-gene ablation.",
     "input_schema": {"type": "object", "properties": {"our": {"type": "string"}, "their": {"type": "string"},
                                                        "method": {"type": "string", "enum": ["ga", "greedy"]},
                                                        "max_commitments": {"type": "integer"},
                                                        "force": {"type": "array", "items": {"type": "string"}},
                                                        "forbid": {"type": "array", "items": {"type": "string"}}},
                      "required": ["our", "their"]}},
    {"name": "eval_summary", "description": "Held-out evaluation results with baselines (expert agreement, absence prediction, C vs xG) for 'why should I trust this?' questions.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "save_plan", "description": "Save a plan into the FalkorDB catalog; returns plan_id.",
     "input_schema": {"type": "object", "properties": {"our": {"type": "string"}, "their": {"type": "string"}, "genes": {"type": "array", "items": {"type": "object"}},
                                                        "dC_mean": {"type": "number"}, "name": {"type": "string"}, "notes": {"type": "string"}},
                      "required": ["our", "their", "genes"]}},
]

DISPATCH = {
    "list_matches": list_matches, "team_profile": team_profile, "player_scores": player_scores,
    "decompose_influence": decompose_influence, "pressure_profile": pressure_profile, "empirical_window": empirical_window,
    "simulate": simulate, "optimize": optimize, "eval_summary": eval_summary, "save_plan": save_plan,
}


def dispatch(name: str, args: dict) -> dict:
    fn = DISPATCH.get(name)
    if fn is None:
        return {"error": f"unknown tool {name}", "refs": []}
    try:
        res = fn(**(args or {}))
    except TypeError as exc:
        return {"error": f"bad arguments for {name}: {exc}", "refs": []}
    except Exception as exc:  # surfaced to the model as an error result
        return {"error": f"{type(exc).__name__}: {exc}", "refs": []}
    if not isinstance(res, dict):
        res = {"result": res, "refs": []}
    res.setdefault("refs", [])
    return res


def serialize(res: dict) -> str:
    s = json.dumps(res, default=str)
    if len(s) > MAX_RESULT_CHARS:
        s = s[:MAX_RESULT_CHARS] + f'... [truncated {len(s) - MAX_RESULT_CHARS} chars]'
    return s
