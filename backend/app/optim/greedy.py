"""Greedy baseline (brief 4.3): pick the best feasible cell, lock it, re-simulate the remaining matrix with the
locked interventions applied, repeat to max 4. One job per presser; force/forbid for human-in-the-loop re-solve."""
from __future__ import annotations

from app.metrics import formulas as F
from app.optim.candidates import Gene, Pools
from app.sim.tier_b import FastEngine


def cell_key(gene: Gene) -> str:
    x, action, tgt = gene
    return f"{x}:{action}:{tgt if action == 'mark' else f'{tgt[0]}->{tgt[1]}'}"


def parse_cell(s: str) -> Gene:
    x, action, tgt = s.split(":", 2)
    if action == "mark":
        return (int(x), "mark", int(tgt))
    a, b = tgt.split("->")
    return (int(x), "cut", (int(a), int(b)))


def feasible(gene: Gene, locked: list[Gene]) -> bool:
    x, action, tgt = gene
    for lx, la, lt in locked:
        if lx == x or (la == action and lt == tgt):
            return False
    return True


def fitness_of(dC_mean: float, committed: int) -> float:
    """Damage (−mean ΔC%) minus 1.5 per committed player. Higher is better."""
    return round(-dC_mean - F.GA_PENALTY_PER_PLAYER * committed, 4)


def greedy(engine: FastEngine, pools: Pools, max_commitments: int = F.MAX_COMMITMENTS,
           force: list[str] | None = None, forbid: list[str] | None = None) -> dict:
    cells: list[Gene] = [(x, a, t) for x in pools.presser_ids() for (a, t) in pools.target_keys()]
    forbid_set = set(forbid or [])
    locked: list[Gene] = []
    steps: list[dict] = []
    matrices: list[dict] = []
    prev = 0.0
    for f in (force or []):
        g = parse_cell(f)
        if feasible(g, locked):
            locked.append(g)
            res = engine.delta_c(pools.genes_to_plan(locked))
            steps.append({"cell": cell_key(g), "gene": pools.describe_gene(g), "dC_mean": res["mean"], "dC_std": res["std"],
                          "marginal": round(res["mean"] - prev, 4), "forced": True, "fitness": fitness_of(res["mean"], len(locked))})
            prev = res["mean"]
    while len(locked) < max_commitments:
        matrix: dict[str, dict] = {}
        best: tuple[float, Gene, dict] | None = None
        for g in cells:
            key = cell_key(g)
            if key in forbid_set or not feasible(g, locked):
                continue
            res = engine.delta_c(pools.genes_to_plan(locked + [g]))
            cell = {"dC_mean": res["mean"], "dC_std": res["std"], "marginal": round(res["mean"] - prev, 4)}
            if g[1] == "mark":
                cell["k"], det = pools.kmat[(g[0], g[2])]
                cell["overlap"] = det["overlap"]
            matrix[key] = cell
            if best is None or res["mean"] < best[0]:
                best = (res["mean"], g, res)
        matrices.append({"step": len(locked), "locked": [cell_key(l) for l in locked], "cells": matrix})
        if best is None or best[0] >= prev - 1e-9:
            break   # nothing improves the plan
        _, g, res = best
        locked.append(g)
        steps.append({"cell": cell_key(g), "gene": pools.describe_gene(g), "dC_mean": res["mean"], "dC_std": res["std"],
                      "marginal": round(res["mean"] - prev, 4), "forced": False, "fitness": fitness_of(res["mean"], len(locked))})
        prev = res["mean"]
    final = engine.delta_c(pools.genes_to_plan(locked)) if locked else {"mean": 0.0, "std": 0.0, "per_match": []}
    # knee of the commitment curve: last step whose marginal gain is at least 25% of the first step's
    knee = 0
    if steps:
        first = abs(steps[0]["marginal"]) or 1.0
        knee = max((i + 1 for i, s in enumerate(steps) if abs(s["marginal"]) >= 0.25 * first), default=1)
    return {"method": "greedy", "genes": locked, "plan": pools.genes_to_plan(locked),
            "genes_described": [pools.describe_gene(g) for g in locked],
            "dC_mean": final["mean"], "dC_std": final["std"], "per_match": final["per_match"],
            "fitness": fitness_of(final["mean"], len(locked)), "committed": len(locked),
            "steps": steps, "matrices": matrices, "knee": knee, "evaluations": engine.evaluations}
