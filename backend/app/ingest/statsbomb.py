"""StatsBomb open-data loading and per-match extraction (Phase 1).

Field names were verified against data/events/3943043.json and data/lineups/3943043.json:
  event: type.name, player.id, team.id/name, possession_team.id, period, timestamp ("HH:MM:SS.mmm"),
         minute, second, location [x,y], under_pressure (bool, absent=false),
         pass.recipient.id, pass.end_location, pass.outcome (absent => completed), shot.statsbomb_xg
  lineup: team_id, team_name, lineup[].player_id/player_name/player_nickname/jersey_number,
          positions[].position, from "MM:SS" (cumulative clock), to (null => final whistle)
Every acting team's coordinates are in its own attacking frame, left -> right on a 120x80 pitch.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from app import config
from app.metrics import formulas as F

# ----------------------------------------------------------------------------------- loading


def load_json(rel: str) -> Any:
    """Read data/<rel>: local clone first, then the HTTP cache, then raw.githubusercontent.com."""
    for base in (config.OPEN_DATA_DIR, config.DATA_CACHE):
        p = Path(base) / rel
        if p.is_file():
            try:
                with open(p, encoding="utf-8") as fh:
                    return json.load(fh)
            except (json.JSONDecodeError, OSError):
                continue  # a partially checked-out file; fall through to HTTP
    url = f"{config.RAW_BASE}/{rel}"
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    dest = Path(config.DATA_CACHE) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    return r.json()


def competitions() -> list[dict]:
    return load_json("competitions.json")


def matches(comp_id: int, season_id: int) -> list[dict]:
    return load_json(f"matches/{comp_id}/{season_id}.json")


def lineups(match_id: int) -> list[dict]:
    return load_json(f"lineups/{match_id}.json")


def events(match_id: int) -> list[dict]:
    return load_json(f"events/{match_id}.json")


def pick_tournament() -> dict:
    """Euro 2024 (Spain v England) if present, else World Cup 2022 (Argentina v France)."""
    comps = {(c["competition_id"], c["season_id"]) for c in competitions()}
    for comp_id, season_id, our, their in (config.PRIMARY, config.FALLBACK):
        if (comp_id, season_id) in comps:
            ms = matches(comp_id, season_id)
            return {"comp_id": comp_id, "season_id": season_id, "our": our, "their": their,
                    "matches": ms}
    raise RuntimeError("neither demo tournament is present in competitions.json")


def match_meta(m: dict) -> dict:
    return {
        "id": m["match_id"],
        "comp": m["competition"]["competition_name"],
        "season": m["season"]["season_name"],
        "date": m["match_date"],
        "home": m["home_team"]["home_team_name"],
        "away": m["away_team"]["away_team_name"],
        "home_id": m["home_team"]["home_team_id"],
        "away_id": m["away_team"]["away_team_id"],
        "home_score": m["home_score"],
        "away_score": m["away_score"],
        "score": f'{m["home_score"]}-{m["away_score"]}',
        "stage": m["competition_stage"]["name"],
    }


def team_matches(ms: list[dict], team: str) -> list[dict]:
    return sorted((match_meta(m) for m in ms
                   if team in (m["home_team"]["home_team_name"], m["away_team"]["away_team_name"])),
                  key=lambda x: x["date"])


# ----------------------------------------------------------------------------------- parsing


@dataclass
class MatchFrames:
    match_id: int
    meta: dict
    players: pd.DataFrame     # one row per player who played (both teams)
    edges: pd.DataFrame       # one row per (src, dst, window)
    team_stats: dict = field(default_factory=dict)   # team name -> {team_id, xg, goals}
    end_minute: int = 90


def _clock_to_min(s: str | None, end_minute: float) -> float:
    if s is None:
        return end_minute
    mm, ss = s.split(":")
    return int(mm) + int(ss) / 60.0


def _ts_seconds(ts: str) -> float:
    hh, mm, ss = ts.split(":")
    return int(hh) * 3600 + int(mm) * 60 + float(ss)


def _lineup_players(lus: list[dict], end_minute: float) -> list[dict]:
    rows = []
    for t in lus:
        for p in t["lineup"]:
            segs = p.get("positions") or []
            if not segs:
                continue  # unused substitute
            spans = []
            for s in segs:
                a = _clock_to_min(s["from"], end_minute)
                b = _clock_to_min(s["to"], end_minute)
                spans.append((max(0.0, b - a), s["position"], a, b))
            minutes = sum(d for d, *_ in spans)
            if minutes <= 0:
                continue
            primary = max(spans, key=lambda x: x[0])[1]
            rows.append({
                "id": p["player_id"],
                "name": p.get("player_nickname") or p["player_name"],
                "full_name": p["player_name"],
                "jersey": p["jersey_number"],
                "team": t["team_name"],
                "team_id": t["team_id"],
                "position": primary,
                "minutes": round(minutes, 1),
                "from_min": round(min(a for _, _, a, _ in spans), 1),
                "to_min": round(max(b for _, _, _, b in spans), 1),
            })
    return rows


def parse_match(match_id: int, meta: dict | None = None) -> MatchFrames:
    ev = events(match_id)
    lus = lineups(match_id)
    end_minute = max(e["minute"] for e in ev) + 1
    players = _lineup_players(lus, end_minute)
    pid_team = {p["id"]: p["team"] for p in players}
    teams = {t["team_id"]: t["team_name"] for t in lus}

    # per-player accumulators
    acc: dict[int, dict] = {p["id"]: {
        "touches": 0, "pressured_touches": 0,
        "pass_att": 0, "pass_cmp": 0, "pressured_att": 0, "pressured_cmp": 0,
        "prog_made": 0, "prog_recv": 0,
        "pressures": 0, "regains": 0,
        "press_zones": [0] * F.N_ZONES, "recv_zones": [0] * F.N_ZONES,
        "pos_x": [], "pos_y": [], "any_x": [], "any_y": [],
    } for p in players}
    edges: dict[tuple[int, int, str], list[int]] = {}
    xg: dict[str, float] = {name: 0.0 for name in teams.values()}

    n = len(ev)
    for i, e in enumerate(ev):
        et = e["type"]["name"]
        pl = e.get("player")
        pid = pl["id"] if pl else None
        a = acc.get(pid) if pid is not None else None
        loc = e.get("location")
        up = bool(e.get("under_pressure"))

        if a is not None and et in F.TOUCH_TYPES:
            a["touches"] += 1
            if up:
                a["pressured_touches"] += 1
            if loc:
                a["any_x"].append(loc[0]); a["any_y"].append(loc[1])

        if et == "Pass" and a is not None:
            ps = e["pass"]
            completed = "outcome" not in ps
            a["pass_att"] += 1
            a["pass_cmp"] += completed
            if up:
                a["pressured_att"] += 1
                a["pressured_cmp"] += completed
            rec = ps.get("recipient")
            end = ps.get("end_location")
            if rec and end and loc and rec["id"] in acc and pid_team.get(rec["id"]) == pid_team.get(pid):
                prog = F.is_progressive(loc[0], end[0], completed)
                key = (pid, rec["id"], F.window_id(e["minute"]))
                row = edges.setdefault(key, [0, 0, 0])
                row[0] += 1
                row[1] += completed
                row[2] += prog
                if completed:
                    a["pos_x"].append(loc[0]); a["pos_y"].append(loc[1])
                    b = acc[rec["id"]]
                    b["pos_x"].append(end[0]); b["pos_y"].append(end[1])
                    b["recv_zones"][F.zone_index(end[0], end[1])] += 1
                    if prog:
                        a["prog_made"] += 1
                        b["prog_recv"] += 1

        elif et == "Pressure" and a is not None:
            a["pressures"] += 1
            if loc:
                a["press_zones"][F.zone_index(loc[0], loc[1])] += 1
            my_team = e["team"]["id"]
            t0, period = _ts_seconds(e["timestamp"]), e["period"]
            j = i + 1
            while j < n and ev[j]["period"] == period and _ts_seconds(ev[j]["timestamp"]) - t0 <= F.REGAIN_WINDOW_S:
                if ev[j]["possession_team"]["id"] == my_team:
                    a["regains"] += 1
                    break
                j += 1

        elif et == "Shot":
            xg[e["team"]["name"]] = xg.get(e["team"]["name"], 0.0) + float(e["shot"].get("statsbomb_xg", 0.0))

    # press resistance: raw diff, team median fill, min-max within squad
    for team in teams.values():
        ids = [p["id"] for p in players if p["team"] == team]
        raw = [F.press_resist_raw(acc[i]["pass_att"], acc[i]["pass_cmp"],
                                  acc[i]["pressured_att"], acc[i]["pressured_cmp"]) for i in ids]
        filled = F.fill_with_median(raw)
        scaled = F.minmax(filled)
        for i, r, s in zip(ids, filled, scaled):
            acc[i]["press_resist_raw"] = round(r, 4)
            acc[i]["press_resist"] = round(s, 4)

    for p in players:
        a = acc[p["id"]]
        xs, ys = (a["pos_x"], a["pos_y"]) if a["pos_x"] else (a["any_x"], a["any_y"])
        p["avg_x"] = round(sum(xs) / len(xs), 2) if xs else 60.0
        p["avg_y"] = round(sum(ys) / len(ys), 2) if ys else 40.0
        for k in ("touches", "pressured_touches", "pass_att", "pass_cmp", "pressured_att", "pressured_cmp",
                  "prog_made", "prog_recv", "pressures", "regains", "press_zones", "recv_zones",
                  "press_resist", "press_resist_raw"):
            p[k] = a[k]

    pdf = pd.DataFrame(players)
    edf = pd.DataFrame([{"src": s, "dst": d, "window": w, "count": c, "completed": cc, "progressive": pr,
                         "team": pid_team[s]} for (s, d, w), (c, cc, pr) in edges.items()])
    meta = meta or {}
    stats = {}
    for tid, name in teams.items():
        goals = None
        if meta:
            goals = meta["home_score"] if name == meta.get("home") else meta["away_score"]
        stats[name] = {"team_id": tid, "xg": round(xg.get(name, 0.0), 4), "goals": goals}
    return MatchFrames(match_id=match_id, meta=meta, players=pdf, edges=edf,
                       team_stats=stats, end_minute=end_minute)
