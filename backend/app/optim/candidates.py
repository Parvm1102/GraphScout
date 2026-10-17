"""Candidate pools for both optimizers (brief 4.3): our top-6 pressers x their top-4 by S_p + top-3 lanes."""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from app.graph import db
from app.metrics import formulas as F
from app.metrics import scores as S

Gene = tuple  # (presser_id, "mark", target_id) | (presser_id, "cut", (src, dst))


@dataclass
class Pools:
    our: str
    their: str
    pressers: list[dict]
    targets: list[dict]
    lanes: list[dict]
    kmat: dict[tuple[int, int], tuple[float, dict]]
    match_ids: list[int]
    names: dict[int, str] = field(default_factory=dict)

    def presser_ids(self) -> list[int]:
        return [p["id"] for p in self.pressers]

    def target_keys(self) -> list[tuple]:
        return [("mark", t["id"]) for t in self.targets] + [("cut", (l["src"], l["dst"])) for l in self.lanes]

    def gene_to_intervention(self, gene: Gene) -> dict:
        x, action, tgt = gene
        if action == "mark":
            k, det = self.kmat[(x, tgt)]
            return {"type": "suppress", "target_player": tgt, "presser": x, "k": k, "k_source": "matchup", "k_detail": det}
        return {"type": "cut_lane", "edge": {"src": tgt[0], "dst": tgt[1]}, "presser": x, "k": F.K_LANE, "k_source": "k_lane"}

    def genes_to_plan(self, genes: list[Gene | None]) -> list[dict]:
        return [self.gene_to_intervention(g) for g in genes if g is not None]

    def describe_gene(self, gene: Gene) -> dict:
        x, action, tgt = gene
        d = {"presser": {"id": x, "name": self.names.get(x, str(x))}, "action": action}
        if action == "mark":
            d["target"] = {"id": tgt, "name": self.names.get(tgt, str(tgt))}
            d["k"] = self.kmat[(x, tgt)][0]
            d["refs"] = [f"player:{x}", f"player:{tgt}"]
        else:
            d["target"] = {"src": tgt[0], "dst": tgt[1], "src_name": self.names.get(tgt[0], str(tgt[0])),
                           "dst_name": self.names.get(tgt[1], str(tgt[1]))}
            d["k"] = F.K_LANE
            d["refs"] = [f"player:{x}", f"edge:{tgt[0]}->{tgt[1]}"]
        return d


def top_lanes(team: str, match_ids: list[int], n: int = F.N_LANES) -> list[dict]:
    agg: dict[tuple[int, int], dict] = {}
    for mid in match_ids:
        for e in db.pull_network(db.match_graph(mid), team):
            o = agg.setdefault((e["src"], e["dst"]), {"progressive": 0, "completed": 0, "count": 0})
            o["progressive"] += e["progressive"]; o["completed"] += e["completed"]; o["count"] += e["count"]
    rows = [{"src": s, "dst": d, **o} for (s, d), o in agg.items()]
    rows.sort(key=lambda r: (-r["progressive"], -r["completed"]))
    return rows[:n]


def build_pools(our: str, their: str, df: pd.DataFrame | None = None, exclude_match: int | None = None,
                n_pressers: int = F.N_PRESSERS, n_targets: int = F.N_TARGETS, n_lanes: int = F.N_LANES) -> Pools:
    df = df if df is not None else S.all_components()
    agg = S.composite(df, exclude_match=exclude_match)
    regain = S.regain_profile(df, exclude_match)
    ours = agg[agg.team == our].copy()
    ours["regain"] = ours.id.map(regain).fillna(0.0)
    ours["press_volume"] = ours.pressures * ours.regain
    pressers = ours.sort_values("press_volume", ascending=False).head(n_pressers)
    theirs = agg[(agg.team == their) & (agg.position != "Goalkeeper")].head(n_targets)
    match_ids = [m for m in S.team_match_ids(their) if m != exclude_match]
    lanes = top_lanes(their, match_ids, n_lanes)
    names = dict(zip(agg.id.astype(int), agg.name))
    klook = S.k_lookup(df, exclude_match)
    kmat = {(int(x.id), int(y.id)): klook(int(x.id), int(y.id)) for x in pressers.itertuples() for y in theirs.itertuples()}
    return Pools(
        our=our, their=their,
        pressers=[{"id": int(r.id), "name": r.name, "position": r.position, "pressures": int(r.pressures),
                   "regain": round(float(r.regain), 4), "press_volume": round(float(r.press_volume), 2)} for r in pressers.itertuples()],
        targets=[{"id": int(r.id), "name": r.name, "position": r.position, "s_p_mean": round(float(r.s_p_mean), 4),
                  "s_p_std": round(float(r.s_p_std), 4), "press_resist": round(float(r.press_resist), 4)} for r in theirs.itertuples()],
        lanes=[{**l, "src_name": names.get(l["src"], str(l["src"])), "dst_name": names.get(l["dst"], str(l["dst"]))} for l in lanes],
        kmat=kmat, match_ids=match_ids, names=names,
    )
