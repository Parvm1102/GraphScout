"""Tier B — fast in-memory fitness (Phase 4.2). Each opponent match's edge list is pulled from
FalkorDB ONCE; evaluating a plan = reweight arrays + rerun max-flow, milliseconds per plan."""
from __future__ import annotations

import statistics

from app.graph import db
from app.metrics import formulas as F
from app.metrics.circulation import Components, c_score, components
from app.sim.model import EdgeList, apply_plan


def plan_key(plan: list[dict]) -> tuple:
    items = []
    for iv in plan:
        if iv["type"] in ("suppress", "delete"):
            items.append((iv["type"], int(iv["target_player"]), round(float(iv.get("k", 1.0)), F.K_DECIMALS)))
        else:
            items.append((iv["type"], int(iv["edge"]["src"]), int(iv["edge"]["dst"]), round(float(iv.get("k", F.K_LANE)), F.K_DECIMALS)))
    return tuple(sorted(items))


def load_edge_list(match_id: int, team: str, windows: list[str] | None = None, g=None) -> EdgeList:
    g = g or db.match_graph(match_id)
    wins = windows or list(F.WINDOWS)
    rows = db.pull_rows(g, team, wins)
    players = db.pull_players(g, team)
    return EdgeList.from_rows(match_id, team, wins, rows, players)


class FastEngine:
    def __init__(self, team: str, match_ids: list[int], windows: list[str] | None = None):
        self.team = team
        self.match_ids = list(match_ids)
        self.windows = windows or list(F.WINDOWS)
        self.base: dict[int, EdgeList] = {}
        self.base_comp: dict[int, Components] = {}
        self._memo: dict[tuple, dict] = {}
        self.evaluations = 0
        for mid in self.match_ids:
            el = load_edge_list(mid, team, self.windows)
            self.base[mid] = el
            self.base_comp[mid] = components(el)

    def evaluate_match(self, mid: int, plan: list[dict]) -> dict:
        el2, det = apply_plan(self.base[mid], plan)
        comp = components(el2)
        return {"match_id": mid, "dC_pct": round(c_score(comp, self.base_comp[mid]) - 100.0, 4),
                "before": self.base_comp[mid].as_dict(), "after": comp.as_dict(),
                "removed": det["removed"], "redistributed": det["redistributed"]}

    def delta_c(self, plan: list[dict]) -> dict:
        key = plan_key(plan)
        if key in self._memo:
            return self._memo[key]
        self.evaluations += 1
        per = [self.evaluate_match(mid, plan) for mid in self.match_ids]
        vals = [p["dC_pct"] for p in per]
        res = {"mean": round(statistics.fmean(vals), 4) if vals else 0.0,
               "std": round(statistics.pstdev(vals), 4) if len(vals) > 1 else 0.0,
               "per_match": per}
        self._memo[key] = res
        return res
