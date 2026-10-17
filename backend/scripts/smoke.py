"""Phase 0 acceptance: FalkorDB connect -> create -> read -> GRAPH.COPY -> verify -> delete."""
from falkordb import FalkorDB

db = FalkorDB(host="localhost", port=6379)
g = db.select_graph("smoke")
g.query("CREATE (:T {v:1})")
rows = g.query("MATCH (t:T) RETURN t.v").result_set
assert rows == [[1]], rows
g2 = g.copy("smoke2")          # server-side GRAPH.COPY: full clone incl. indexes
rows2 = g2.query("MATCH (t:T) RETURN t.v").result_set
assert rows2 == [[1]], rows2
names = set(db.list_graphs())
assert {"smoke", "smoke2"} <= names, names
g.delete(); g2.delete()
assert not ({"smoke", "smoke2"} & set(db.list_graphs()))
print("smoke OK: create/read/copy/verify/delete")
