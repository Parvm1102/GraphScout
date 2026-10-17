"""Tier A — authoritative FalkorDB pipeline: GRAPH.COPY clone -> SET sim_* -> read -> diff -> delete."""
from __future__ import annotations

import logging
import time
import uuid

import networkx as nx

from app.graph import cypher as Q
from app.graph import db
from app.metrics import formulas as F
from app.metrics.circulation import c_score, components
from app.sim.model import EdgeList, aggregate_pairs, apply_plan

log = logging.getLogger(__name__)


def copy_with_retry(g, name: str, attempts: int = 7, base_delay: float = 0.25):
    """GRAPH.COPY forks a child process; while FalkorDB runs a background save (or another copy) the fork is
    refused with "could not fork". Retry with exponential backoff instead of failing the simulation."""
    delay = base_delay
    for i in range(attempts):
        try:
            return g.copy(name)
        except Exception as exc:
            msg = str(exc).lower()
            if "fork" not in msg and "busy" not in msg or i == attempts - 1:
                raise
            log.warning("GRAPH.COPY refused (%s); retry %d/%d in %.2fs", exc, i + 1, attempts, delay)
            time.sleep(delay)
            delay = min(delay * 2, 4.0)
    raise RuntimeError("unreachable")


def weighted_bt_shares(el: EdgeList) -> dict[int, float]:
    """Betweenness with distance = 1/completed (stronger lanes are shorter), as team shares."""
    G = nx.DiGraph()
    for (s, d), o in aggregate_pairs(el).items():
        if o["completed"] >= 1 and s != d:
            G.add_edge(s, d, dist=1.0 / o["completed"])
    if G.number_of_edges() == 0:
        return {}
    bt = nx.betweenness_centrality(G, weight="dist")
    tot = sum(bt.values()) or 1.0
    return {int(k): v / tot for k, v in bt.items()}


def simulate_match(match_id: int, team: str, plan: list[dict], windows: list[str] | None = None) -> dict:
    wins = windows or list(F.WINDOWS)
    g = db.match_graph(match_id)
    players = db.pull_players(g, team)
    base = EdgeList.from_rows(match_id, team, wins, db.pull_rows(g, team, wins), players)
    base_comp = components(base)
    el_b, det = apply_plan(base, plan)            # the numbers Tier A must materialise
    sim_name = f"sim_{uuid.uuid4().hex[:12]}"
    sim = copy_with_retry(g, sim_name)            # server-side GRAPH.COPY
    try:
        if det["mults"]:
            sim.query(Q.SIM_APPLY_MULTS, {"mults": det["mults"], "wins": wins})
        if det["reroutes"]:
            sim.query(Q.SIM_APPLY_REROUTES, {"reroutes": det["reroutes"]})
        after = EdgeList.from_rows(match_id, team, wins, db.pull_rows(sim, team, wins), players)
        net_after = db.pull_network(sim, team, wins)
    finally:
        sim.delete()
    comp_a = components(after)
    dC = c_score(comp_a, base_comp) - 100.0
    tier_b_dC = c_score(components(el_b), base_comp) - 100.0

    bt0, bt1 = weighted_bt_shares(base), weighted_bt_shares(after)
    names = base.names
    inheritance = sorted(({"player": pid, "name": names.get(pid, str(pid)), "old_BT_share": round(bt0.get(pid, 0.0), 4),
                           "new_BT_share": round(v, 4), "delta": round(v - bt0.get(pid, 0.0), 4)}
                          for pid, v in bt1.items()), key=lambda r: -r["delta"])[:5]
    pairs0 = aggregate_pairs(base)
    rerouted = []
    for e in net_after:
        o = pairs0.get((e["src"], e["dst"]))
        if o and (e["completed"] != o["completed"] or e["est"]):
            rerouted.append({"src": e["src"], "dst": e["dst"], "old": o["completed"], "new": e["completed"], "est": e["est"]})
    return {
        "match_id": match_id, "team": team, "windows": wins, "basis": "modeled",
        "dC_pct": round(dC, 4), "tier_b_dC_pct": round(tier_b_dC, 4),
        "M_before": base_comp.M, "M_after": comp_a.M, "D_before": base_comp.D, "D_after": comp_a.D,
        "V_before": base_comp.V, "V_after": comp_a.V,
        "inheritance": inheritance, "rerouted_edges": rerouted, "sim_graph": sim_name,
        "removed": det["removed"], "redistributed": det["redistributed"],
        "network_after": net_after,
    }
