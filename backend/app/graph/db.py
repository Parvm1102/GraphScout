"""FalkorDB access: connections, reads every feature uses, native algorithm calls with fallbacks."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from falkordb import FalkorDB, Graph

from app import config
from app.graph import cypher as Q
from app.metrics.formulas import WINDOWS

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_db() -> FalkorDB:
    return FalkorDB(host=config.FALKOR_HOST, port=config.FALKOR_PORT)


def graph(name: str) -> Graph:
    return get_db().select_graph(name)


def catalog() -> Graph:
    return graph(config.CATALOG)


def match_graph(match_id: int) -> Graph:
    return graph(f"match_{match_id}")


def list_graphs() -> list[str]:
    return list(get_db().list_graphs())


def graph_exists(name: str) -> bool:
    return name in set(list_graphs())


def delete_graph(name: str) -> None:
    if graph_exists(name):
        graph(name).delete()


def sweep_sims() -> int:
    """Delete leftover throwaway clones (sim_*)."""
    n = 0
    for name in list_graphs():
        if name.startswith("sim_"):
            graph(name).delete()
            n += 1
    return n


def q(g: Graph, cypher: str, params: dict | None = None, read_only: bool = False) -> list[list[Any]]:
    res = g.ro_query(cypher, params) if read_only else g.query(cypher, params)
    return res.result_set


def ensure_index(g: Graph, cypher: str) -> None:
    try:
        g.query(cypher)
    except Exception as exc:  # already indexed
        if "already" not in str(exc).lower():
            raise


def props(node) -> dict:
    return dict(node.properties)


# ------------------------------------------------------------------ reads (Phase 2.3)

def pull_rows(g: Graph, team: str, windows: list[str] | None = None) -> list[tuple]:
    """Per-(src,dst,window) rows with sim_* overrides applied: (src, dst, win, cnt, cc, prog)."""
    wins = windows or list(WINDOWS)
    return [tuple(r) for r in q(g, Q.NETWORK_ROWS, {"t": team, "wins": wins}, read_only=True)]


def pull_network(g: Graph, team: str, windows: list[str] | None = None) -> list[dict]:
    wins = windows or list(WINDOWS)
    return [{"src": r[0], "dst": r[1], "count": r[2], "completed": r[3], "progressive": r[4],
             "est": bool(r[5])}
            for r in q(g, Q.NETWORK_AGG, {"t": team, "wins": wins}, read_only=True)]


def pull_players(g: Graph, team: str | None = None) -> list[dict]:
    rows = q(g, Q.PLAYERS_OF_TEAM, {"t": team}, read_only=True) if team else q(g, Q.PLAYERS_ALL, read_only=True)
    return [props(r[0]) for r in rows]


def set_player_props(g: Graph, rows: list[dict]) -> None:
    """rows = [{id, props:{...}}]"""
    if rows:
        g.query(Q.SET_PLAYER_PROPS, {"rows": rows})


# ------------------------------------------------------------------ native algorithms (Phase 2.5)

def native_pagerank(g: Graph) -> dict[int, float] | None:
    try:
        return {r[0]: float(r[2]) for r in q(g, Q.PAGERANK)}
    except Exception as exc:
        log.warning("native pageRank unavailable (%s); falling back to networkx", exc)
        return None


def native_betweenness(g: Graph, n_nodes: int) -> dict[int, float] | None:
    try:
        return {r[0]: float(r[2]) for r in q(g, Q.BETWEENNESS, {"n": max(64, n_nodes)})}
    except Exception as exc:
        log.warning("native betweenness unavailable (%s); falling back to networkx", exc)
        return None


def native_communities(g: Graph) -> dict[int, int] | None:
    try:
        return {r[0]: int(r[2]) for r in q(g, Q.LABEL_PROPAGATION)}
    except Exception as exc:
        log.warning("native labelPropagation unavailable (%s)", exc)
        return None
