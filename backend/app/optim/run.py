"""Optimizer orchestration (brief 4.3-4.5): greedy baseline -> GA stream -> Tier A verification of the
champion -> greedy at equal budget -> per-gene ablation -> lineage writeback into `catalog`."""
from __future__ import annotations

import datetime as dt
import json
import logging
import statistics
import time
import uuid
from typing import Iterator

from app.graph import cypher as Q
from app.graph import db
from app.metrics import formulas as F
from app.optim.candidates import Pools, build_pools
from app.optim.ga import evolve
from app.optim.greedy import cell_key, fitness_of, greedy
from app.sim.tier_a import simulate_match
from app.sim.tier_b import FastEngine

log = logging.getLogger(__name__)
LAST: dict[str, dict] = {}


def _slim(per: dict, keep_network: bool) -> dict:
    d = {k: v for k, v in per.items() if k not in ("network_after",) or keep_network}
    d["rerouted_edges"] = per["rerouted_edges"][:60]
    return d


def tier_a_plan(team: str, plan: list[dict], match_ids: list[int], windows: list[str] | None, keep_network_for: int | None = None) -> dict:
    per = [simulate_match(mid, team, plan, windows) for mid in match_ids]
    vals = [p["dC_pct"] for p in per]
    return {"dC_mean": round(statistics.fmean(vals), 3) if vals else 0.0,
            "dC_std": round(statistics.pstdev(vals), 3) if len(vals) > 1 else 0.0,
            "per_match": [_slim(p, p["match_id"] == keep_network_for) for p in per], "basis": "modeled", "tier": "A"}


def _kmat_rows(pools: Pools) -> list[dict]:
    return [{"presser": x, "target": y, "k": k, **det} for (x, y), (k, det) in pools.kmat.items()]


def _write_lineage(run_id: str, matchup: str, history: list[dict], champion: dict, greedy_res: dict) -> str:
    cat = db.catalog()
    created = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    prev = None
    gid = f"plan_{run_id}_greedy"
    cat.query(Q.CAT_CREATE_PLAN, {"id": gid, "gen": -1, "matchup": matchup, "created": created,
                                  "json": json.dumps({"genes": greedy_res["genes_described"], "dC_mean": greedy_res["dC_mean"]}),
                                  "fitness": float(greedy_res["fitness"]), "run_id": run_id, "kind": "greedy_seed"})
    prev = gid
    last_json = None
    for h in history:
        pid = f"plan_{run_id}_g{h['gen']}"
        j = json.dumps({"genes": h["champion_genes"], "dC_mean": h["best_dC_mean"], "dC_std": h["best_dC_std"]})
        cat.query(Q.CAT_CREATE_PLAN, {"id": pid, "gen": int(h["gen"]), "matchup": matchup, "created": created, "json": j,
                                      "fitness": float(h["best_fitness"]), "run_id": run_id,
                                      "kind": "generation_best" if j != last_json else "generation_best_unchanged"})
        cat.query(Q.CAT_LINK_PLANS, {"child": pid, "parent": prev})
        prev, last_json = pid, j
    cid = f"plan_{run_id}"
    cat.query(Q.CAT_CREATE_PLAN, {"id": cid, "gen": len(history), "matchup": matchup, "created": created,
                                  "json": json.dumps(champion), "fitness": float(champion["fitness"]), "run_id": run_id, "kind": "champion"})
    cat.query(Q.CAT_LINK_PLANS, {"child": cid, "parent": prev})
    return cid


def optimize_stream(our: str, their: str, method: str = "ga", max_commitments: int = F.MAX_COMMITMENTS,
                    force: list[str] | None = None, forbid: list[str] | None = None, seed: int = 42,
                    windows: list[str] | None = None, gens: int = F.GA_GENS, pop: int = F.GA_POP,
                    write_lineage: bool = True) -> Iterator[dict]:
    t0 = time.time()
    run_id = uuid.uuid4().hex[:10]
    pools = build_pools(our, their)
    engine = FastEngine(their, pools.match_ids, windows)
    matchup = f"{our} v {their}"
    start_ev = {"type": "start", "run_id": run_id, "our": our, "their": their, "method": method, "match_ids": pools.match_ids,
                "pressers": pools.pressers, "targets": pools.targets, "lanes": pools.lanes, "kmat": _kmat_rows(pools),
                "seed": seed, "max_commitments": max_commitments, "windows": windows or list(F.WINDOWS)}
    yield start_ev

    g = greedy(engine, pools, max_commitments, force, forbid)
    greedy_pub = {k: v for k, v in g.items() if k not in ("genes", "plan", "per_match")}
    greedy_pub["cells"] = [cell_key(x) for x in g["genes"]]
    greedy_ev = {"type": "greedy", **greedy_pub}
    yield greedy_ev

    ga_result = None
    champion_genes = list(g["genes"])
    if method == "ga":
        seeds = [g["genes"][:i] for i in range(len(g["genes"]), 0, -1)] or [[]]
        for ev in evolve(engine, pools, seeds, seed=seed, gens=gens, pop_size=pop, n_genes=max_commitments):
            if ev["type"] == "generation":
                yield {**ev, "seconds": round(time.time() - t0, 2)}
            else:
                ga_result = ev
        champion_genes = list(ga_result["champion"]["genes"])

    demo_mid = pools.match_ids[-1] if pools.match_ids else None
    champ_plan = pools.genes_to_plan(champion_genes)
    champ_A = tier_a_plan(their, champ_plan, pools.match_ids, windows, keep_network_for=demo_mid)
    budget = len(champion_genes)
    greedy_equal = g["genes"][:budget]
    greedy_A = tier_a_plan(their, pools.genes_to_plan(greedy_equal), pools.match_ids, windows)

    ablation = []
    for i, gene in enumerate(champion_genes):
        without = [x for j, x in enumerate(champion_genes) if j != i]
        res = tier_a_plan(their, pools.genes_to_plan(without), pools.match_ids, windows)
        ablation.append({"gene": pools.describe_gene(gene), "cell": cell_key(gene), "dC_without": res["dC_mean"],
                         "marginal_dC": round(champ_A["dC_mean"] - res["dC_mean"], 3)})

    comparison = []
    bb = ga_result["best_by_budget"] if ga_result else {}
    for b in range(1, max_commitments + 1):
        row = {"budget": b}
        if b <= len(g["genes"]):
            row["greedy_dC"] = tier_a_plan(their, pools.genes_to_plan(g["genes"][:b]), pools.match_ids, windows)["dC_mean"]
        if b in bb:
            row["ga_dC"] = tier_a_plan(their, pools.genes_to_plan(bb[b]["genes"]), pools.match_ids, windows)["dC_mean"]
            row["ga_genes"] = [pools.describe_gene(x) for x in bb[b]["genes"]]
        comparison.append(row)

    champion = {"genes": [pools.describe_gene(x) for x in champion_genes], "cells": [cell_key(x) for x in champion_genes],
                "plan": champ_plan, "committed": budget,
                "fitness": fitness_of(champ_A["dC_mean"], budget), "dC_mean": champ_A["dC_mean"], "dC_std": champ_A["dC_std"],
                "tier_b_dC_mean": (ga_result["champion"]["dC_mean"] if ga_result else g["dC_mean"]),
                "verified": champ_A, "basis": "modeled"}
    plan_id = None
    if write_lineage and method == "ga" and ga_result:
        try:
            plan_id = _write_lineage(run_id, matchup, ga_result["history"], {k: v for k, v in champion.items() if k not in ("verified", "plan")}, g)
        except Exception as exc:  # lineage is on the cut list; never fail the run for it
            log.warning("lineage writeback failed: %s", exc)
    refs = sorted({r for gd in champion["genes"] for r in gd["refs"]} | {f"match:{m}" for m in pools.match_ids})
    final = {"type": "final", "run_id": run_id, "plan_id": plan_id, "our": our, "their": their, "method": method,
             "champion": champion,
             "greedy": {"genes": g["genes_described"], "cells": greedy_pub["cells"], "committed": len(g["genes"]),
                        "dC_mean": greedy_A["dC_mean"] if budget == len(g["genes"]) else tier_a_plan(their, g["plan"], pools.match_ids, windows)["dC_mean"],
                        "equal_budget": {"genes": [pools.describe_gene(x) for x in greedy_equal], "dC_mean": greedy_A["dC_mean"], "dC_std": greedy_A["dC_std"]},
                        "steps": g["steps"], "knee": g["knee"]},
             "ablation": ablation, "comparison": comparison,
             "evolution": (ga_result["history"] if ga_result else []),
             "start": start_ev, "greedy_event": greedy_ev,
             "evaluations": engine.evaluations, "seconds": round(time.time() - t0, 2), "refs": refs, "basis": "modeled"}
    LAST[f"{our}|{their}|{method}"] = final
    yield final


def run_optimize(**kw) -> dict:
    final = None
    for ev in optimize_stream(**kw):
        final = ev
    return final
