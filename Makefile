# Graph Scout — one-command local run helpers (see README "Run it locally")
PY := backend/.venv/bin/python

.PHONY: db venv ingest profiles test evals api web smoke

db:            ## start FalkorDB (Redis :6379, Browser :3000)
	docker start falkordb 2>/dev/null || docker run -d --name falkordb -p 6379:6379 -p 3000:3000 -v falkordb_data:/var/lib/falkordb/data falkordb/falkordb:latest

venv:          ## python 3.12 venv via uv + deps
	cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python falkordb pandas numpy networkx fastapi "uvicorn[standard]" sse-starlette anthropic python-dotenv pytest matplotlib scipy requests

smoke:         ## Phase 0 acceptance
	$(PY) backend/scripts/smoke.py

ingest:        ## all 51 Euro 2024 matches -> FalkorDB, then tournament profiles
	$(PY) backend/scripts/ingest.py --whole-tournament
	cd backend && .venv/bin/python -c "from app.metrics import scores as S; S.build_profiles()"

test:          ## formulas, Tier A/B consistency, leakage guard
	cd backend && .venv/bin/python -m pytest -q

evals:         ## score ablation + 4E.1/4E.2/4E.3 charts + eval/summary.json
	cd backend && .venv/bin/python scripts/ablation.py in_sample && .venv/bin/python scripts/ablation.py held_out && .venv/bin/python scripts/run_evals.py

api:           ## FastAPI on :8000
	backend/run_api.sh

web:           ## Vite dev server on :5173 (proxies /api -> :8000)
	cd frontend && npm install && npm run dev -- --port 5173
