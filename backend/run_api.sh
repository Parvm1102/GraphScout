#!/usr/bin/env bash
# Graph Scout backend: uvicorn on :8000 (CORS open, no auth)
cd "$(dirname "$0")"
exec .venv/bin/uvicorn app.api.main:app --host 0.0.0.0 --port 8000 "$@"
