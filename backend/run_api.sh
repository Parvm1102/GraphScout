#!/usr/bin/env bash
# Graph Scout backend: uvicorn (CORS open, no auth). Local: .venv on :8000. Render: system python on $PORT.
cd "$(dirname "$0")"
PY=.venv/bin/uvicorn; [ -x "$PY" ] || PY=uvicorn
exec "$PY" app.api.main:app --host 0.0.0.0 --port "${PORT:-8000}" "$@"
