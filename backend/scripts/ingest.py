"""Phase 1/2 driver: parse StatsBomb matches, write match_<id> graphs + catalog.

  python scripts/ingest.py --match 3943043 --print --no-write   # Phase 1 acceptance
  python scripts/ingest.py                                      # both demo teams (13 matches)
  python scripts/ingest.py --whole-tournament                   # all 51 Euro 2024 matches
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from app.ingest.load import demo_match_list, ingest_all, ingest_match  # noqa: E402
from app.ingest.statsbomb import match_meta, parse_match, pick_tournament  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--match", type=int)
    ap.add_argument("--print", action="store_true")
    ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--whole-tournament", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    pd.set_option("display.width", 200, "display.max_columns", 30, "display.max_rows", 80)

    if a.match:
        t = pick_tournament()
        meta = next((match_meta(m) for m in t["matches"] if m["match_id"] == a.match), {})
        mf = parse_match(a.match, meta) if a.no_write else ingest_match(a.match, meta)
        if a.print:
            cols = ["id", "name", "jersey", "team", "position", "minutes", "touches", "pressures",
                    "regains", "pressured_att", "press_resist", "avg_x", "avg_y"]
            print(f"\nMatch {a.match}: {meta.get('home')} {meta.get('score')} {meta.get('away')} "
                  f"({meta.get('stage')}, {meta.get('date')}), end minute {mf.end_minute}")
            print(f"players who played: {len(mf.players)} (starters: "
                  f"{int((mf.players.from_min == 0).sum())})")
            print(mf.players[cols].sort_values(["team", "minutes"], ascending=[True, False]).to_string(index=False))
            print(f"\nedges: {len(mf.edges)} rows; attempts {int(mf.edges['count'].sum())}, "
                  f"completed {int(mf.edges.completed.sum())}, progressive {int(mf.edges.progressive.sum())}")
            names = dict(zip(mf.players.id, mf.players.name))
            e = mf.edges.assign(passer=mf.edges.src.map(names), recipient=mf.edges.dst.map(names))
            print(e.sort_values("count", ascending=False).head(15)[["team", "passer", "recipient", "window",
                                                                   "count", "completed", "progressive"]].to_string(index=False))
            print("\nteam stats:", mf.team_stats)
        return

    t0 = time.time()
    t, metas = demo_match_list(a.whole_tournament)
    print(f"tournament: {t['comp_id']}/{t['season_id']} our={t['our']} their={t['their']}; {len(metas)} matches")
    mfs = ingest_all(a.whole_tournament)
    print(f"ingested {len(mfs)} matches in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
