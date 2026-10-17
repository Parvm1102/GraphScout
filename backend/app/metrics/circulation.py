"""Team circulation score C (Phase 3): max-flow M, edge-disjoint paths D, progressive volume V.

Super-source S -> {GK, CBs}; {forwards, wingers} -> super-sink T, from lineup positions.
Max-flow is computed with networkx in BOTH tiers (one shared function => no Tier A/B drift);
FalkorDB's native algo.maxFlow is used only as a cross-check in scripts/maxflow_check.py.
"""
from __future__ import annotations

from dataclasses import dataclass

import networkx as nx

from app.metrics import formulas as F
from app.sim.model import EdgeList, aggregate_pairs

INF = 10 ** 9


def is_source_position(pos: str) -> bool:
    return pos == "Goalkeeper" or "Center Back" in pos


def is_sink_position(pos: str) -> bool:
    if "Wing Back" in pos:
        return False
    return "Forward" in pos or "Striker" in pos or "Wing" in pos


def source_sink_sets(positions: dict[int, str]) -> tuple[list[int], list[int]]:
    S = [p for p, pos in positions.items() if is_source_position(pos)]
    T = [p for p, pos in positions.items() if is_sink_position(pos)]
    if len(S) < 2:
        S = sorted(set(S) | {p for p, pos in positions.items() if "Back" in pos})
    if len(T) < 2:
        T = sorted(set(T) | {p for p, pos in positions.items() if "Attacking Midfield" in pos})
    return sorted(S), sorted(T)


@dataclass(frozen=True)
class Components:
    M: int   # max-flow S->T, capacities = completed passes
    V: int   # completed progressive passes
    D: int   # edge-disjoint S->T paths (unit capacities)

    def as_dict(self) -> dict:
        return {"M": self.M, "V": self.V, "D": self.D}


def _flow_graph(pairs: dict, S: list[int], T: list[int], unit: bool) -> nx.DiGraph:
    G = nx.DiGraph()
    for (s, d), o in pairs.items():
        c = o["completed"]
        if c >= 1 and s != d:
            G.add_edge(s, d, capacity=1 if unit else c)
    for s in S:
        G.add_edge("S", s, capacity=INF)
    for t in T:
        G.add_edge(t, "T", capacity=INF)
    return G


def components(el: EdgeList) -> Components:
    pairs = aggregate_pairs(el)
    S, T = source_sink_sets(el.positions)
    if not S or not T:
        return Components(0, int(el.prog.sum()), 0)
    Gm = _flow_graph(pairs, S, T, unit=False)
    Gd = _flow_graph(pairs, S, T, unit=True)
    M = int(nx.maximum_flow_value(Gm, "S", "T")) if ("S" in Gm and "T" in Gm) else 0
    D = int(nx.maximum_flow_value(Gd, "S", "T")) if ("S" in Gd and "T" in Gd) else 0
    return Components(M=M, V=int(el.prog.sum()), D=D)


def c_score(after: Components, base: Components) -> float:
    return F.circulation(after.M, after.V, after.D, base.M, base.V, base.D)


def c_raw(c: Components) -> float:
    """Un-normalised circulation (for cross-match comparison, e.g. the xG construct check)."""
    return F.W_C["M"] * c.M + F.W_C["V"] * c.V + F.W_C["D"] * c.D
