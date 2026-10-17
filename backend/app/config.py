"""Paths, environment and constants shared by every backend module."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
load_dotenv(REPO_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")

# Data
OPEN_DATA_DIR = Path(os.getenv("OPEN_DATA_DIR", REPO_DIR / "open-data" / "data"))
DATA_CACHE = Path(os.getenv("DATA_CACHE", BACKEND_DIR / "data_cache"))
RAW_BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
EVAL_DIR = BACKEND_DIR / "eval"

# FalkorDB — local Docker by default; for FalkorDB Cloud set FALKOR_URL (falkor[s]://user:pass@host:port or
# redis[s]://...) or the individual FALKOR_HOST/PORT/USERNAME/PASSWORD/SSL variables.
FALKOR_URL = os.getenv("FALKOR_URL", "").strip() or None
FALKOR_HOST = os.getenv("FALKOR_HOST", "localhost")
FALKOR_PORT = int(os.getenv("FALKOR_PORT", "6379"))
FALKOR_USERNAME = os.getenv("FALKOR_USERNAME") or None
FALKOR_PASSWORD = os.getenv("FALKOR_PASSWORD") or None
FALKOR_SSL = os.getenv("FALKOR_SSL", "false").lower() in ("1", "true", "yes")
CATALOG = "catalog"

# LLM (user-directed deviation from the brief: Anthropic, not Gemma)
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-5-5")
LLM_BUDGET = int(os.getenv("LLM_BUDGET", "15"))
AGENT_EFFORT = os.getenv("AGENT_EFFORT", "medium")
ANTHROPIC_FALLBACKS = os.getenv("ANTHROPIC_FALLBACKS", "default")  # "default" | "off"

# Demo matchups: (competition_id, season_id, our team, their team)
PRIMARY = (55, 282, "England", "Spain")      # UEFA Euro 2024
FALLBACK = (43, 106, "France", "Argentina")  # FIFA World Cup 2022

SEED = 42
