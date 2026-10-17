// Typed fetchers for the Graph Scout API (served under /api, proxied by Vite in dev).
// In production set VITE_API_BASE (e.g. https://graph-scout-api.onrender.com) so the static site calls the
// backend directly (CORS is open there); empty in dev, where Vite proxies /api.
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '')

export interface MatchTeam { team: string; xg: number; goals: number; home: boolean }
export interface Match {
  id: number; date: string; home: string; away: string; score: string; stage: string
  end_minute: number; teams: MatchTeam[]
}
export interface MatchesResponse {
  our: string; their: string; matches: Match[]; teams: string[]; windows: string[]
}

export interface NetPlayer {
  id: number; name: string; jersey: number; position: string; team?: string
  avg_x: number; avg_y: number; minutes: number; touches: number; pressures: number; regains: number
  press_resist: number; pr_share: number; bt_share: number; prog_share: number
  s_p_mean: number; s_p_std: number; rank: number
}
export interface Edge { src: number; dst: number; count: number; completed: number; progressive: number; est: boolean }
export interface NetworkResponse {
  match_id: number; team: string; windows: string[]; players: NetPlayer[]; edges: Edge[]
  components: { M: number; V: number; D: number }; C: number
  totals: { count: number; completed: number; progressive: number }
}

export interface Weights { pr: number; bt: number; prog: number; press_resist: number }
export interface ScorePlayer {
  rank: number; id: number; name: string; position: string; n_matches: number; minutes: number
  s_p_mean: number; s_p_std: number; pr_share: number; bt_share: number; prog_share: number; press_resist: number
  z_pr: number; z_bt: number; z_prog: number; z_press_resist: number; avg_x: number; avg_y: number; jersey: number
  touches?: number; pressures?: number; regains?: number
}
export interface ScoresResponse { team: string; weights: Weights; players: ScorePlayer[] }

export interface ProfileResponse {
  team: string; matches: number[]
  top_players_by_S_p: { id: number; name: string; position: string; s_p_mean: number; s_p_std: number; press_resist: number; minutes: number }[]
  top_pressers: { id: number; name: string; pressures: number; regain_rate: number }[]
  top_progressive_lanes: { src: number; dst: number; src_name: string; dst_name: string; progressive: number; completed: number }[]
  refs: string[]
}

export interface PlayerResponse {
  influence: {
    name: string; team: string; position: string; s_p_mean: number; s_p_std: number
    shares_mean: { pagerank: number; betweenness: number; progressive_involvement: number }
    top_in_lanes: { player: number; name: string; completed: number; progressive: number }[]
    top_out_lanes: { player: number; name: string; completed: number; progressive: number }[]
    refs?: string[]
  }
  pressure: {
    pressures: number; regains: number; regain_rate: number; press_resist: number
    pressing_zones_top: { zone: string; share: number }[]; receiving_zones_top: { zone: string; share: number }[]
  }
  empirical: EmpiricalResult
}

export interface EmpiricalResult {
  player?: number; available: boolean; dC_pct?: number; absent_minutes?: number
  comparable_minutes?: number; c_per_min_absent?: number; c_per_min_present?: number; basis: 'empirical'; refs?: string[]
}

export interface Intervention {
  type: 'suppress' | 'cut_lane' | 'delete'
  target_player?: number; edge?: { src: number; dst: number }; presser?: number; k_override?: number
}
export interface PlanItem {
  type: 'suppress' | 'cut_lane' | 'delete'; target_player?: number; edge?: { src: number; dst: number }
  presser?: number; k: number; k_source: string; k_detail?: Record<string, number | string>
}
export interface Inheritance { player: number; name: string; old_BT_share: number; new_BT_share: number; delta: number }
export interface Rerouted { src: number; dst: number; old: number; new: number; est: boolean }
export interface PerMatch {
  match_id: number; dC_pct: number; M_before: number; M_after: number; D_before: number; D_after: number
  V_before: number; V_after: number; inheritance: Inheritance[]; rerouted_edges: Rerouted[]
  network_after?: Edge[]; removed: number; redistributed: number; basis?: string
}
export interface SimulateResponse {
  team: string; plan: PlanItem[]; basis: 'modeled'; aggregate: { dC_mean: number; dC_std: number; n: number }
  per_match: PerMatch[]; empirical: EmpiricalResult[]; refs: string[]
}

// ---- optimizer -------------------------------------------------------------
export interface GenePresser { id: number; name: string }
export interface GeneMark { id: number; name: string }
export interface GeneCut { src: number; dst: number; src_name: string; dst_name: string }
export interface Gene { presser: GenePresser; action: 'mark' | 'cut'; target: GeneMark | GeneCut; k: number; refs: string[] }
export const isCut = (g: Gene): g is Gene & { target: GeneCut } => g.action === 'cut'

export interface OptStart {
  run_id: string; our: string; their: string; match_ids: number[]
  pressers: { id: number; name: string; position?: string; pressures: number; regain: number; press_volume: number }[]
  targets: { id: number; name: string; position?: string; s_p_mean: number; s_p_std?: number; press_resist: number }[]
  lanes: { src: number; dst: number; src_name: string; dst_name: string; progressive: number; completed?: number }[]
  kmat: { presser: number; target: number; k: number; overlap: number; regain: number; press_resist: number }[]
  max_commitments?: number
}
export interface GreedyStep { cell: string; gene: Gene; dC_mean: number; dC_std: number; marginal: number; fitness: number; forced?: boolean }
export interface MatrixCell { dC_mean: number; dC_std: number; marginal: number; k?: number; overlap?: number | null }
export interface GreedyMatrix { step: number; locked: string[]; cells: Record<string, MatrixCell> }
export interface OptGreedy {
  steps: GreedyStep[]; matrices: GreedyMatrix[]; knee: number; dC_mean: number; dC_std: number; fitness: number; committed?: number
}
export interface OptGeneration {
  gen: number; best_fitness: number; best_dC_mean: number; best_dC_std: number; best_committed: number
  mean_fitness: number; champion_genes: Gene[]; evaluations: number; seconds?: number
}
export interface OptFinal {
  start?: OptStart; greedy_event?: OptGreedy  // cached alongside the final payload by /api/optimize/last
  run_id: string; plan_id: string; our: string; their: string
  champion: {
    genes: Gene[]; cells: string[]; plan?: PlanItem[]; committed: number; fitness: number; dC_mean: number; dC_std: number
    tier_b_dC_mean: number; verified: { dC_mean: number; dC_std: number; per_match: PerMatch[]; basis: string; tier: string }
  }
  greedy: { genes: Gene[]; dC_mean: number; equal_budget: { genes: Gene[]; dC_mean: number; dC_std: number }; steps: GreedyStep[]; knee: number }
  ablation: { gene: Gene; cell: string; dC_without: number; marginal_dC: number }[]
  comparison: { budget: number; greedy_dC?: number; ga_dC?: number; ga_genes?: Gene[] }[]
  evolution: OptGeneration[]; evaluations: number; seconds: number; refs: string[]
}

// ---- evals -----------------------------------------------------------------
export interface AblationBlock {
  k: number; n: number; top_mean: number; top_std: number; median_mean: number; median_std: number
  top_more_damaging_in: number
  rows: { team: string; match_id: number; top: { id: number; name: string; dC: number }; median: { id: number; name: string; dC: number } }[]
}
export interface AblationResponse {
  score_ablation_in_sample: AblationBlock; score_ablation_held_out?: AblationBlock
  gene_ablation?: OptFinal['ablation']; comparison?: OptFinal['comparison']; run_id?: string
}

export interface ExpertAgreement {
  n: number; hits: number; hit_rate: number; chance_rate_analytic: number; chance_rate_permutation: number
  permutation_p_value: number; most_touches_hits: number; most_touches_rate: number; spearman_mean: number; sentence?: string
}
export interface ExpertFold { team: string; match_id: number; n: number; hit: boolean; spearman: number; chance: number; prediction: string; truth_rank: number; most_touches_hit: boolean }
export interface AbsenceBlock { n: number; available: boolean; pearson_r: number; pearson_p: number; mae: number; mae_always_zero: number; beats_zero_forecaster: boolean; observed_sd: number }
export interface EvalResponse {
  available?: boolean; note?: string
  expert_agreement_demo?: ExpertAgreement; expert_agreement_all?: ExpertAgreement | null
  expert_folds_demo?: ExpertFold[]
  c_vs_xg?: { n: number; pearson_r: number; pearson_p: number; spearman_r: number; spearman_p: number; points?: { match_id: number; team: string; C: number; xg: number }[] }
  absence_prediction?: (AbsenceBlock & { k?: number; subsets?: Record<string, AbsenceBlock>; note?: string; rows?: { team: string; match_id: number; player: number; name: string; predicted_dC: number; observed_dC: number; full_match_absence: boolean }[] }) | null
  score_ablation?: { in_sample: Omit<AblationBlock, 'rows'>; held_out?: Omit<AblationBlock, 'rows'> }
  evolved_vs_greedy?: { our?: string; their?: string; champion_dC: number; champion_committed: number; greedy_equal_budget_dC: number; comparison?: OptFinal['comparison']; gene_ablation?: OptFinal['ablation'] }
  charts?: string[]
  reporting_rules?: string
  calibration?: { allowed_claims: string[]; forbidden_claims: string[]; rule: string }
}

// ---- chat ------------------------------------------------------------------
export interface Claim { text: string; refs: string[]; basis: 'modeled' | 'empirical'; value?: string }
export type ChatEvent =
  | { event: 'text'; data: { delta: string } }
  | { event: 'tool_call'; data: { name: string; args: Record<string, unknown>; call: number } }
  | { event: 'tool_result'; data: { name: string; refs: string[]; summary: string | Record<string, unknown>; is_error: boolean } }
  | { event: 'claims'; data: { claims: Claim[]; plan_id?: string | null; parse_error?: string | null } }
  | { event: 'done'; data: { calls: number; budget: number } }
  | { event: 'error'; data: { message: string } }

// ---- helpers ---------------------------------------------------------------
async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(API_BASE + url, { signal })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`)
  return (await r.json()) as T
}
async function postJSON<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(API_BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`)
  return (await r.json()) as T
}

export const api = {
  matches: (signal?: AbortSignal) => getJSON<MatchesResponse>('/api/matches', signal),
  network: (matchId: number, team: string, windows: string[], signal?: AbortSignal) =>
    getJSON<NetworkResponse>(`/api/network/${matchId}?team=${encodeURIComponent(team)}&windows=${encodeURIComponent(windows.join(','))}`, signal),
  scores: (team: string, w?: Weights, signal?: AbortSignal) => {
    const q = w ? `?w_pr=${w.pr}&w_bt=${w.bt}&w_prog=${w.prog}&w_press=${w.press_resist}` : ''
    return getJSON<ScoresResponse>(`/api/scores/${encodeURIComponent(team)}${q}`, signal)
  },
  profile: (team: string, signal?: AbortSignal) => getJSON<ProfileResponse>(`/api/profile/${encodeURIComponent(team)}`, signal),
  player: (id: number, signal?: AbortSignal) => getJSON<PlayerResponse>(`/api/player/${id}`, signal),
  simulate: (body: { team: string; interventions: Intervention[]; match_ids?: number[]; windows?: string[] }, signal?: AbortSignal) =>
    postJSON<SimulateResponse>('/api/simulate', body, signal),
  ablation: (our: string, their: string, signal?: AbortSignal) =>
    getJSON<AblationResponse>(`/api/ablation?our=${encodeURIComponent(our)}&their=${encodeURIComponent(their)}`, signal),
  evals: (signal?: AbortSignal) => getJSON<EvalResponse>('/api/eval', signal),
  optimizeLast: async (our: string, their: string, method = 'ga'): Promise<OptFinal | null> => {
    const r = await fetch(`${API_BASE}/api/optimize/last?our=${encodeURIComponent(our)}&their=${encodeURIComponent(their)}&method=${method}`)
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`${r.status} for optimize/last`)
    return (await r.json()) as OptFinal
  },
}

/** Read a POST SSE stream (event:/data: lines) and invoke onEvent per message. */
export async function readSSE(
  url: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(API_BASE + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!r.ok || !r.body) throw new Error(`${r.status} ${r.statusText} for ${url}`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const flush = (block: string) => {
    let ev = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (!dataLines.length) return
    const raw = dataLines.join('\n')
    let data: unknown = raw
    try { data = JSON.parse(raw) } catch { /* keep raw string */ }
    onEvent(ev, data)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    // sse-starlette emits CRLF line endings; normalise so block detection works on either
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      if (block.trim()) flush(block)
    }
  }
  if (buf.trim()) flush(buf)
}

/** Highlight-bus ref helpers. */
export const refs = {
  player: (id: number) => `player:${id}`,
  edge: (src: number, dst: number) => `edge:${src}->${dst}`,
  match: (id: number) => `match:${id}`,
  parse(ref: string): { kind: 'player' | 'edge' | 'match'; id?: number; src?: number; dst?: number } | null {
    const [kind, rest] = ref.split(':', 2) as [string, string | undefined]
    if (!rest) return null
    if (kind === 'player') return { kind, id: Number(rest) }
    if (kind === 'match') return { kind, id: Number(rest) }
    if (kind === 'edge') {
      const [s, d] = rest.split('->')
      return { kind, src: Number(s), dst: Number(d) }
    }
    return null
  },
}
