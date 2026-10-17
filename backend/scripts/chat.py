"""Phase 5 acceptance: python scripts/chat.py "how do we beat Spain?" """
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.agent.loop import run_agent  # noqa: E402


async def main() -> None:
    q = sys.argv[1] if len(sys.argv) > 1 else "How do we beat Spain?"
    async for ev in run_agent(q):
        t = ev["type"]
        if t == "text":
            print(ev["delta"], end="", flush=True)
        elif t == "tool_call":
            print(f"\n[tool_call #{ev['call']}] {ev['name']} {json.dumps(ev['args'])}", flush=True)
        elif t == "tool_result":
            print(f"[tool_result] {ev['name']} refs={len(ev['refs'])} err={ev['is_error']} {json.dumps(ev['summary'])[:300]}", flush=True)
        elif t == "claims":
            print(f"\n[claims] parse_error={ev['parse_error']} plan_id={ev['plan_id']}")
            for c in ev["claims"]:
                print(f"  - ({c['basis']}, {c['value']}) {c['text'][:110]} refs={c['refs']} dropped={c['dropped_refs']}")
        else:
            print(f"\n[{t}] {ev}")


asyncio.run(main())
