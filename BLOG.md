# Counterfactual football tactics with graph clones

*How we turned "what if we mark Rodri?" into a graph operation — Graph Scout, built for Graph Hacks on FalkorDB.*

Opposition analysts answer one question all week: who do we take out of their game, and what happens to the
rest of their team if we do? Humans answer it with video and intuition. We wanted a version where every number
traces to an observed event — no invented passes, no imagined formations, no predicted scorelines.

## A match is a graph, a tournament is 51 of them

Each StatsBomb match becomes one FalkorDB graph: `:Player` nodes with their average positions, and one
`[:PASS {count, completed, progressive, window}]` edge per passer → recipient → 15-minute window. Fifty-one Euro 2024
matches, fifty-one graphs, one database, plus a `catalog` graph that knows who played when. Centrality comes from
FalkorDB's own procedures (`algo.pageRank`, `algo.betweenness`); the "team circulation" score C is a max-flow from
the goalkeeper and centre-backs to the forwards, with completed passes as capacities, plus path diversity and
progressive volume. Baseline C is 100 by construction, so every intervention is a ΔC%.

## The trick: clone, reweight, read with one query, delete

A counterfactual should never touch the record. So: `GRAPH.COPY match_3943043 sim_7f3a…`, then
`SET e.sim_count = toInteger(e.count * k)` on the edges into the marked player, then read the network with
`coalesce(e.sim_count, e.count)` — the same read query serves the original and the clone — compute C, diff, delete
the clone. k is matchup-aware: how often our presser wins the ball back within five seconds, how much his pressing
zones overlap the target's receiving zones (after mirroring the frame — both teams attack left→right in the data),
and how press-resistant the target is. Removed passes are rerouted onto the passer's other *observed* lanes in the
same zone column, flagged as estimates. We only ever subtract and reweight what happened.

## Evolving a plan over a simulator

With four pressers to assign, the plan space is discrete, constrained and non-additive: cutting Cucurella→Williams
changes what marking Olmo is worth. Greedy (lock the best cell, re-simulate the rest) is our baseline. A genetic
algorithm evolves 4-gene plans — each gene "presser X marks Y" or "presser X cuts lane a→b" — with fitness
`damage − 1.5 × players committed`, so a lethal two-man plan beats a mediocre four-man plan. Fitness runs on an
in-memory tier (edge lists pulled from FalkorDB once; 600 evaluations in two seconds); the champion is then re-run
through the FalkorDB clone pipeline, which must agree exactly (it does — both tiers apply one integer-truncated
multiplier per edge row). The evolution history is written back as `(:Plan)-[:EVOLVED_FROM]->(:Plan)`, so the
optimizer's own lineage is a graph you can open in the Browser.

England v Spain: Rice cuts Cucurella→Nico Williams, Bellingham marks Olmo, Foden cuts Fabián Ruiz→Williams, Saka marks
Carvajal — ΔC −16.1% across Spain's seven matches. Evolution confirmed greedy's plan here; we say so.

## The agent only talks

Claude Sonnet plans the analysis, calls ten graph tools and writes prose; it is forbidden to produce a number a tool
did not return, must label modeled vs empirical, and ends every answer with a JSON block of claims whose `player:`,
`edge:` and `match:` references light up the pitch. Fifteen model calls per question, enforced in code.

## Grading our own homework, honestly

Ground truth comes from outside the system. Held out, our top target lands among the opponent's three
most-pressed-per-touch players in 5 of 14 Spain/England games (chance 28%) — and only at chance across all 24 teams
(26 of 102 vs 29%). Our simulator's predicted impact of a real full-match absence correlates with the observed drop
(r = +0.28, n = 22) and beats an always-zero forecaster; for substitution windows it does not. The circulation score
tracks xG (Pearson +0.40, n = 102). We publish the misses next to the hits, each beside its baseline, because a
counterfactual engine that cannot be falsified is decoration.

Data: StatsBomb Open Data. Database: FalkorDB. Code: this repository.
