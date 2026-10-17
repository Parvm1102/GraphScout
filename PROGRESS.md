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
