"""Every Cypher string in the project lives here (one place to fix a signature)."""

# ---------------------------------------------------------------- match_<id> graphs (Phase 2.2)
CREATE_PLAYERS = """
UNWIND $players AS p
CREATE (:Player {id:p.id, name:p.name, jersey:p.jersey, team:p.team, team_id:p.team_id,
                 position:p.position, avg_x:p.avg_x, avg_y:p.avg_y, minutes:p.minutes,
                 from_min:p.from_min, to_min:p.to_min, touches:p.touches,
                 pressured_touches:p.pressured_touches, press_resist:p.press_resist,
                 press_resist_raw:p.press_resist_raw, pressures:p.pressures, regains:p.regains,
                 press_zones:p.press_zones, recv_zones:p.recv_zones,
                 pass_att:p.pass_att, pass_cmp:p.pass_cmp,
                 pressured_att:p.pressured_att, pressured_cmp:p.pressured_cmp,
                 prog_made:p.prog_made, prog_recv:p.prog_recv})
"""
CREATE_EDGES = """
UNWIND $edges AS e
MATCH (a:Player {id:e.src}), (b:Player {id:e.dst})
CREATE (a)-[:PASS {count:e.c, completed:e.cc, progressive:e.p, window:e.w}]->(b)
"""
INDEX_PLAYER_ID = "CREATE INDEX FOR (p:Player) ON (p.id)"

# The simulation trick: clones get sim_* overrides, originals never change, one read serves both.
NETWORK_AGG = """
MATCH (a:Player {team:$t})-[e:PASS]->(b:Player {team:$t})
WHERE e.window IN $wins
RETURN a.id, b.id,
       sum(coalesce(e.sim_count, e.count))             AS cnt,
       sum(coalesce(e.sim_completed, e.completed))     AS cc,
       sum(coalesce(e.sim_progressive, e.progressive)) AS prog,
       count(e.sim_est)                                AS est_n
"""
NETWORK_ROWS = """
MATCH (a:Player {team:$t})-[e:PASS]->(b:Player {team:$t})
WHERE e.window IN $wins
RETURN a.id, b.id, e.window,
       coalesce(e.sim_count, e.count),
       coalesce(e.sim_completed, e.completed),
       coalesce(e.sim_progressive, e.progressive)
"""
PLAYERS_OF_TEAM = "MATCH (p:Player {team:$t}) RETURN p ORDER BY p.jersey"
PLAYERS_ALL = "MATCH (p:Player) RETURN p ORDER BY p.team, p.jersey"
SET_PLAYER_PROPS = """
UNWIND $rows AS r
MATCH (p:Player {id:r.id})
SET p += r.props
"""

# Simulation writes (Phase 2.4 / 4.1): one multiplier per (src,dst) pair, applied once per edge row
SIM_APPLY_MULTS = """
UNWIND $mults AS m
MATCH (a:Player {id:m.src})-[e:PASS]->(b:Player {id:m.dst})
WHERE e.window IN $wins
SET e.sim_count       = toInteger(e.count * m.k),
    e.sim_completed   = toInteger(e.completed * m.k),
    e.sim_progressive = toInteger(e.progressive * m.k)
"""
SIM_APPLY_REROUTES = """
UNWIND $reroutes AS r
MATCH (a:Player {id:r.src})-[e:PASS {window:r.w}]->(b:Player {id:r.dst})
SET e.sim_count     = coalesce(e.sim_count, e.count) + r.add,
    e.sim_completed = coalesce(e.sim_completed, e.completed) + r.add,
    e.sim_est       = true
"""

# Native algorithms (signatures from docs.falkordb.com/algorithms, verified 2026-10-17)
PAGERANK = "CALL algo.pageRank('Player', 'PASS') YIELD node, score RETURN node.id, node.team, score"
BETWEENNESS = """
CALL algo.betweenness({nodeLabels:['Player'], relationshipTypes:['PASS'],
                       samplingSize:$n, samplingSeed:42})
YIELD node, score RETURN node.id, node.team, score
"""
LABEL_PROPAGATION = """
CALL algo.labelPropagation({nodeLabels:['Player'], relationshipTypes:['PASS'], maxIterations:10})
YIELD node, communityId RETURN node.id, node.team, communityId
"""

# ---------------------------------------------------------------- catalog graph (Phase 2.1)
CAT_INDEXES = [
    "CREATE INDEX FOR (m:Match) ON (m.id)",
    "CREATE INDEX FOR (p:PlayerRef) ON (p.id)",
    "CREATE INDEX FOR (t:Team) ON (t.name)",
    "CREATE INDEX FOR (p:Plan) ON (p.id)",
]
CAT_MERGE_MATCH = """
MERGE (m:Match {id:$id})
SET m.comp=$comp, m.season=$season, m.date=$date, m.home=$home, m.away=$away,
    m.score=$score, m.stage=$stage, m.end_minute=$end_minute
"""
CAT_MERGE_TEAM_PLAYED = """
MATCH (m:Match {id:$mid})
MERGE (t:Team {name:$name}) SET t.id=$tid
MERGE (t)-[r:PLAYED]->(m)
SET r.xg=$xg, r.goals=$goals, r.home=$home
"""
CAT_MERGE_APPEARANCES = """
UNWIND $rows AS r
MATCH (m:Match {id:$mid})
MERGE (p:PlayerRef {id:r.id}) SET p.name=r.name
MERGE (p)-[a:APPEARED_IN]->(m)
SET a.team=r.team, a.minutes=r.minutes, a.from_min=r.from_min, a.to_min=r.to_min, a.position=r.position
"""
CAT_MATCHES = """
MATCH (m:Match) OPTIONAL MATCH (t:Team)-[r:PLAYED]->(m)
RETURN m, collect({team:t.name, xg:r.xg, goals:r.goals, home:r.home}) ORDER BY m.date
"""
CAT_TEAM_MATCHES = """
MATCH (t:Team {name:$team})-[:PLAYED]->(m:Match) RETURN m ORDER BY m.date
"""
CAT_APPEARANCES_OF = """
MATCH (p:PlayerRef {id:$pid})-[a:APPEARED_IN]->(m:Match)
RETURN m.id, a.team, a.minutes, a.from_min, a.to_min, m.end_minute
"""
CAT_SET_MATCH_PROPS = "MATCH (m:Match {id:$id}) SET m += $props"
CAT_SET_TEAM_MATCH_PROPS = "MATCH (t:Team {name:$team})-[r:PLAYED]->(m:Match {id:$mid}) SET r += $props"
CAT_SET_PLAYERREF_PROPS = "UNWIND $rows AS r MATCH (p:PlayerRef {id:r.id}) SET p += r.props"
CAT_DELETE_MATCH = "MATCH (m:Match {id:$id}) DETACH DELETE m"

# GA lineage (Phase 4.5)
CAT_CREATE_PLAN = """
CREATE (p:Plan {id:$id, gen:$gen, matchup:$matchup, created:$created, json:$json, fitness:$fitness,
                run_id:$run_id, kind:$kind})
"""
CAT_LINK_PLANS = """
MATCH (a:Plan {id:$child}), (b:Plan {id:$parent}) CREATE (a)-[:EVOLVED_FROM]->(b)
"""
CAT_PLANS_OF_RUN = "MATCH (p:Plan {run_id:$run_id}) RETURN p ORDER BY p.gen"
CAT_PLAN_BY_ID = "MATCH (p:Plan {id:$id}) RETURN p"
