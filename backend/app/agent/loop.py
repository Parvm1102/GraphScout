"""The agent loop (Phase 5): Anthropic claude-sonnet-5-5 via the official SDK, manual streaming tool-use loop,
hard budget of LLM calls per question, SSE-shaped events, final fenced-JSON claims block parsed strictly.

User-directed deviation from the brief's Gemma-only policy. The LLM only plans, picks tools and writes prose;
every number comes from tool outputs (FalkorDB queries, simulations, evals)."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import AsyncIterator

import anthropic

from app import config
from app.agent import tools as T

log = logging.getLogger(__name__)

SYSTEM = """You are Graph Scout, an opposition-preparation analyst for a football coaching staff.
Data: StatsBomb open event data for one tournament, stored as one pass-network graph per match in FalkorDB.
Tools compute everything (Cypher reads, native graph algorithms, GRAPH.COPY counterfactual simulations, a genetic
optimizer, held-out evaluations). You plan the analysis, call tools, and write prose.

Non-negotiable no-fiction contract:
- Every number you state must come from a tool result in this conversation. Never invent passes, positions,
  formations, scorelines, or percentages. If a tool did not return it, do not say it.
- Label modeled results (simulations, optimizer output) as modeled and empirical results (real absence windows,
  evaluation data) as empirical. Say "modeled" or "empirical" explicitly when you quote a ΔC.
- Print counts beside percentages ("5 of 14", never a bare 36%) and quote a baseline beside every evaluation metric.
- Allowed claims: "agrees with elite targeting decisions out-of-sample", "predicts the structural impact of real
  absences", "objective tracks xG". Forbidden: "better than experts", "predicts match outcomes", "will win".
- ΔC is the change in the team circulation score C (max-flow, progressive volume, path diversity); negative is damage.

Working style: you have at most {budget} model calls per question, so plan tool use efficiently (2-6 tool calls is
typical). For "how do we beat X" questions: team_profile(X) then optimize(our, X) and, if useful, simulate or
empirical_window for the key target. For "what if we mark Y" questions: simulate with a suppress intervention
(presser = our player if named). Our team is {our}; their team is {their} unless the user says otherwise.
Write for a coach: concise, concrete, names and numbers, 120-250 words, no headers, no emoji.

Response contract: after the prose, end with exactly one fenced JSON block:
```json
{{"claims": [{{"text": "...", "refs": ["player:6765", "edge:3233->5203", "match:3942819"], "basis": "modeled", "value": "-16.1%"}}], "plan_id": "plan_..."}}
```
Each claim is one sentence you made above, its refs are copied from tool results (player:<id>, edge:<src>-><dst>,
match:<id>), basis is "modeled" or "empirical", value is the headline number as text. Include plan_id only if a tool
returned one. 2-6 claims. Nothing after the JSON block."""

JSON_BLOCK = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)


def _client() -> anthropic.AsyncAnthropic:
    # Re-read .env on every question so a corrected ANTHROPIC_API_KEY works without restarting the API.
    from dotenv import load_dotenv
    load_dotenv(config.REPO_DIR / ".env", override=True)
    load_dotenv(config.BACKEND_DIR / ".env", override=True)
    return anthropic.AsyncAnthropic()


def system_prompt() -> list[dict]:
    try:
        t = T._tournament()
        our, their = t["our"], t["their"]
    except Exception:
        our, their = "England", "Spain"
    text = SYSTEM.format(budget=config.LLM_BUDGET, our=our, their=their)
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def parse_claims(text: str, allowed_refs: set[str]) -> dict:
    blocks = JSON_BLOCK.findall(text)
    if not blocks:
        return {"claims": [], "plan_id": None, "parse_error": "no fenced json block"}
    try:
        obj = json.loads(blocks[-1])
    except json.JSONDecodeError as exc:
        return {"claims": [], "plan_id": None, "parse_error": f"invalid json: {exc}"}
    claims = []
    for c in obj.get("claims", []) if isinstance(obj, dict) else []:
        if not isinstance(c, dict) or "text" not in c:
            continue
        refs = [r for r in c.get("refs", []) if isinstance(r, str) and (r in allowed_refs)]
        dropped = [r for r in c.get("refs", []) if isinstance(r, str) and r not in allowed_refs]
        claims.append({"text": str(c["text"]), "refs": refs, "dropped_refs": dropped,
                       "basis": c.get("basis") if c.get("basis") in ("modeled", "empirical") else "modeled",
                       "value": str(c.get("value", ""))})
    return {"claims": claims, "plan_id": obj.get("plan_id") if isinstance(obj, dict) else None, "parse_error": None}


class BudgetExceeded(RuntimeError):
    pass


async def run_agent(question: str, history: list[dict] | None = None) -> AsyncIterator[dict]:
    """Yields SSE-shaped events: text, tool_call, tool_result, claims, done, error."""
    client = _client()
    messages = list(history or []) + [{"role": "user", "content": question}]
    allowed_refs: set[str] = set()
    plan_ids: list[str] = []
    calls = 0
    full_text = ""
    use_fallbacks = config.ANTHROPIC_FALLBACKS == "default"
    while True:
        if calls >= config.LLM_BUDGET:
            yield {"type": "error", "message": f"LLM budget of {config.LLM_BUDGET} calls exhausted", "calls": calls}
            raise BudgetExceeded(f"budget {config.LLM_BUDGET} exhausted")
        calls += 1
        kwargs = dict(model=config.LLM_MODEL, max_tokens=8192, system=system_prompt(), tools=T.TOOLS, messages=messages,
                      output_config={"effort": config.AGENT_EFFORT})
        try:
            if use_fallbacks:
                cm = client.beta.messages.stream(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
            else:
                cm = client.messages.stream(**kwargs)
            async with cm as stream:
                async for event in stream:
                    if event.type == "text":
                        full_text += event.text
                        yield {"type": "text", "delta": event.text, "call": calls}
                final = await stream.get_final_message()
        except anthropic.BadRequestError as exc:
            if use_fallbacks:
                log.warning("fallbacks rejected (%s); retrying without", exc)
                use_fallbacks = False
                calls -= 1
                continue
            yield {"type": "error", "message": f"API error: {exc.message}", "calls": calls}
            return
        except anthropic.APIError as exc:
            yield {"type": "error", "message": f"API error: {getattr(exc, 'message', str(exc))}", "calls": calls}
            return

        messages.append({"role": "assistant", "content": final.content})
        if final.stop_reason == "refusal":
            yield {"type": "error", "message": "the model declined this request", "calls": calls}
            return
        tool_uses = [b for b in final.content if b.type == "tool_use"]
        if final.stop_reason != "tool_use" or not tool_uses:
            break
        results = []
        for tu in tool_uses:
            args = tu.input if isinstance(tu.input, dict) else {}
            yield {"type": "tool_call", "name": tu.name, "args": args, "call": calls}
            res = await asyncio.to_thread(T.dispatch, tu.name, args)
            refs = [r for r in res.get("refs", []) if isinstance(r, str)]
            allowed_refs.update(refs)
            if res.get("plan_id"):
                plan_ids.append(res["plan_id"])
            summary = {k: v for k, v in res.items() if k in ("aggregate", "champion", "error", "n", "hits", "sentence", "dC_pct", "available", "team", "player", "name")}
            yield {"type": "tool_result", "name": tu.name, "refs": refs[:40], "summary": summary, "is_error": "error" in res}
            results.append({"type": "tool_result", "tool_use_id": tu.id, "content": T.serialize(res), "is_error": "error" in res})
        messages.append({"role": "user", "content": results})

    claims = parse_claims(full_text, allowed_refs)
    if claims["plan_id"] is None and plan_ids:
        claims["plan_id"] = plan_ids[-1]
    yield {"type": "claims", **claims, "calls": calls}
    yield {"type": "done", "calls": calls, "budget": config.LLM_BUDGET}
