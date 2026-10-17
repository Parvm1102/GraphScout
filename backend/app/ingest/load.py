"""Write MatchFrames into FalkorDB: one match_<id> graph per fixture plus the catalog mirror."""
from __future__ import annotations

import logging

from app.graph import cypher as Q
from app.graph import db
from app.ingest.statsbomb import MatchFrames, match_meta, parse_match, pick_tournament, team_matches

log = logging.getLogger(__name__)


def write_match_graph(mf: MatchFrames, replace: bool = True) -> str:
    name = f"match_{mf.match_id}"
    if replace:
        db.delete_graph(name)
    g = db.graph(name)
    players = mf.players.to_dict("records")
    for p in players:
        p["press_zones"] = [int(v) for v in p["press_zones"]]
        p["recv_zones"] = [int(v) for v in p["recv_zones"]]
    g.query(Q.CREATE_PLAYERS, {"players": players})
    edges = [{"src": int(r.src), "dst": int(r.dst), "c": int(r.count), "cc": int(r.completed),
              "p": int(r.progressive), "w": r.window} for r in mf.edges.itertuples()]
    g.query(Q.CREATE_EDGES, {"edges": edges})
    db.ensure_index(g, Q.INDEX_PLAYER_ID)
    return name


def write_catalog(mf: MatchFrames) -> None:
    cat = db.catalog()
    for idx in Q.CAT_INDEXES:
        db.ensure_index(cat, idx)
    m = mf.meta
    cat.query(Q.CAT_MERGE_MATCH, {"id": mf.match_id, "comp": m.get("comp"), "season": m.get("season"),
                                  "date": m.get("date"), "home": m.get("home"), "away": m.get("away"),
                                  "score": m.get("score"), "stage": m.get("stage"),
                                  "end_minute": int(mf.end_minute)})
    for team, st in mf.team_stats.items():
        cat.query(Q.CAT_MERGE_TEAM_PLAYED, {"mid": mf.match_id, "name": team, "tid": st["team_id"],
                                            "xg": st["xg"], "goals": st["goals"], "home": team == m.get("home")})
    rows = [{"id": int(p.id), "name": p.name, "team": p.team, "minutes": float(p.minutes),
             "from_min": float(p.from_min), "to_min": float(p.to_min), "position": p.position}
            for p in mf.players.itertuples()]
    cat.query(Q.CAT_MERGE_APPEARANCES, {"mid": mf.match_id, "rows": rows})


def ingest_match(match_id: int, meta: dict, replace: bool = True) -> MatchFrames:
    mf = parse_match(match_id, meta)
    write_match_graph(mf, replace=replace)
    write_catalog(mf)
    log.info("ingested match %s (%s v %s): %d players, %d edges",
             match_id, meta.get("home"), meta.get("away"), len(mf.players), len(mf.edges))
    return mf


def demo_match_list(whole_tournament: bool = False) -> tuple[dict, list[dict]]:
    """(tournament info, ordered unique match metas) for the two demo teams or the whole tournament."""
    t = pick_tournament()
    if whole_tournament:
        metas = sorted((match_meta(m) for m in t["matches"]), key=lambda x: x["date"])
    else:
        seen, metas = set(), []
        for team in (t["our"], t["their"]):
            for m in team_matches(t["matches"], team):
                if m["id"] not in seen:
                    seen.add(m["id"]); metas.append(m)
        metas.sort(key=lambda x: x["date"])
    return t, metas


def ingest_all(whole_tournament: bool = False, replace: bool = True) -> list[MatchFrames]:
    t, metas = demo_match_list(whole_tournament)
    return [ingest_match(m["id"], m, replace=replace) for m in metas]
