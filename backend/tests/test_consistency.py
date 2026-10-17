"""Required consistency test (brief 4.2): for 5 random plans, Tier B dC must match Tier A within 0.5.
Tier A is truth; the two share one reweighting rule so the gap should be exactly 0."""
import random

import pytest

from app.graph import db
from app.metrics import formulas as F
from app.metrics.scores import team_match_ids
from app.sim.tier_a import simulate_match
from app.sim.tier_b import FastEngine

pytestmark = pytest.mark.skipif(
    not any(n.startswith("match_") for n in db.list_graphs()), reason="no ingested match graphs")


def _random_plan(rng: random.Random, el) -> list[dict]:
    ids = el.player_ids()
    pairs = list({(int(s), int(d)) for s, d in zip(el.src.tolist(), el.dst.tolist())})
    plan, used = [], set()
    for _ in range(rng.randint(1, 4)):
        if rng.random() < 0.6:
            y = rng.choice(ids)
            if y in used:
                continue
            used.add(y)
            plan.append({"type": rng.choice(["suppress", "suppress", "delete"]), "target_player": y,
                         "k": round(rng.uniform(F.K_MIN, F.K_MAX), F.K_DECIMALS)})
        else:
            s, d = rng.choice(pairs)
            plan.append({"type": "cut_lane", "edge": {"src": s, "dst": d}, "k": F.K_LANE})
    return plan


def test_tier_b_matches_tier_a():
    team = "Spain"
    mids = team_match_ids(team)[:3]
    assert mids, "Spain matches must be ingested"
    eng = FastEngine(team, mids)
    rng = random.Random(42)
    checked = 0
    for n in range(5):
        plan = _random_plan(rng, eng.base[mids[0]])
        b = eng.delta_c(plan)
        for mid in mids:
            a = simulate_match(mid, team, plan)
            b_mid = next(p["dC_pct"] for p in b["per_match"] if p["match_id"] == mid)
            assert abs(a["dC_pct"] - b_mid) < 0.5, (plan, a["dC_pct"], b_mid)
            assert a["dC_pct"] == pytest.approx(b_mid, abs=1e-6)   # by construction: exact
            checked += 1
    assert checked == 15
    assert not [g for g in db.list_graphs() if g.startswith("sim_")], "clone leaked"
