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
