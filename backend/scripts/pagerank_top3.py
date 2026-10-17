"""Phase 2 acceptance: PageRank top-3 for Spain in one match, from a FalkorDB CALL algo.pageRank."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.graph import cypher as Q  # noqa: E402
from app.graph import db  # noqa: E402

mid = int(sys.argv[1]) if len(sys.argv) > 1 else 3943043
team = sys.argv[2] if len(sys.argv) > 2 else "Spain"
g = db.match_graph(mid)
rows = db.q(g, Q.PAGERANK)
names = {p["id"]: p["name"] for p in db.pull_players(g)}
team_rows = sorted((r for r in rows if r[1] == team), key=lambda r: -r[2])
tot = sum(r[2] for r in team_rows)
print(f"CALL algo.pageRank('Player','PASS') on match_{mid}, {team}: {len(team_rows)} nodes")
for r in team_rows[:3]:
    print(f"  {names.get(r[0], r[0]):<22} score={r[2]:.4f}  share={r[2]/tot:.3f}")
bt = db.native_betweenness(g, len(names))
print("native betweenness:", "OK" if bt else "unavailable -> networkx fallback")
comm = db.native_communities(g)
print("native labelPropagation:", "OK" if comm else "unavailable")
print("graphs:", sorted(n for n in db.list_graphs() if n.startswith(("match_", "catalog"))))
