"""FastAPI (Phase 6): CORS wide open, no auth, port 8000. All routes under /api (the Vite dev server proxies /api)."""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any, AsyncIterator, Callable, Iterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app import config
from app.agent import loop as AGENT
from app.agent import tools as T
from app.graph import db
from app.metrics import formulas as F
from app.metrics import scores as S
from app.metrics.circulation import components
from app.optim import run as OPT
from app.sim import engine as SIM
from app.sim.tier_b import load_edge_list

log = logging.getLogger("api")
app = FastAPI(title="Graph Scout API", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@app.on_event("startup")
def _startup() -> None:
    try:
        n = db.sweep_sims()
        log.info("startup: swept %d stale sim_* graphs", n)
    except Exception as exc:
        log.warning("startup sweep failed: %s", exc)


async def _thread_sse(make_gen: Callable[[], Iterator[dict]]) -> AsyncIterator[dict]:
    """Run a blocking generator in a worker thread and relay its events as SSE."""
    q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def worker() -> None:
        try:
            for ev in make_gen():
                loop.call_soon_threadsafe(q.put_nowait, ev)
        except Exception as exc:
            log.exception("stream worker failed")
            loop.call_soon_threadsafe(q.put_nowait, {"type": "error", "message": f"{type(exc).__name__}: {exc}"})
        finally:
            loop.call_soon_threadsafe(q.put_nowait, None)

    threading.Thread(target=worker, daemon=True).start()
    while True:
        ev = await q.get()
        if ev is None:
            break
        yield {"event": ev.get("type", "message"), "data": json.dumps(ev, default=str)}


# ------------------------------------------------------------------------------------- models

class Intervention(BaseModel):
    type: str
    target_player: int | None = None
    edge: dict | None = None
    presser: int | None = None
    k_override: float | None = None


class SimulateRequest(BaseModel):
    team: str
    interventions: list[Intervention]
    match_ids: list[int] | None = None
    windows: list[str] | None = None
    with_empirical: bool = True


class OptimizeRequest(BaseModel):
    our: str
    their: str
    method: str = "ga"
    max_commitments: int = Field(default=F.MAX_COMMITMENTS, ge=1, le=6)
    force: list[str] | None = None
    forbid: list[str] | None = None
    seed: int = config.SEED
    windows: list[str] | None = None
    gens: int = F.GA_GENS
    pop: int = F.GA_POP


class ChatRequest(BaseModel):
    question: str
    history: list[dict] | None = None


# ------------------------------------------------------------------------------------- routes

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "graphs": len(db.list_graphs()), "model": config.LLM_MODEL, "k_mode": F.K_MODE}


@app.get("/api/matches")
def matches() -> dict:
    t = T._tournament()
    ms = S.catalog_matches()
    return {"our": t["our"], "their": t["their"], "competition": t,
            "matches": [{"id": int(m["id"]), "date": m.get("date"), "home": m.get("home"), "away": m.get("away"), "score": m.get("score"),
                         "stage": m.get("stage"), "end_minute": m.get("end_minute"), "teams": m["teams"]} for m in ms],
            "teams": S.teams_in_catalog(), "windows": F.WINDOWS}


@app.get("/api/network/{match_id}")
def network(match_id: int, team: str, windows: str | None = Query(default=None, description="comma-separated window ids")) -> dict:
    wins = [w for w in (windows or "").split(",") if w] or list(F.WINDOWS)
    bad = [w for w in wins if w not in F.WINDOWS]
    if bad:
        raise HTTPException(400, f"unknown windows {bad}")
    if not db.graph_exists(f"match_{match_id}"):
        raise HTTPException(404, f"match {match_id} not ingested")
    g = db.match_graph(match_id)
    players = db.pull_players(g, team)
    if not players:
        raise HTTPException(404, f"team {team!r} not in match {match_id}")
    scores = {r["id"]: r for r in S.player_scores(team)}
    el = load_edge_list(match_id, team, wins, g)
    comp = components(el)
    edges = db.pull_network(g, team, wins)
    keep = ["id", "name", "jersey", "position", "team", "avg_x", "avg_y", "minutes", "touches", "pressures", "regains", "press_resist",
            "pr_share", "bt_share", "prog_share", "prog_made", "prog_recv"]
    plist = []
    for p in players:
        d = {k: p.get(k) for k in keep}
        sc = scores.get(p["id"], {})
        d["s_p_mean"] = sc.get("s_p_mean"); d["s_p_std"] = sc.get("s_p_std"); d["rank"] = sc.get("rank")
        plist.append(d)
    return {"match_id": match_id, "team": team, "windows": wins, "players": plist, "edges": edges,
            "components": comp.as_dict(), "C": 100.0, "totals": el.totals()}


@app.get("/api/scores/{team}")
def scores(team: str, w_pr: float | None = None, w_bt: float | None = None, w_prog: float | None = None, w_press: float | None = None) -> dict:
    weights = {k: v for k, v in (("pr", w_pr), ("bt", w_bt), ("prog", w_prog), ("press_resist", w_press)) if v is not None}
    rows = S.player_scores(team, weights or None)
    if not rows:
        raise HTTPException(404, f"no scores for team {team!r}")
    return {"team": team, "weights": {**F.W_S, **weights}, "players": rows}


@app.get("/api/profile/{team}")
def profile(team: str) -> dict:
    return T.team_profile(team)


@app.get("/api/player/{player_id}")
def player(player_id: int, team: str | None = None) -> dict:
    inf = T.decompose_influence(player_id)
    if "error" in inf:
        raise HTTPException(404, inf["error"])
    out = {"influence": inf, "pressure": T.pressure_profile(player_id)}
    out["empirical"] = T.empirical_window(team or inf["team"], player_id)
    return out


@app.post("/api/simulate")
def simulate(req: SimulateRequest) -> dict:
    ivs = [iv.model_dump(exclude_none=True) for iv in req.interventions]
    try:
        return SIM.simulate(req.team, ivs, req.match_ids, req.windows, with_empirical=req.with_empirical)
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/optimize")
async def optimize(req: OptimizeRequest) -> EventSourceResponse:
    def make() -> Iterator[dict]:
        return OPT.optimize_stream(our=req.our, their=req.their, method=req.method, max_commitments=req.max_commitments,
                                   force=req.force, forbid=req.forbid, seed=req.seed, windows=req.windows, gens=req.gens, pop=req.pop)
    return EventSourceResponse(_thread_sse(make), headers=SSE_HEADERS)


@app.get("/api/optimize/last")
def optimize_last(our: str, their: str, method: str = "ga") -> dict:
    final = OPT.LAST.get(f"{our}|{their}|{method}")
    if final is None:
        raise HTTPException(404, "no optimizer run cached for this matchup; POST /api/optimize first")
    return final


@app.get("/api/ablation")
def ablation(our: str | None = None, their: str | None = None) -> dict:
    out: dict[str, Any] = {}
    for variant in ("in_sample", "held_out"):
        p = config.EVAL_DIR / f"score_ablation_{variant}.json"
        if p.exists():
            out[f"score_ablation_{variant}"] = json.loads(p.read_text())
    if our and their:
        final = OPT.LAST.get(f"{our}|{their}|ga") or OPT.LAST.get(f"{our}|{their}|greedy")
        if final:
            out["gene_ablation"] = final["ablation"]; out["comparison"] = final["comparison"]; out["run_id"] = final["run_id"]
    return out


@app.get("/api/eval")
def eval_results() -> dict:
    return T.eval_summary()


@app.post("/api/chat")
async def chat(req: ChatRequest) -> EventSourceResponse:
    async def gen() -> AsyncIterator[dict]:
        try:
            async for ev in AGENT.run_agent(req.question, req.history):
                if ev["type"] == "error":
                    log.warning("chat error event: %s", ev.get("message"))
                yield {"event": ev["type"], "data": json.dumps(ev, default=str)}
        except AGENT.BudgetExceeded as exc:
            yield {"event": "done", "data": json.dumps({"type": "done", "aborted": True, "message": str(exc)})}
        except Exception as exc:
            log.exception("chat failed")
            yield {"event": "error", "data": json.dumps({"type": "error", "message": f"{type(exc).__name__}: {exc}"})}
    return EventSourceResponse(gen(), headers=SSE_HEADERS)
