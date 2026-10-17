# GRAPH SCOUT — Build Brief for Claude Code

**Project:** Opposition-preparation engine for football. FalkorDB stores one pass-network graph
per match; a simulator applies legal "suppress / cut-lane" counterfactuals by cloning and
reweighting graphs; a genetic-algorithm optimizer EVOLVES the cheapest disruption plan over the
simulation-evaluated search space (greedy kept as the measured baseline); an LLM agent
plans the analysis, calls tools, and narrates results with every claim pinned to graph evidence.
**Event:** Graph Hacks (WeMakeDevs × FalkorDB), submission closes Oct 18, 2026, 23:59 IST.
Track 1: "Agents That Act on Connected Data."

## How to drive this file

**Human:** put this file in the repo root. Create a 3-line `CLAUDE.md` next to it:
"Read BUILD_BRIEF.md fully at session start. Follow the scout-viz skill for all UI work.
Build autonomously; stop only for the reasons BUILD_BRIEF.md lists." Then in Claude Code say:
"Read BUILD_BRIEF.md and build the complete app autonomously, all phases. Ask me only when you
need credentials." Keep your Google AI Studio key ready at kickoff (`GEMINI_API_KEY` — it
serves the Gemma 4 models); it is requested once, up front.

**Claude Code:** read this entire file before writing code, then execute ALL phases in order
WITHOUT stopping for approval between them. After each phase: run its acceptance check; on
pass, append a dated `PROGRESS.md` entry and continue immediately. The ONLY valid stops:
(a) a credential or account only the human can supply — request ALL foreseeable ones once, at
Phase 0.4 (`GEMINI_API_KEY` for Google AI Studio, which serves Gemma 4; optional
`OPENROUTER_API_KEY` for the same models via `:free`); deployment logins are requested only if
Phase 8 deploy is attempted, and if the human is absent then, skip deploy and finish the
local-run package instead; (b) an acceptance check that still fails after two self-repair
attempts — report, then ask; (c) anything that would violate a Non-negotiable. Docker, git,
pip/npm installs, localhost servers, and file writes inside the repo need no permission.
Plan internally before Phases 2–7; maintain a TodoList mirroring the phase checklist.

## Non-negotiables (apply to every phase)

1. **FalkorDB is the primary datastore and the centerpiece.** All graph state lives in FalkorDB.
   Pull data out only for algorithms FalkorDB lacks (see Phase 2 policy). Never swap in SQLite,
   Postgres, or in-memory-only graphs.
2. **No-fiction contract.** We only subtract and reweight observed events. Never invent passes,
   positions, formations, or predicted scorelines. Every UI number traces to events or to a
   stated formula over events. Modeled vs. empirical results are always labeled.
3. **LLM budget & model policy.** All numeric work is Cypher/algorithms. The LLM only plans,
   selects tools, and writes prose. Hard cap: 15 LLM calls per user question (enforced in
   code). Free tiers only. **Every LLM call in this project uses Gemma 4** (the latest Gemma
   family) — primary `gemma-4-31b-it`; no other model families, not even as silent fallbacks.
4. **No auth, no signup, no login, no settings pages. Ever.**
5. **Attribution:** StatsBomb credited with logo in README, app footer, and video.
6. **Do not guess external APIs.** When unsure of FalkorDB/StatsBomb specifics, fetch
   https://docs.falkordb.com and the open-data repo's `doc/` folder. Never invent field names.
7. **Cut list when time runs short, in this order:** ACO adaptive reroute (4.6 — keep
   proportional redistribution) → landing page scroll scenes → Remotion video intro (plain
   screen recording instead) → heatmap greedy *playback animation* (keep static heatmap) →
   empirical-window evidence tool together with Eval 4E.2, which depends on it → weight
   sliders → GA lineage writeback (keep the GA itself) → Eval 4E.3.
   **Never cut:** ingestion, pitch canvas, simulate endpoint + diff animation, an optimizer
   plan (GA champion preferred; greedy alone only as emergency fallback if the GA breaks), the
   evolved-vs-greedy comparison whenever the GA ships, **Eval 4E.1 with both its baselines**,
   agent with ≥3 tools.

---

## Phase 0 — Environment & skills

### 0.1 Install agent skills (project-scoped)

```bash
npx skills add https://github.com/anthropics/skills --skill frontend-design
npx skills add https://github.com/greensock/gsap-skills
npx skills add h3nryprod01/design-taste
npx skills add iart-ai/web-animation-skills
npx skills add https://github.com/remotion-dev/skills --skill remotion-best-practices
claude mcp add playwright -- npx @playwright/mcp@latest
```

### 0.2 Create the custom project skill

Write exactly this to `.claude/skills/scout-viz/SKILL.md`:

```markdown
---
name: scout-viz
description: Design system and motion standards for the Graph Scout tactics app. Use whenever
  building, editing, or reviewing ANY UI component, page, chart, SVG, or animation in this
  project — even if the task doesn't mention design. Also use when writing landing-page copy.
---

# Identity
Dark broadcast-analytics look: near-black green-tinted background (#07120B), chalk-white pitch
lines at 40% opacity, one team color per side as the only saturated hues, amber (#F59E0B)
reserved exclusively for agent/optimizer actions. Typography: Inter or Geist; ALL numbers use
font-variant-numeric: tabular-nums. Forbidden: purple gradients, glassmorphism cards, emoji in
UI, stock illustrations, lorem ipsum, auth/signup/login/settings pages.

# Pitch canvas (core component)
SVG viewBox="0 0 120 80" — StatsBomb coordinates map 1:1; never hardcode pixels. Players =
circles, radius ∝ composite score, jersey number as label, placed at avg position. Passes =
curved quadratic paths, stroke-width ∝ count, arrowhead at target, color encodes progressive
share. Ball flow = small particles animating along edge paths, density ∝ volume. Simulation
states: suppressed player fades to 30% opacity with an amber leash-line to his presser; a cut
lane flashes red, then dims; rerouted edges thin/thicken via spring. The before→after diff must
read as a continuous animation, never a jump cut.

# Motion rules
In-app animation: Framer Motion only; animate on DATA CHANGE, never looping decoration.
200–350 ms for UI state, 600–900 ms staggered for network transitions, springs for layout.
Landing page only: GSAP + ScrollTrigger + Lenis. Animate transforms/opacity only (60 fps);
respect prefers-reduced-motion. Every changing number animates via count-up ticker.

# Landing page (built last)
Four pinned scroll-scrubbed scenes: (1) hero — pitch assembles from particles, headline types
on; (2) problem — a raw event table morphs into the clean graph; (3) scrolling scrubs a
suppression before/after on the pitch; (4) CTA into the live app. StatsBomb credit in footer.
```

### 0.3 Run FalkorDB (Docker Desktop)

```bash
docker run -d --name falkordb -p 6379:6379 -p 3000:3000 \
  -v falkordb_data:/var/lib/falkordb/data falkordb/falkordb:latest
```

Database speaks Redis protocol on :6379; the built-in FalkorDB Browser UI is at
http://localhost:3000 (use it constantly to eyeball graphs).

### 0.4 Project scaffold

```
graph-scout/
  backend/   (Python 3.11+, uv or venv)
  frontend/  (Vite + React + TypeScript + Tailwind)
  video/     (Remotion — Phase 8 only)
```

```bash
pip install falkordb statsbombpy pandas numpy networkx fastapi "uvicorn[standard]" \
            sse-starlette openai python-dotenv
npm create vite@latest frontend -- --template react-ts
cd frontend && npm i framer-motion zustand gsap lenis recharts
```

`.env` (backend): `GEMINI_API_KEY=...` (Google AI Studio — serves Gemma 4, free tier) and
optional `OPENROUTER_API_KEY=...` (same Gemma 4 models as `:free` variants, fallback host).

### 0.5 Acceptance check

`python smoke.py` must: connect with the FalkorDB client, create graph `smoke`, write one node,
read it back, `g.copy('smoke2')`, verify the copy, delete both. Exact client shape:

```python
from falkordb import FalkorDB
db = FalkorDB(host="localhost", port=6379)
g  = db.select_graph("smoke")
g.query("CREATE (:T {v:1})")
rows = g.query("MATCH (t:T) RETURN t.v").result_set
g2 = g.copy("smoke2")          # server-side GRAPH.COPY: full clone incl. indexes
g.delete(); g2.delete()
```

---

## Phase 1 — Data ingestion (StatsBomb → pandas)

### 1.1 Acquire

Primary: `statsbombpy` (fetches open data over HTTP, no auth, caches locally).
`sb.competitions()` → pick **UEFA Euro 2024** if present (demo matchup: **Spain vs England**);
fallback **FIFA World Cup 2022** (**Argentina vs France**). Ingest ALL matches of both chosen
teams in that tournament (6–7 each). Optional offline mirror:

```bash
git clone --filter=blob:none --sparse https://github.com/statsbomb/open-data.git
cd open-data && git sparse-checkout set data/competitions.json data/matches data/lineups
```

### 1.2 Extract per match (verify field names against repo `doc/` before coding)

- **Pass events:** passer, `pass.recipient`, `location` [x,y], `pass.end_location`, outcome
  (absent outcome ⇒ completed), `under_pressure` flag, `minute`, `second`, possession team.
  StatsBomb orients every event so the acting team attacks left→right on a 120×80 pitch —
  confirm in docs, then rely on it.
- **Pressure events:** presser, location, minute/second (for regain computation, scan the next
  ~5 s of the event stream: possession switching to the presser's team ⇒ regain).
- **Lineups/substitutions:** minutes played, position, jersey number.

### 1.3 Derived definitions (fixed; state them in the README)

- **Progressive pass:** completed AND (`end_x − x ≥ 15`) OR (`end_x ≥ 80` AND `end_x − x ≥ 5`).
- **Zones:** 6 columns × 4 rows of 20×20 units → zone id `c{0..5}r{0..3}`.
- **Windows:** `0-15, 15-30, 30-45, 45-60, 60-75, 75-90+` by minute.
- **Aggregation unit:** one directed edge per (passer, recipient, window) with
  `count, completed, progressive` ints. Also per player: avg_x/avg_y (completed-pass origins +
  receptions), touches, minutes, zone histograms of presses made and receptions.

Acceptance: a notebook/script prints, for one match, 22 players and a sane edge table.

---

## Phase 2 — The FalkorDB layer (this is the project's spine)

### 2.1 Graph topology (multigraph: many isolated graphs, one DB)

- `catalog` — one graph: `(:Match {id, comp, season, date, home, away, score})`,
  `(:Team {name})`, `(:PlayerRef {id, name})`,
  `(:PlayerRef)-[:APPEARED_IN {team, minutes, from_min, to_min}]->(:Match)`.
  Cached baselines live here too: `SET m.C_base_<TEAM> = ...` after Phase 3.
  The agent's saved analyses and the GA lineage: `(:Plan {id, gen, matchup, created, json,
  fitness})`, chained by `[:EVOLVED_FROM]` edges (written in Phase 4.5).
- `match_<id>` — one graph per fixture, both teams inside:
  `(:Player {id, name, jersey, team, avg_x, avg_y, minutes, touches, press_resist})`,
  `(:Player)-[:PASS {count, completed, progressive, window}]->(:Player)`.
- `sim_<uuid>` — throwaway clones created per simulation, deleted after (2.4).

### 2.2 Ingestion (aggregate in pandas, write in batched UNWINDs — two queries per match)

```python
g = db.select_graph(f"match_{mid}")
g.query("""
UNWIND $players AS p
CREATE (:Player {id:p.id, name:p.name, jersey:p.jersey, team:p.team,
                 avg_x:p.ax, avg_y:p.ay, minutes:p.min, touches:p.t,
                 press_resist:p.pr})""", {"players": players})
g.query("""
UNWIND $edges AS e
MATCH (a:Player {id:e.src}), (b:Player {id:e.dst})
CREATE (a)-[:PASS {count:e.c, completed:e.cc, progressive:e.p, window:e.w}]->(b)
""", {"edges": edges})
g.query("CREATE INDEX FOR (p:Player) ON (p.id)")
```

Mirror players/matches into `catalog` with MERGE. ~14 match graphs + catalog ⇒ seconds of work.

### 2.3 Reads every feature uses

```cypher
// windowed network pull (UI + metrics); $wins = selected windows
MATCH (a:Player {team:$t})-[e:PASS]->(b:Player {team:$t})
WHERE e.window IN $wins
RETURN a.id, b.id, sum(coalesce(e.sim_count, e.count))      AS cnt,
       sum(coalesce(e.sim_completed, e.completed))          AS cc,
       sum(e.progressive)                                    AS prog
```

The `coalesce(e.sim_*, e.*)` idiom is the simulation trick: clones get `sim_*` overrides,
originals never change, and ONE read query serves both baseline and simulated graphs.

### 2.4 Simulation = clone → reweight → recompute → diff → delete

```python
sim = db.select_graph(f"match_{mid}").copy(f"sim_{uuid}")   # GRAPH.COPY, server-side
sim.query("""MATCH ()-[e:PASS]->(t:Player {id:$y})
             SET e.sim_count = toInteger(e.count * $k),
                 e.sim_completed = toInteger(e.completed * $k)""", {"y": y, "k": k})
# lane cut: same SET but MATCH (a {id:$x})-[e:PASS]->(b {id:$y})
# ... run metric reads on `sim`, diff vs. baseline, then:
sim.delete()
```

Dozens of clones per optimizer run is intended usage and the multigraph demo story — say so in
the README.

### 2.5 Algorithms policy

Native-first: run PageRank and a community algorithm (label propagation / Louvain-family) **in
FalkorDB** via its algorithm procedures — fetch https://docs.falkordb.com/algorithms/ for the
exact `CALL` names/signatures of the installed version before writing these calls; do not guess.
Shortest/weighted paths: FalkorDB path queries. **Fallback rule:** anything the installed
version lacks (betweenness if absent, and max-flow, which graph DBs don't ship) is computed in
`networkx` from a single edge-list pull (2.3 query), with FalkorDB remaining the source of
truth. Cache per-match results back onto nodes (`SET p.pr_share=...`) and onto `catalog`.

Acceptance: script prints PageRank top-3 for Spain in one match, from a FalkorDB `CALL`.

---

## Phase 3 — Formulas (implement exactly; expose constants in `formulas.py`)

**Normalization rule:** every centrality is converted to a within-match share (player ÷ team
total) or z-score among teammates before any cross-match averaging; report mean ± std.

**Press resistance (per player):** `pr = comp_rate(under_pressure) − comp_rate(all)`, then
min-max to [0,1] across the squad. If a player has <15 pressured passes, use team median.

**Player composite (the "player score"):**
`S_p = 0.30·PR_share + 0.30·BT_share + 0.25·ProgInv_share + 0.15·press_resist`
(PR = PageRank, BT = betweenness, ProgInv = share of team's progressive passes made+received;
z-score within match, average across matches, keep std). Weights are UI sliders (Phase 7).

**Team circulation score (per match, per team):** build the completed-pass network; add
super-source S→{GK, CBs} and {FW, wingers}→super-sink T (positions from lineups).
- `M` = max-flow S→T with capacities = completed counts (networkx)
- `D` = count of edge-disjoint S→T paths (max-flow with unit capacities)
- `V` = completed progressive volume
`C = 100 · (0.5·M/M₀ + 0.3·V/V₀ + 0.2·D/D₀)` where `₀` = same match unmodified ⇒ baseline is
always 100 and every simulation reports ΔC%.

**Attenuation coefficient (matchup-aware suppression):** our X man-marks their Y ⇒ multiply all
edges INTO Y by
`k = clamp(1 − regain(X) · overlap(X,Y) · (1 − press_resist(Y)), 0.25, 0.90)`
where `regain(X)` = share of X's pressures followed by his team winning the ball within 5 s, and
`overlap` = histogram intersection of X's pressing-zone distribution with Y's receiving-zone
distribution (∈[0,1]). Lane cut X→(a→b): multiply that one edge by fixed `k_lane = 0.30`.
Each intervention occupies exactly one of our players (one job per presser).

**Reroute (estimated edges):** suppressed inflow into Y from passer a is redistributed across
a's other out-edges in the same zone column, proportional to their observed counts; write as
`sim_count` increases and tag `e.sim_est = true` so the UI can style estimates differently.

**Validation ablation (required submission chart):** for every match: ΔC from suppressing the
top-S_p player at k=0.3 vs. ΔC from suppressing the median player. Two distributions, one chart.
This is the proof the score measures structural dependence.

Acceptance: `pytest` covering progressive flag, zone ids, k clamping, reroute conservation
(total redistributed ≤ total suppressed), and C(baseline)=100.

---

## Phase 4 — Simulator & optimizers (pure Python service layer)

### 4.1 Simulator

**Request:** `{match_ids:[], team, interventions:[{type:"suppress"|"cut_lane"|"delete",
target_player?|edge?:{src,dst}, presser?, k_override?}], windows?:[]}`
**Diff (per match, plus aggregate mean±std):** `{dC_pct, M_before, M_after, D_before, D_after,
inheritance:[{player, new_BT_share}], rerouted_edges:[{src,dst,old,new,est}],
basis:"modeled"|"empirical", sim_graph:"sim_..."}`

**Engine order:** (1) empirical check — query `catalog` APPEARED_IN for matches/minute-ranges
where the target didn't play; if ≥20 such minutes exist, compute real metrics on that window and
return `basis:"empirical"` alongside the modeled run; (2) clone; (3) apply interventions +
reroute; (4) recompute metrics; (5) diff; (6) delete clone.

### 4.2 Two-tier evaluation (what makes evolution feasible tonight)

**Tier A — authoritative:** the FalkorDB clone→reweight→recompute pipeline above. Used for all
baselines, for every number shown as verified, and for the final champion plan.
**Tier B — fast fitness:** pull each opponent match's edge list from FalkorDB ONCE (query 2.3)
into numpy/dict structures; evaluating one candidate plan = reweight arrays + rerun max-flow in
memory, ~ms per plan, so a whole evolution (~600 evaluations) finishes in seconds, live.
**Consistency test (required):** for 5 random plans, Tier B ΔC must match Tier A within 0.5
points; on mismatch, fix Tier B — Tier A is truth.

### 4.3 Greedy baseline (kept: it is the comparison, the fallback, and the heatmap's engine)

Candidates = our top 6 pressers (pressure volume × regain) × targets = their top-4 by S_p plus
top-3 lanes by progressive volume. Fill the damage matrix via Tier B across all their matches
(mean ΔC, std). Greedy: pick best feasible cell, lock it, **re-simulate the remaining matrix
with locked interventions applied** (interactions are the point), repeat to max 4 commitments.
Constraints: one job per presser; support `force:[cells]` and `forbid:[cells]` for
human-in-the-loop re-solve. Output: ordered plan with marginal ΔC per step (commitment curve).

### 4.4 GA optimizer — the headline (nature-inspired plan evolution)

Why GA here is methodologically correct, for the README: the plan space is discrete and
constrained, fitness is black-box (a simulation, not a formula), and interventions interact
non-additively — greedy's exact blind spot. Implementation: plain Python (~80 lines) or DEAP.
**Chromosome:** fixed-length list of 4 genes; each gene is `None` or
`{presser, action:"mark"|"cut", target: player|edge}` drawn from the 4.3 candidate pools.
**Repair:** after crossover/mutation, drop duplicate-presser genes (keep the earlier).
**Fitness** (Tier B): `mean ΔC across opponent matches − 1.5 × committed_players`, so a lethal
two-man plan can beat a mediocre four-man plan; keep std for the UI. **Operators:** uniform
crossover (p=0.5 per gene); mutation (p=0.25 per gene): swap presser | retarget | fill an empty
slot | empty a gene. **Selection:** tournament k=3. **Params:** population 30, generations 20,
elitism 2. **Seed population:** greedy's full plan + its prefixes + randoms ⇒ the champion is
never worse than greedy by construction. Fixed RNG seed per request for reproducible demos.

### 4.5 Champion verification, lineage writeback, explainability

Run the champion through Tier A for the authoritative diff and the pitch animation. Write the
lineage into `catalog`: one `(:Plan {id, gen, json, fitness, matchup, created})` per
generation's best, chained `(:Plan)-[:EVOLVED_FROM]->(:Plan)` — the evolution history is itself
a graph (open it in FalkorDB Browser; screenshot for the README). **Gene ablation** (restores
the per-element "why" the track demands): re-run the champion with each gene removed one at a
time (Tier A) and attach each gene's marginal ΔC to the plan output. **Required chart:**
evolved vs greedy ΔC at equal player budget — the proof evolution bought something.

### 4.6 Stretch — ACO adaptive reroute (first item on the cut list)

Replace proportional redistribution inside simulations with ant-colony re-convergence: ants
walk defense→attack over OBSERVED completed edges only (initial pheromone ∝ completed counts,
evaporation 0.1, ~200 ants × 50 iterations, Tier B speed); block the cut lane; the converged
pheromone distribution is the adaptation estimate. Still subtract-and-reweight over observed
edges — the no-fiction contract holds. Feature-flag `REROUTE=aco|proportional`; the UI may
animate the ants on the pitch. Build only after Phases 5–7 are demo-ready.

---

## Phase 4E — Evaluation: numerical agreement with what experts are paid for

Principles governing every test here: a system cannot grade its own homework, so ground truth
comes from OUTSIDE the system (real coaching decisions, real absences, the industry's xG); and
every test is **held-out** — the system never sees the match it is tested on. Leaking the test
match into the scores is the classic silent cheat; the unit test in 4E.4 guards it. Sample
size: if the two demo teams' ~13 matches feel thin for 4E.2/4E.3, extend Phase 1 ingestion to
the WHOLE tournament with the same pipeline (~51 match graphs) — evals strengthen, the demo
still centers on the two teams.

### 4E.1 Expert agreement — REQUIRED (on the never-cut list)

Claim tested: the system identifies the disruption targets that World Cup coaching staffs
actually chose. Protocol (leave-one-out): for each match m of the analyzed team, recompute
S_p using every match EXCEPT m; prediction = top-S_p outfield player with ≥45 min in m.
Ground truth in m: pressures received per touch from the real opponent (outfield, ≥45 min,
GK excluded). Metrics: (a) **top-3 hit rate** — share of held-out matches where our #1 is
among the opponent's three most-pressured-per-touch players; (b) **Spearman rank correlation**
between the S_p ranking and the pressure-per-touch ranking, averaged across matches.
Mandatory baselines beside the result: random targeting (chance computed analytically, ≈3/N
for N eligible candidates, or via 10k permutations) and the most-touches heuristic.
Deliverable: one chart (hit rate vs both baselines) plus the sentence with real numbers:
"Blind to the match, the system re-derives the pressing targets elite staffs chose in k of n
held-out games, against a c% chance rate."

### 4E.2 Out-of-sample impact prediction (cut only together with the empirical-window tool)

Claim tested: simulated ΔC anticipates reality. Collect every absence window in the ingested
dataset: a team's top-4-by-S_p player missing a full match, or subbed off/on with ≥20 min
remaining. Predicted ΔC: simulator built ONLY from matches where he played (k matchup-derived
where possible, else 0.3; full-match absence uses delete). Observed ΔC: per-minute-normalized
C in the real absence window vs that team's per-minute C in comparable windows of its other
matches. Metrics: predicted-vs-observed scatter with **Pearson r** and **MAE** in ΔC points,
n stated. Baseline: the always-predict-zero forecaster's MAE — ours must beat it, or the
counterfactuals are decoration.

### 4E.3 Construct validity — C tracks what experts optimize

Claim tested: our invented circulation score moves with the industry's own currency of chance
quality. For every ingested team-match: x = C, y = total xG created (sum of StatsBomb shot
xG; own goals excluded). Report Pearson and Spearman r with the scatter. Honest framing:
correlation, not causation — evidence that reducing C plausibly means reducing chance
creation, nothing more.

### 4E.4 Reporting rules (bind Phases 5, 7 and 8)

Counts beside percentages, always ("10 of 13", never a bare 77%); every metric printed beside
its baseline; fixed seeds everywhere. Claim calibration — allowed: "agrees with elite
targeting decisions out-of-sample", "predicts the structural impact of real absences",
"objective tracks xG"; forbidden: "better than experts", "predicts match outcomes". Leakage
guard: `pytest` asserts the fold-m score table contains no rows from match m.

Acceptance: leakage test green; three charts written to `eval/` and embedded in the README
beside their baselines; numbers served by the `eval_summary()` tool (Phase 5).

---

## Phase 5 — The agent

**LLM — Gemma 4 for everything (see Non-negotiable 3):** primary model `gemma-4-31b-it`
(Gemma 4's 31B dense flagship: strongest reasoning in the family, 256K context, native
function-calling and system-role support — built for agentic workflows); alternate
`gemma-4-26b-a4b-it` (MoE, faster) if 31B rate limits bite. Primary host: Google AI Studio
(`GEMINI_API_KEY`, free tier) via its OpenAI-compatible endpoint
`https://generativelanguage.googleapis.com/v1beta/openai/`; fallback host: OpenRouter
`google/gemma-4-31b-it:free` — a different roof over the SAME model, so the Gemma-only policy
holds. Confirm exact model ids against each host's live model list at build time. **Tool-calling
probe (do this before wiring the agent):** one test call with a dummy tool through the OpenAI
`tools` parameter; if the chosen endpoint rejects or ignores it for Gemma, switch the agent
loop to the manual protocol — tool schemas in the system prompt, the model must reply with
exactly one fenced JSON object `{"tool": "...", "args": {...}}` or `{"final": "..."}`, code
parses strictly, executes, appends the result, loops; one re-prompt on a parse failure, then
abort the turn loudly. `temperature=0` for tool selection. Enforce the 15-call budget with a
counter that errors loudly.

**Tools (function-calling; every tool returns data + `refs`):** `list_matches(team)`,
`team_profile(team)`, `player_scores(team, weights?)`, `decompose_influence(player)` (top
in/out lanes by progressive volume), `pressure_profile(player)`, `empirical_window(player)`,
`simulate(request)`, `optimize(matchup, method:"ga"|"greedy", max_commitments, force?,
forbid?)` — `"ga"` (default) returns the verified champion, the greedy baseline for comparison,
and per-gene ablation ΔC — `eval_summary()` (the Phase 4E results with their baselines, for
"why should I trust this?" questions, phrased within the 4E.4 claim-calibration rules), and
`save_plan(plan)` → `catalog`.

**Response contract (what makes the UI light up):** the agent streams prose, then a fenced JSON
block: `{claims:[{text, refs:["player:5503","edge:3233->5203","match:3942819"],
basis:"modeled"|"empirical", value:"-31%"}], plan_id?}`. Frontend parses refs into highlights.
System prompt states the no-fiction contract and: numbers come only from tool outputs.

---

## Phase 6 — API (FastAPI, CORS wide open, no auth)

`GET /matches` · `GET /network/{match_id}?team&windows` · `GET /scores/{team}?weights` ·
`POST /simulate` · `POST /optimize` (SSE: one event per generation
`{gen, best_fitness, champion_genes}`; final event = Tier-A-verified champion diff + greedy
comparison + gene ablations) · `GET /ablation` · `POST /chat` (SSE stream of tokens + final
claims JSON). Serve on :8000; frontend proxies `/api`.

---

## Phase 7 — Frontend (follow scout-viz skill; after each component run the Playwright loop:
open dev server, screenshot, critique against the skill, fix — 2 cycles minimum)

Build order: **PitchCanvas** with mock JSON first (players, edges, flow particles) →
**WindowBrush** (window multi-select re-querying /network) → **SimDiff animation** (apply a
hardcoded suppression: leash, fade, reroute springs, ΔC ticker) → **AssignmentHeatmap**
(pressers × targets; cells colored by mean ΔC, dimmed by low overlap; "play greedy" button steps
①②③ with the matrix re-cooling between picks) → **CommitmentCurve** (marginal ΔC per commitment;
mark the knee) → **EvolutionView** (driven by the /optimize SSE: fitness-over-generations line
climbing live, the current champion's genes drawn as amber leashes/red cuts on a mini-pitch
that morphs each generation, closing frame = evolved-vs-greedy bars with gene-ablation
breakdown) → **AgentPanel** (chat; claims' refs highlight pitch elements on hover/click;
modeled vs empirical badge) → **WeightSliders** (re-rank scores live) → **EvidencePanel**
(the score-ablation chart plus the three 4E charts — expert-agreement hit rate vs chance,
predicted-vs-observed ΔC scatter, C-vs-xG scatter — each rendered beside its baseline) →
**Landing** (last; four GSAP scenes from the skill). State: one zustand store with a
`highlights: Set<ref>` bus every component subscribes to.

---

## Phase 8 — Submission package

1. **Deploy if time allows** (rules prefer live): FalkorDB Cloud free instance, backend on a
   free host, frontend on Vercel. Otherwise the rules require full local setup instructions —
   README with the exact Phase 0 commands — **plus a demo video**.
2. **Video (2–3 min):** Remotion-rendered intro (use the installed skill) or screen recording:
   problem (10 s) → pitch + windows (25 s) → "mark Rodri" simulation live (35 s) → greedy
   heatmap + commitment curve (25 s) → **evolution running live: fitness climbing, champion
   morphing on the mini-pitch, evolved-vs-greedy reveal** (40 s) → agent answering "how do we
   beat Spain?" with the pitch lighting up (30 s) → evidence close: the 4E.1 sentence on
   screen ("k of n held-out matches, vs c% chance") over the agreement chart, then the
   score-ablation chart (15 s).
3. **README sections:** what it does; why a graph is load-bearing (multi-hop flow, max-flow,
   path diversity — not row lookups); FalkorDB's central role (graph-per-match multigraph,
   GRAPH.COPY counterfactuals, native algorithms, Browser screenshots); the no-fiction
   contract and the full assumptions list (progressive definition, k formula, reroute rule);
   the optimizer story (why a GA fits a discrete, constrained, simulation-evaluated,
   non-additive search space; greedy as baseline; evolved-vs-greedy chart; lineage-graph
   screenshot); the Evaluation section — all three Phase 4E results, each chart beside its
   baseline, the calibrated claim sentences, and the leakage-guard note; formulas from
   Phase 3; StatsBomb credit + logo; FalkorDB/WeMakeDevs mention.
4. Blog post (optional side prize): "Counterfactual football tactics with graph clones."

## PROGRESS.md discipline

After each phase append: date/time IST, what shipped, acceptance-check result, deviations from
this brief and why, next phase. Do NOT wait for human review between phases — this log replaces
it. Stop and ask only for the three conditions in "How to drive this file"; a deviation that
touches a Non-negotiable is always one of them.
