"""The single reweighting rule both simulation tiers share (Phase 4.1 / 4.2).

An EdgeList is the per-(src, dst, window) pass table of ONE team in ONE match, pulled once from
FalkorDB (query NETWORK_ROWS).  `apply_plan` turns a list of resolved interventions into
  * one multiplier per (src, dst) pair, applied ONCE per row with integer truncation
    (Python int() == Cypher toInteger(), both truncate toward zero), and
  * proportional reroutes of the removed completed passes into the passer's other out-edges in
    the same zone column and window, floored (so redistributed <= removed), flagged est=True.
Tier B evaluates the result in memory; Tier A writes exactly the same multipliers and reroute
amounts into a GRAPH.COPY clone (SIM_APPLY_MULTS / SIM_APPLY_REROUTES) and reads them back, so
the two tiers agree by construction (tests/test_consistency.py checks the round trip).

No-fiction contract: we only subtract and reweight observed passes; reroutes move observed
volume onto observed edges and are labelled as estimates.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np

from app.metrics import formulas as F


@dataclass
class EdgeList:
    match_id: int
    team: str
    windows: tuple[str, ...]
    src: np.ndarray
    dst: np.ndarray
    win: np.ndarray            # dtype object (window ids)
    cnt: np.ndarray
    cc: np.ndarray
    prog: np.ndarray
    est: np.ndarray
    positions: dict[int, str]      # player id -> primary lineup position
    avg_x: dict[int, float]        # player id -> average x (for zone columns)
    names: dict[int, str] = field(default_factory=dict)

    @classmethod
    def from_rows(cls, match_id: int, team: str, windows: list[str], rows: list[tuple],
                  players: list[dict]) -> "EdgeList":
        rows = sorted(rows, key=lambda r: (r[0], r[2], r[1]))  # (src, window, dst): fixed order
        n = len(rows)
        return cls(
            match_id=match_id, team=team, windows=tuple(windows),
            src=np.array([r[0] for r in rows], dtype=np.int64),
            dst=np.array([r[1] for r in rows], dtype=np.int64),
            win=np.array([r[2] for r in rows], dtype=object),
            cnt=np.array([int(r[3]) for r in rows], dtype=np.int64),
            cc=np.array([int(r[4]) for r in rows], dtype=np.int64),
            prog=np.array([int(r[5]) for r in rows], dtype=np.int64),
            est=np.zeros(n, dtype=bool),
            positions={p["id"]: p.get("position", "") for p in players if p.get("team") == team},
            avg_x={p["id"]: float(p.get("avg_x", 60.0)) for p in players if p.get("team") == team},
            names={p["id"]: p.get("name", str(p["id"])) for p in players if p.get("team") == team},
        )

    def player_ids(self) -> list[int]:
        return sorted(set(self.src.tolist()) | set(self.dst.tolist()) | set(self.positions))

    def totals(self) -> dict[str, int]:
        return {"count": int(self.cnt.sum()), "completed": int(self.cc.sum()), "progressive": int(self.prog.sum())}


def resolve_pair_multipliers(el: EdgeList, plan: list[dict]) -> dict[tuple[int, int], float]:
    """One multiplier per (src, dst) pair. Interventions on the same pair multiply together.

    plan items (already resolved): {type: suppress|cut_lane|delete, target_player?, edge?:{src,dst}, k}
    """
    pairs = {(int(s), int(d)) for s, d in zip(el.src.tolist(), el.dst.tolist())}
    mult: dict[tuple[int, int], float] = {}
    for iv in plan:
        t = iv["type"]
        if t == "suppress":
            y, k = int(iv["target_player"]), float(iv["k"])
            for (s, d) in pairs:
                if d == y:
                    mult[(s, d)] = round(mult.get((s, d), 1.0) * k, F.K_DECIMALS)
        elif t == "delete":
            y = int(iv["target_player"])
            for (s, d) in pairs:
                if d == y or s == y:
                    mult[(s, d)] = 0.0
        elif t == "cut_lane":
            s, d = int(iv["edge"]["src"]), int(iv["edge"]["dst"])
            k = float(iv.get("k", F.K_LANE))
            if (s, d) in pairs:
                mult[(s, d)] = round(mult.get((s, d), 1.0) * k, F.K_DECIMALS)
        else:
            raise ValueError(f"unknown intervention type {t!r}")
    return {p: k for p, k in mult.items() if k < 1.0}


def apply_plan(el: EdgeList, plan: list[dict]) -> tuple[EdgeList, dict[str, Any]]:
    """Return (reweighted EdgeList, details) where details carries exactly what Tier A must write:
       details['mults']    = [{src, dst, k}]
       details['reroutes'] = [{src, dst, w, add}]   (completed passes moved onto observed edges)
    """
    mult = resolve_pair_multipliers(el, plan)
    n = len(el.src)
    cnt, cc, prog = el.cnt.copy(), el.cc.copy(), el.prog.copy()
    est = el.est.copy()
    if not mult:
        return replace(el, cnt=cnt, cc=cc, prog=prog, est=est), {"mults": [], "reroutes": [], "removed": 0, "redistributed": 0}

    k_row = np.ones(n, dtype=float)
    for i in range(n):
        k = mult.get((int(el.src[i]), int(el.dst[i])))
        if k is not None:
            k_row[i] = k
    affected = np.flatnonzero(k_row < 1.0)
    # 1) multiplier, truncated toward zero exactly like Cypher toInteger(e.count * k)
    for i in affected:
        k = k_row[i]
        cnt[i] = int(el.cnt[i] * k)
        cc[i] = int(el.cc[i] * k)
        prog[i] = int(el.prog[i] * k)
    removed = int((el.cc[affected] - cc[affected]).sum())

    # 2) proportional reroute of removed completed passes, per (src, window), same zone column
    col = {pid: F.zone_col(x) for pid, x in el.avg_x.items()}
    by_src_win: dict[tuple[int, str], list[int]] = {}
    for i in range(n):
        by_src_win.setdefault((int(el.src[i]), el.win[i]), []).append(i)
    rr: dict[tuple[int, int, str], int] = {}
    redistributed = 0
    for i in affected:
        delta = int(el.cc[i] - cc[i])
        if delta <= 0:
            continue
        s, y, w = int(el.src[i]), int(el.dst[i]), el.win[i]
        ycol = col.get(y)
        cands = [j for j in by_src_win[(s, w)]
                 if j != i and k_row[j] >= 1.0 and col.get(int(el.dst[j])) == ycol and el.cc[j] > 0]
        if not cands:
            continue
        tot = float(el.cnt[cands].sum())
        for j in cands:
            add = int(delta * (el.cnt[j] / tot))   # floor => sum(add) <= delta
            if add <= 0:
                continue
            cnt[j] += add
            cc[j] += add
            est[j] = True
            redistributed += add
            key = (s, int(el.dst[j]), w)
            rr[key] = rr.get(key, 0) + add
    reroutes = [{"src": a, "dst": b, "w": w, "add": v} for (a, b, w), v in sorted(rr.items())]
    details = {
        "mults": [{"src": s, "dst": d, "k": k} for (s, d), k in sorted(mult.items())],
        "reroutes": reroutes,
        "removed": removed,
        "redistributed": redistributed,
    }
    return replace(el, cnt=cnt, cc=cc, prog=prog, est=est), details


def aggregate_pairs(el: EdgeList) -> dict[tuple[int, int], dict[str, int | bool]]:
    out: dict[tuple[int, int], dict] = {}
    for i in range(len(el.src)):
        key = (int(el.src[i]), int(el.dst[i]))
        o = out.setdefault(key, {"count": 0, "completed": 0, "progressive": 0, "est": False})
        o["count"] += int(el.cnt[i]); o["completed"] += int(el.cc[i]); o["progressive"] += int(el.prog[i])
        o["est"] = o["est"] or bool(el.est[i])
    return out
