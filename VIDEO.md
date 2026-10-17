# Demo video — shot list (2–3 min, screen recording)

Record at 1440x900, dark app, cursor visible. Narration in brackets. Keep every number on screen traceable
to a tool output or chart (no-fiction contract). Use the running app at http://localhost:5173 with the
backend on :8000 and FalkorDB Browser on :3000.

| t | scene | on screen | say |
|---|---|---|---|
| 0:00–0:10 | problem | Raw StatsBomb event JSON scrolling (data/events/3943043.json) | "A match is 3,300 events. An opposition analyst needs one answer: who do we take out, and what happens if we do?" |
| 0:10–0:35 | pitch + windows | App, Spain selected, final 3943043. Toggle window chips 0-15 / 75-90+; network re-queries and morphs | "Every match is a pass-network graph in FalkorDB — 52 graphs in one database. Each window is a Cypher read; node size is the composite score, edge width is completed passes." |
| 0:35–1:10 | simulate: mark Rodri | Simulate panel: target Rodri, presser Rice → run. Rodri fades to 30%, amber leash from Rice, rerouted edges spring, ΔC ticker counts down (modeled). Empirical badge: Spain's real minutes without Rodri (ΔC −7.6%, empirical) | "Simulation is GRAPH.COPY: clone the match graph, reweight the edges into Rodri by a matchup-derived k, reroute observed passes, recompute circulation, delete the clone. Modeled: −1.4%. Empirical, from the minutes Spain actually played without him: −7.6%. Both labelled." |
| 1:10–1:35 | greedy heatmap + curve | Optimize tab, "Play greedy": pressers × targets heatmap re-cools between picks ①②③④; commitment curve with the knee | "Greedy is the baseline: best cell, lock it, re-simulate the rest — interactions matter." |
| 1:35–2:15 | evolution live | Run GA: fitness line climbing over 20 generations, champion genes morphing on the mini-pitch, closing frame: evolved vs greedy bars at equal budget + gene ablation; "Tier A verified" | "The genetic optimizer evolves 4-gene plans over the simulation-evaluated search space: 600 evaluations in two seconds in memory, then the champion is re-verified through FalkorDB clones. Here evolution confirms greedy's plan: Rice cuts Cucurella→Williams, Bellingham marks Olmo, Foden cuts Fabián→Williams, Saka marks Carvajal: −16.1% circulation over 7 Spain matches." Show the lineage graph in FalkorDB Browser (MATCH (p:Plan)-[:EVOLVED_FROM]->(q) RETURN p,q). |
| 2:15–2:45 | agent | Agent tab: "How do we beat Spain?" Tool rows (amber) appear, prose streams, claims cards; hover a claim → the pitch lights up | "The agent plans, calls the graph tools, and writes prose; every number is a tool output and every claim carries graph references. Fifteen-call hard budget." (Requires a valid ANTHROPIC_API_KEY in .env.) |
| 2:45–3:00 | evidence | Evidence tab: expert-agreement bars with the sentence "5 of 14 held-out games vs 28% chance"; score-ablation chart; C-vs-xG r=0.40, n=102 | "Held-out tests with baselines beside every number — including the ones we did not pass." StatsBomb credit in the footer. |

Fallback if the key is still invalid at recording time: skip the agent scene or show the tool-call rows from
`python backend/scripts/chat.py` once a key is available.
