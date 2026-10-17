"""GA optimizer (brief 4.4): fixed-length 4-gene chromosome over the candidate pools, Tier B fitness,
uniform crossover, 4-way mutation, tournament selection k=3, elitism 2, greedy-seeded population."""
from __future__ import annotations

import random
from typing import Iterator

from app.metrics import formulas as F
from app.optim.candidates import Gene, Pools
from app.optim.greedy import fitness_of
from app.sim.tier_b import FastEngine

Chromosome = list  # list[Gene | None], length N_GENES


def repair(ch: Chromosome) -> Chromosome:
    """Drop later genes that reuse a presser or a target (keep the earlier)."""
    seen_p, seen_t, out = set(), set(), []
    for g in ch:
        if g is None:
            out.append(None); continue
        x, a, t = g
        if x in seen_p or (a, t) in seen_t:
            out.append(None); continue
        seen_p.add(x); seen_t.add((a, t)); out.append(g)
    return out


def canonical(ch: Chromosome) -> tuple:
    return tuple(sorted((str(g) for g in ch if g is not None)))


def evaluate(engine: FastEngine, pools: Pools, ch: Chromosome) -> dict:
    genes = [g for g in ch if g is not None]
    res = engine.delta_c(pools.genes_to_plan(genes)) if genes else {"mean": 0.0, "std": 0.0, "per_match": []}
    return {"fitness": fitness_of(res["mean"], len(genes)), "dC_mean": res["mean"], "dC_std": res["std"], "committed": len(genes)}


def random_gene(rng: random.Random, pools: Pools) -> Gene:
    x = rng.choice(pools.presser_ids())
    a, t = rng.choice(pools.target_keys())
    return (x, a, t)


def mutate(rng: random.Random, ch: Chromosome, pools: Pools, pm: float = F.GA_MUTATION_P) -> Chromosome:
    out = list(ch)
    for i, g in enumerate(out):
        if rng.random() >= pm:
            continue
        if g is None:
            out[i] = random_gene(rng, pools)                              # fill an empty slot
            continue
        op = rng.choice(["swap_presser", "retarget", "empty"])
        x, a, t = g
        if op == "swap_presser":
            out[i] = (rng.choice(pools.presser_ids()), a, t)
        elif op == "retarget":
            na, nt = rng.choice(pools.target_keys())
            out[i] = (x, na, nt)
        else:
            out[i] = None
    return repair(out)


def crossover(rng: random.Random, a: Chromosome, b: Chromosome, pc: float = F.GA_CROSSOVER_P) -> tuple[Chromosome, Chromosome]:
    c1, c2 = [], []
    for ga, gb in zip(a, b):
        if rng.random() < pc:
            c1.append(gb); c2.append(ga)
        else:
            c1.append(ga); c2.append(gb)
    return repair(c1), repair(c2)


def tournament(rng: random.Random, pop: list[tuple[Chromosome, dict]], k: int = F.GA_TOURNAMENT) -> Chromosome:
    return max(rng.sample(pop, k), key=lambda p: p[1]["fitness"])[0]


def evolve(engine: FastEngine, pools: Pools, seed_plans: list[list[Gene]], seed: int = 42,
           pop_size: int = F.GA_POP, gens: int = F.GA_GENS, elite: int = F.GA_ELITE,
           n_genes: int = F.MAX_COMMITMENTS) -> Iterator[dict]:
    """Yields one event per generation; the last yielded event has type 'done' with the champion."""
    rng = random.Random(seed)

    def pad(genes: list[Gene]) -> Chromosome:
        ch = list(genes[:n_genes]) + [None] * (n_genes - len(genes[:n_genes]))
        return repair(ch)

    population: list[Chromosome] = [pad(p) for p in seed_plans]
    while len(population) < pop_size:
        population.append(repair([random_gene(rng, pools) if rng.random() < 0.7 else None for _ in range(n_genes)]))
    scored = [(ch, evaluate(engine, pools, ch)) for ch in population]
    best_by_budget: dict[int, tuple[Chromosome, dict]] = {}
    history: list[dict] = []
    champion: tuple[Chromosome, dict] | None = None

    for gen in range(gens + 1):
        scored.sort(key=lambda p: -p[1]["fitness"])
        for ch, ev in scored:
            b = ev["committed"]
            if b and (b not in best_by_budget or ev["dC_mean"] < best_by_budget[b][1]["dC_mean"]):
                best_by_budget[b] = (ch, ev)
        if champion is None or scored[0][1]["fitness"] > champion[1]["fitness"]:
            champion = (list(scored[0][0]), dict(scored[0][1]))
        ev = {"type": "generation", "gen": gen, "best_fitness": scored[0][1]["fitness"],
              "best_dC_mean": scored[0][1]["dC_mean"], "best_dC_std": scored[0][1]["dC_std"],
              "best_committed": scored[0][1]["committed"],
              "mean_fitness": round(sum(p[1]["fitness"] for p in scored) / len(scored), 4),
              "champion_genes": [pools.describe_gene(g) for g in scored[0][0] if g is not None],
              "evaluations": engine.evaluations}
        history.append(ev)
        yield ev
        if gen == gens:
            break
        next_pop: list[Chromosome] = [list(p[0]) for p in scored[:elite]]
        while len(next_pop) < pop_size:
            p1, p2 = tournament(rng, scored), tournament(rng, scored)
            c1, c2 = crossover(rng, p1, p2)
            next_pop.append(mutate(rng, c1, pools))
            if len(next_pop) < pop_size:
                next_pop.append(mutate(rng, c2, pools))
        scored = [(ch, evaluate(engine, pools, ch)) for ch in next_pop]

    ch, ev = champion
    yield {"type": "done", "champion": {"genes": [g for g in ch if g is not None], **ev},
           "best_by_budget": {b: {"genes": [g for g in c if g is not None], **e} for b, (c, e) in sorted(best_by_budget.items())},
           "history": history, "evaluations": engine.evaluations, "seed": seed}
