# PROGRESS.md — Graph Scout build log

Deviation standing for the whole build (user-directed at kickoff, 2026-10-17 17:30 IST):
the LLM is Anthropic `claude-sonnet-5-5` via the official `anthropic` SDK instead of Gemma 4;
no Gemini/OpenRouter keys. The 15-call budget, tools-only numbers, and prose-only LLM role stand.
Data is read from the local `open-data/data/` clone with per-file HTTP fallback.

## Phase 0 — Environment — 2026-10-17 18:05 IST
Shipped: CLAUDE.md, .claude/skills/scout-viz/SKILL.md (verbatim), .gitignore, git init; FalkorDB container
`falkordb` on :6379/:3000 (falkordb/falkordb:latest); backend uv venv Python 3.12 with falkordb, pandas, numpy,
networkx, fastapi, uvicorn, sse-starlette, anthropic 1.15, pytest, matplotlib, scipy; frontend Vite 8 + React 19 +
TS + Tailwind 4 + framer-motion, zustand, gsap, lenis, recharts, @playwright/test; brief §0.1 skills installed
(frontend-design, gsap-*, design-taste, web-animation-*, remotion-best-practices) and Playwright MCP added.
Acceptance: `python scripts/smoke.py` -> "smoke OK: create/read/copy/verify/delete" (PASS).
Deviations: statsbombpy/openai not installed (data read from local clone + HTTP; LLM is Anthropic). Python 3.12
via uv because the system only has 3.10 / 3.11rc1. Next: Phase 1 ingestion.

## Phase 1 — Ingestion — 2026-10-17 18:35 IST
Shipped: `backend/app/ingest/statsbomb.py` (local clone -> HTTP cache -> raw.githubusercontent fallback; field
names verified against events/3943043.json and lineups/3943043.json), `app/metrics/formulas.py` (all constants),
`scripts/ingest.py`. Tournament = UEFA Euro 2024 (55/282); Spain v England final 3943043; 13 demo matches.
Acceptance: `python scripts/ingest.py --match 3943043 --print --no-write` -> 29 players who played (22 starters),
526 (passer, recipient, window) edges, 877 attempts / 772 completed / 174 progressive, xG Spain 1.79 England 0.73 (PASS).
Deviations: statsbombpy not used (local JSON). Per-match press resistance is mostly the team-median fill (few players
reach 15 pressured passes in one match) so scoring uses a tournament-level press resistance computed from the per-match
counts stored on the nodes; the per-match value is also kept on each :Player node.

## Phase 2 — FalkorDB layer — 2026-10-17 18:45 IST
Shipped: `app/graph/cypher.py` (every Cypher string), `app/graph/db.py`, `app/ingest/load.py`; graphs `catalog` +
13 `match_<id>` (two UNWIND writes + index per match; catalog has Match/Team/PlayerRef, PLAYED {xg, goals},
APPEARED_IN {team, minutes, from_min, to_min, position}). Native algorithms verified on this FalkorDB build:
`algo.pageRank('Player','PASS')`, `algo.betweenness({...samplingSeed:42})`, `algo.labelPropagation({...})`.
Acceptance: `python scripts/pagerank_top3.py` -> Spain final top-3 by native PageRank: Olmo 0.097, Fabián Ruiz 0.094,
Zubimendi 0.086 share (PASS). 13 matches ingest in ~1 s.

## Phase 3 — Formulas — 2026-10-17 19:05 IST
Shipped: `app/metrics/circulation.py` (S->{GK,CBs}, {FW,wingers}->T by lineup position substring; M, D via networkx
max-flow in BOTH tiers; V progressive), `app/metrics/scores.py` (within-match shares -> z-scores -> S_p mean+-std,
tournament press resistance, regain, zone profiles, k lookup, catalog PlayerRef writeback), `app/sim/model.py` (the
single reweighting rule), `app/sim/tier_a.py`, `app/sim/tier_b.py`, `app/sim/empirical.py`, `app/sim/engine.py`.
Acceptance: `pytest tests/test_formulas.py` 9 passed (progressive, zones/mirror, windows, k clamp, overlap, reroute
conservation 5<=6, delete, cut lane, C(baseline)=100). `pytest tests/test_consistency.py` 1 passed: Tier B == Tier A
exactly on 5 random plans x 3 matches, no sim_* clones left behind.
Deviation: brief's literal k = clamp(1 - regain*overlap*(1-press_resist)) hits the 0.90 ceiling for EVERY pair on this
data (raw product < 0.1), so `formulas.K_MODE="relative"` feeds the same formula squad-relative regain and pool-relative
overlap; "raw" mode is kept and both values are reported per pair. Max-flow is networkx in both tiers (brief's
sanctioned fallback) so Tier A/B cannot drift; native algo.maxFlow is a cross-check only.

## Phase 4 — Simulator & optimizers — 2026-10-17 19:45 IST
Shipped: `app/optim/candidates.py` (our top-6 pressers x their top-4 S_p + top-3 progressive lanes, k matrix),
`app/optim/greedy.py` (lock best cell, re-simulate remaining matrix with locked interventions, force/forbid, commitment
curve + knee), `app/optim/ga.py` (4-gene chromosome, repair, uniform crossover 0.5, mutation 0.25 with swap/retarget/
fill/empty, tournament k=3, pop 30, 20 gens, elitism 2, greedy-seeded, fixed seed), `app/optim/run.py` (SSE-shaped
event stream: start -> greedy -> generation x21 -> final with Tier-A-verified champion, greedy at equal budget, per-gene
ablation, best-per-budget comparison, lineage `(:Plan)-[:EVOLVED_FROM]->(:Plan)` in catalog), `scripts/optimize.py`.
Acceptance: England v Spain GA run in 12 s (1.5 s evolution + ~40 Tier A clones): champion = Rice cuts
Cucurella->N.Williams, Bellingham marks Olmo, Foden cuts F.Ruiz->N.Williams, Saka marks Carvajal; ΔC -16.1% +-7.6
over 7 Spain matches (Tier A == Tier B). Consistency test green. The GA matched greedy on this matchup (no better
4-gene plan exists in the pool; reported as such, never inflated).
Deviation/fix: reroutes now land only on lanes with >=1 observed completed pass (an attempted-only lane could
otherwise gain a completed pass -> new flow path -> ΔC>0 artefacts). Score-ablation chart written:
eval/score_ablation_in_sample.png (top-S_p -9.1 vs median -3.6, top more damaging in 9 of 14) and held-out variant.

## Phase 5 — Agent — 2026-10-17 20:35 IST
Shipped: `app/agent/tools.py` (10 tools, every result carries refs: list_matches, team_profile, player_scores,
decompose_influence, pressure_profile, empirical_window, simulate, optimize, eval_summary, save_plan),
`app/agent/loop.py` (official `anthropic` SDK, `claude-sonnet-5-5`, manual streaming tool-use loop, prompt-cached
system prompt, hard LLM_BUDGET=15 enforced by a counter that aborts loudly, strict parse of the final fenced JSON claims
block with refs filtered to those returned by tools this turn, modeled/empirical labelling, calibrated-claim rules in
the system prompt), `scripts/chat.py`. No temperature / forced tool_choice (both 400 on this model).
Acceptance: BLOCKED on a credential — the key in .env (prefix `sk-ant-usr…`) is rejected by the API with 401
"invalid x-api-key"; a standard key starts with `sk-ant-api03-`. The loop reloads .env per question, so pasting a valid
key into .env is enough (no restart). Everything else proceeds; re-run `python scripts/chat.py "How do we beat Spain?"`.

## Phase 6 — API — 2026-10-17 20:40 IST
Shipped: `app/api/main.py` (FastAPI, CORS *, no auth, :8000, routes under /api): GET matches, network/{id}?team&windows,
scores/{team}?w_*, profile/{team}, player/{id}, ablation, eval, optimize/last; POST simulate; POST optimize (SSE: start,
greedy, one generation event per generation, final = Tier-A-verified champion + greedy comparison + gene ablations; GA
runs in a worker thread feeding an asyncio queue); POST chat (SSE tokens + tool events + claims JSON). Startup sweeps
stale sim_* clones. `backend/run_api.sh`.
Acceptance: curl health/matches/network/scores/simulate/player all return correct shapes (e.g. Spain final 0-30':
M=30 V=38 D=11; Rice marks Rodri -> modeled ΔC -1.4% +-0.7 over 7 matches, empirical ΔC -7.6% from Rodri's real
absence windows) (PASS). Frontend build (Phase 7) delegated to a subagent against this contract.

## Phase 4E — Evaluation — 2026-10-17 21:40 IST
Shipped: whole-tournament ingestion (51 match graphs, 24 teams, 493 player profiles), `app/evals/expert.py` (4E.1),
`app/evals/absence.py` (4E.2), `app/evals/xg.py` (4E.3), `scripts/run_evals.py` -> eval/summary.json + charts
(expert_agreement, absence, c_vs_xg, ga_vs_greedy, score_ablation_*), `tests/test_leakage.py` (2 passed).
Results (honest, with baselines): 4E.1 demo teams 5 of 14 vs 28% chance (perm p=0.36), most-touches 1 of 14; all 24
teams 26 of 102 vs 29% chance (at chance), most-touches 13 of 102; Spearman +0.05. 4E.2 all absences n=69 r=-0.02,
MAE 28.6 vs always-zero 27.9 (fails); full-match absences n=22 r=+0.28, MAE 14.4 vs 17.8 (beats zero); substitution
windows fail (single 15-min slices, observed SD 40). 4E.3 C_raw vs xG Pearson +0.40, Spearman +0.44, n=102.
Acceptance: leakage test green; charts written and embedded in README beside baselines; numbers served by
eval_summary()/GET /api/eval (PASS). Claims calibrated per 4E.4; the failed tests are reported as failed.
Also: README.md, VIDEO.md (shot list), docs/ (charts + StatsBomb logo). Reverse matchup Spain v England: champion
-30.5% +-20.9 (Cucurella marks Walker at k=0.40). Frontend (Phase 7) in progress via subagent.
