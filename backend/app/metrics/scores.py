"""Player composite score S_p and tournament-level player profiles (Phase 3).

Normalisation rule (brief): every centrality becomes a within-match share (player / team total),
then a z-score among teammates, before any cross-match averaging; we report mean +- std.
S_p = 0.30*z(PR_share) + 0.30*z(BT_share) + 0.25*z(ProgInv_share) + 0.15*z(press_resist)
PR/BT come from FalkorDB's native algo.pageRank / algo.betweenness (networkx fallback),
cached on the :Player nodes. press_resist is tournament-level (pressured-pass counts summed
across matches, >=15 pressured passes else team median, min-max within squad) because one
match rarely yields 15 pressured passes per player; `exclude_match` recomputes it per fold.
"""
from __future__ import annotations

import logging

import networkx as nx
import numpy as np
import pandas as pd

from app.graph import cypher as Q
from app.graph import db
from app.metrics import formulas as F

log = logging.getLogger(__name__)

COMPONENT_COLS = ["pr_share", "bt_share", "prog_share", "press_resist_t"]
_CACHE: dict[tuple[int, ...], pd.DataFrame] = {}


# ----------------------------------------------------------------------------- catalog helpers

def ingested_match_ids() -> list[int]:
    return sorted(int(n.split("_", 1)[1]) for n in db.list_graphs() if n.startswith("match_"))


def catalog_matches() -> list[dict]:
    out = []
    for m, teams in db.q(db.catalog(), Q.CAT_MATCHES, read_only=True):
        d = db.props(m)
        d["teams"] = [t for t in teams if t.get("team")]
        out.append(d)
    return out


def team_match_ids(team: str) -> list[int]:
    return [int(db.props(r[0])["id"]) for r in db.q(db.catalog(), Q.CAT_TEAM_MATCHES, {"team": team}, read_only=True)]


def teams_in_catalog() -> list[str]:
    return sorted({t["team"] for m in catalog_matches() for t in m["teams"]})


# ----------------------------------------------------------------------------- per-match components

def _nx_graph(rows: list[tuple]) -> nx.DiGraph:
    G = nx.DiGraph()
    for s, d, *_ in rows:
        if s != d:
            G.add_edge(s, d)
    return G


def _shares(values: dict[int, float], ids: list[int]) -> dict[int, float]:
    tot = sum(max(values.get(i, 0.0), 0.0) for i in ids)
    return {i: (max(values.get(i, 0.0), 0.0) / tot if tot > 0 else 0.0) for i in ids}


def match_components(match_id: int, force: bool = False) -> pd.DataFrame:
    """One row per player of the match with PR/BT/ProgInv shares (computed once, cached on nodes)."""
    g = db.match_graph(match_id)
    players = db.pull_players(g)
    if force or not all("pr_share" in p for p in players):
        pr = db.native_pagerank(g)
        bt = db.native_betweenness(g, len(players))
        rows_all = [tuple(r) for r in db.q(g, "MATCH (a:Player)-[e:PASS]->(b:Player) RETURN a.id, b.id", read_only=True)]
        if pr is None:
            pr = nx.pagerank(_nx_graph(rows_all)) if rows_all else {}
        if bt is None:
            bt = nx.betweenness_centrality(_nx_graph(rows_all)) if rows_all else {}
        updates = []
        for team in sorted({p["team"] for p in players}):
            ids = [p["id"] for p in players if p["team"] == team]
            prs, bts = _shares(pr, ids), _shares(bt, ids)
            prog = {p["id"]: p.get("prog_made", 0) + p.get("prog_recv", 0) for p in players if p["team"] == team}
            pgs = _shares(prog, ids)
            for p in players:
                if p["team"] == team:
                    p.update(pr_raw=float(pr.get(p["id"], 0.0)), bt_raw=float(bt.get(p["id"], 0.0)),
                             pr_share=prs[p["id"]], bt_share=bts[p["id"]], prog_share=pgs[p["id"]])
                    updates.append({"id": p["id"], "props": {k: p[k] for k in ("pr_raw", "bt_raw", "pr_share", "bt_share", "prog_share")}})
        db.set_player_props(g, updates)
    df = pd.DataFrame(players)
    df["match_id"] = match_id
    return df


def all_components(match_ids: list[int] | None = None, force: bool = False) -> pd.DataFrame:
    mids = tuple(sorted(match_ids or ingested_match_ids()))
    if not force and mids in _CACHE:
        return _CACHE[mids]
    df = pd.concat([match_components(m, force=force) for m in mids], ignore_index=True)
    _CACHE[mids] = df
    return df


def invalidate_cache() -> None:
    _CACHE.clear()


# ----------------------------------------------------------------------------- tournament profiles

def press_resist_profile(df: pd.DataFrame, exclude_match: int | None = None) -> pd.Series:
    sub = df[df.match_id != exclude_match] if exclude_match is not None else df
    agg = sub.groupby(["team", "id"])[["pass_att", "pass_cmp", "pressured_att", "pressured_cmp"]].sum()
    out = {}
    for team, grp in agg.groupby(level="team"):
        ids = [i for _, i in grp.index]
        raw = [F.press_resist_raw(int(r.pass_att), int(r.pass_cmp), int(r.pressured_att), int(r.pressured_cmp))
               for r in grp.itertuples()]
        scaled = F.minmax(F.fill_with_median(raw))
        out.update(dict(zip(ids, scaled)))
    return pd.Series(out, name="press_resist_t")


def regain_profile(df: pd.DataFrame, exclude_match: int | None = None) -> pd.Series:
    sub = df[df.match_id != exclude_match] if exclude_match is not None else df
    agg = sub.groupby(["team", "id"])[["pressures", "regains"]].sum()
    out = {}
    for team, grp in agg.groupby(level="team"):
        ids = [i for _, i in grp.index]
        raw = [(r.regains / r.pressures) if r.pressures >= F.MIN_PRESSURES_FOR_REGAIN else None for r in grp.itertuples()]
        out.update(dict(zip(ids, F.fill_with_median(raw))))
    return pd.Series(out, name="regain")


def zone_profiles(df: pd.DataFrame, exclude_match: int | None = None) -> tuple[dict[int, list[int]], dict[int, list[int]]]:
    sub = df[df.match_id != exclude_match] if exclude_match is not None else df
    press: dict[int, np.ndarray] = {}
    recv: dict[int, np.ndarray] = {}
    for r in sub.itertuples():
        press[r.id] = press.get(r.id, np.zeros(F.N_ZONES, dtype=int)) + np.asarray(r.press_zones, dtype=int)
        recv[r.id] = recv.get(r.id, np.zeros(F.N_ZONES, dtype=int)) + np.asarray(r.recv_zones, dtype=int)
    return {k: v.tolist() for k, v in press.items()}, {k: v.tolist() for k, v in recv.items()}


# ----------------------------------------------------------------------------- composite S_p

def _z(x: pd.Series) -> pd.Series:
    sd = x.std(ddof=0)
    return (x - x.mean()) / sd if sd > 1e-12 else x * 0.0


def composite(df: pd.DataFrame, weights: dict | None = None, exclude_match: int | None = None,
              min_minutes: float = 0.0) -> pd.DataFrame:
    """Per-player S_p mean/std across matches (optionally excluding one match: leave-one-out)."""
    w = dict(F.W_S)
    if weights:
        w.update({k: float(v) for k, v in weights.items() if k in w})
    sub = df[(df.match_id != exclude_match) & (df.minutes >= min_minutes)].copy() if exclude_match is not None \
        else df[df.minutes >= min_minutes].copy()
    sub["press_resist_t"] = sub.id.map(press_resist_profile(df, exclude_match)).fillna(0.5)
    for c in COMPONENT_COLS:
        sub[f"z_{c}"] = sub.groupby(["match_id", "team"])[c].transform(_z)
    sub["s_p"] = (w["pr"] * sub.z_pr_share + w["bt"] * sub.z_bt_share
                  + w["prog"] * sub.z_prog_share + w["press_resist"] * sub.z_press_resist_t)
    agg = sub.groupby(["team", "id"]).agg(
        name=("name", "first"), jersey=("jersey", "first"),
        position=("position", lambda s: s.mode().iloc[0]),
        s_p_mean=("s_p", "mean"), s_p_std=("s_p", lambda s: float(s.std(ddof=0))),
        n_matches=("match_id", "nunique"), minutes=("minutes", "sum"),
        touches=("touches", "sum"), pressures=("pressures", "sum"), regains=("regains", "sum"),
        pr_share=("pr_share", "mean"), bt_share=("bt_share", "mean"), prog_share=("prog_share", "mean"),
        press_resist=("press_resist_t", "first"),
        z_pr=("z_pr_share", "mean"), z_bt=("z_bt_share", "mean"), z_prog=("z_prog_share", "mean"),
        z_press_resist=("z_press_resist_t", "mean"),
        avg_x=("avg_x", "mean"), avg_y=("avg_y", "mean"),
    ).reset_index()
    return agg.sort_values(["team", "s_p_mean"], ascending=[True, False]).reset_index(drop=True)


def player_scores(team: str, weights: dict | None = None, exclude_match: int | None = None,
                  match_ids: list[int] | None = None) -> list[dict]:
    df = all_components(match_ids)
    agg = composite(df, weights, exclude_match)
    out = agg[agg.team == team].copy()
    out["rank"] = range(1, len(out) + 1)
    recs = out.round(4).to_dict("records")
    for r in recs:
        r["id"] = int(r["id"]); r["jersey"] = int(r["jersey"])
    return recs


# ----------------------------------------------------------------------------- attenuation k

def k_lookup(df: pd.DataFrame, exclude_match: int | None = None, mode: str | None = None):
    """Returns k(presser_id, target_id) -> (k, details) using tournament-level profiles.

    mode "raw": k = clamp(1 - regain*overlap*(1-press_resist)) exactly as the brief states.
    mode "relative" (default, see formulas.K_MODE): regain is min-maxed within the presser's squad
    and overlap is divided by the largest overlap among that squad's pressers vs the opposing squad.
    Both the raw and the relative inputs are returned so the UI can show them.
    """
    mode = mode or F.K_MODE
    regain = regain_profile(df, exclude_match)
    press_r = press_resist_profile(df, exclude_match)
    press_z, recv_z = zone_profiles(df, exclude_match)
    team_of = df.drop_duplicates("id").set_index("id")["team"].to_dict()
    squad = {t: [i for i, tt in team_of.items() if tt == t] for t in set(team_of.values())}
    regain_rel: dict[int, float] = {}
    for t, ids in squad.items():
        vals = [float(regain.get(i, 0.0)) for i in ids]
        regain_rel.update(dict(zip(ids, F.minmax(vals))))
    max_overlap: dict[tuple[str, str], float] = {}

    def overlap(x: int, y: int) -> float:
        return F.overlap_press_recv(press_z.get(x, [0] * F.N_ZONES), recv_z.get(y, [0] * F.N_ZONES))

    def pool_max(tx: str, ty: str) -> float:
        key = (tx, ty)
        if key not in max_overlap:
            max_overlap[key] = max((overlap(a, b) for a in squad.get(tx, []) for b in squad.get(ty, [])), default=0.0)
        return max_overlap[key]

    def k(x: int, y: int) -> tuple[float, dict]:
        rg = float(regain.get(x, 0.0))
        ov = overlap(x, y)
        pr = float(press_r.get(y, 0.5))
        k_raw = F.k_atten(rg, ov, pr)
        tx, ty = team_of.get(x), team_of.get(y)
        mo = pool_max(tx, ty) if tx and ty else 0.0
        ov_rel = (ov / mo) if mo > 0 else 0.0
        rg_rel = float(regain_rel.get(x, 0.0))
        k_rel = F.k_atten(rg_rel, ov_rel, pr)
        det = {"regain": round(rg, 4), "regain_rel": round(rg_rel, 4), "overlap": round(ov, 4),
               "overlap_rel": round(ov_rel, 4), "press_resist": round(pr, 4), "k_raw": k_raw, "k_relative": k_rel,
               "mode": mode}
        return (k_rel if mode == "relative" else k_raw), det
    return k


# ----------------------------------------------------------------------------- catalog writeback

def build_profiles(write: bool = True) -> pd.DataFrame:
    df = all_components(force=True)
    agg = composite(df)
    regain = regain_profile(df)
    press_z, recv_z = zone_profiles(df)
    rows = []
    for r in agg.itertuples():
        rows.append({"id": int(r.id), "props": {
            "team": r.team, "position": r.position, "jersey": int(r.jersey),
            "s_p_mean": float(r.s_p_mean), "s_p_std": float(r.s_p_std), "n_matches": int(r.n_matches),
            "minutes": float(r.minutes), "touches": int(r.touches), "pressures": int(r.pressures),
            "regains": int(r.regains), "regain": float(regain.get(r.id, 0.0)),
            "press_resist": float(r.press_resist),
            "press_zones": press_z.get(r.id, [0] * F.N_ZONES), "recv_zones": recv_z.get(r.id, [0] * F.N_ZONES),
        }})
    if write:
        db.catalog().query(Q.CAT_SET_PLAYERREF_PROPS, {"rows": rows})
        log.info("wrote %d PlayerRef profiles to catalog", len(rows))
    return agg
