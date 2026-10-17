"""CLI driver: python scripts/optimize.py [our] [their] [ga|greedy]"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.optim.run import optimize_stream  # noqa: E402

our = sys.argv[1] if len(sys.argv) > 1 else "England"
their = sys.argv[2] if len(sys.argv) > 2 else "Spain"
method = sys.argv[3] if len(sys.argv) > 3 else "ga"
for ev in optimize_stream(our, their, method):
    t = ev["type"]
    if t == "start":
        print(f"[start] {ev['our']} v {ev['their']} over {len(ev['match_ids'])} matches; pressers={[p['name'] for p in ev['pressers']]}")
        print(f"        targets={[t['name'] for t in ev['targets']]} lanes={[l['src_name']+'->'+l['dst_name'] for l in ev['lanes']]}")
    elif t == "greedy":
        print(f"[greedy] dC_mean={ev['dC_mean']:+.2f} +-{ev['dC_std']:.2f} fitness={ev['fitness']} knee={ev['knee']} evals={ev['evaluations']}")
        for s in ev["steps"]:
            g = s["gene"]; tgt = g["target"].get("name") or f"{g['target']['src_name']}->{g['target']['dst_name']}"
            print(f"   step: {g['presser']['name']} {g['action']} {tgt} (k={g['k']}) total={s['dC_mean']:+.2f} marginal={s['marginal']:+.2f}")
    elif t == "generation":
        if ev["gen"] % 4 == 0 or ev["gen"] == 20:
            print(f"[gen {ev['gen']:2d}] best_fitness={ev['best_fitness']:.2f} best_dC={ev['best_dC_mean']:+.2f} committed={ev['best_committed']} mean_fit={ev['mean_fitness']:.2f} evals={ev['evaluations']} t={ev['seconds']}s")
    elif t == "final":
        c = ev["champion"]
        print(f"[final] champion fitness={c['fitness']} dC_mean={c['dC_mean']:+.2f} +-{c['dC_std']:.2f} (tierB {c['tier_b_dC_mean']:+.2f}) committed={c['committed']} plan_id={ev['plan_id']} {ev['seconds']}s evals={ev['evaluations']}")
        for g in c["genes"]:
            tgt = g["target"].get("name") or f"{g['target']['src_name']}->{g['target']['dst_name']}"
            print(f"   {g['presser']['name']} {g['action']} {tgt} k={g['k']}")
        print(f"   greedy equal budget dC={ev['greedy']['equal_budget']['dC_mean']:+.2f}; greedy full dC={ev['greedy']['dC_mean']:+.2f}")
        print("   ablation:", [(a['cell'], a['marginal_dC']) for a in ev["ablation"]])
        print("   comparison:", [(r['budget'], r.get('greedy_dC'), r.get('ga_dC')) for r in ev["comparison"]])
