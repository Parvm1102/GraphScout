import { create } from 'zustand'
import {
  api, readSSE, refs as R,
  type MatchesResponse, type NetworkResponse, type Edge, type ScoresResponse, type Weights, type SimulateResponse,
  type Intervention, type OptStart, type OptGreedy, type OptGeneration, type OptFinal, type Claim, type ChatEvent,
  type ProfileResponse, type PlanItem,
} from './api'
import { mirror, TEAM_RED, TEAM_BLUE } from './lib/pitch'

export interface Pos { id: number; x: number; y: number; name: string; jersey?: number; team: string }

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  claims?: Claim[]
  activity?: { kind: 'tool_call' | 'tool_result'; name: string; summary?: string; args?: Record<string, unknown>; is_error?: boolean; refs?: string[] }[]
  error?: string
  plan_id?: string | null
  calls?: number; budget?: number
  streaming?: boolean
}

export interface SimSel {
  mode: 'suppress' | 'cut_lane'
  target: number | null
  presser: number | null
  edge: { src: number; dst: number } | null
}

export interface OptimizeState {
  status: 'idle' | 'running' | 'done' | 'error'
  start: OptStart | null
  greedy: OptGreedy | null
  generations: OptGeneration[]
  final: OptFinal | null
  error: string | null
  fromCache: boolean
}

interface State {
  matches: MatchesResponse | null
  our: string
  their: string
  team: string
  selectedMatch: number | null
  windows: string[]
  network: NetworkResponse | null
  networkLoading: boolean
  networkAfter: Edge[] | null
  simPlan: PlanItem[] | null
  scores: Record<string, ScoresResponse>
  profile: ProfileResponse | null
  weights: Weights
  simResult: SimulateResponse | null
  simLoading: boolean
  simError: string | null
  simSel: SimSel
  simView: 'before' | 'after'
  optimize: OptimizeState
  chat: { messages: ChatMessage[]; streaming: boolean }
  highlights: Set<string>
  hover: Set<string>
  error: string | null

  init: () => Promise<void>
  setTeam: (team: string) => Promise<void>
  setMatch: (id: number) => Promise<void>
  toggleWindow: (w: string) => void
  loadNetwork: () => Promise<void>
  setWeights: (w: Weights) => Promise<void>
  runSimulate: (interventions: Intervention[]) => Promise<void>
  clearSim: () => void
  setSimSel: (p: Partial<SimSel>) => void
  setSimView: (v: 'before' | 'after') => void
  runOptimize: (method?: 'ga' | 'greedy') => Promise<void>
  loadOptimizeLast: () => Promise<void>
  sendChat: (question: string) => Promise<void>
  addHighlight: (...r: string[]) => void
  removeHighlight: (...r: string[]) => void
  clearHighlights: () => void
  setHover: (r: string[]) => void
}

let netAbort: AbortController | null = null
let scoresAbort: AbortController | null = null

export const useStore = create<State>()((set, get) => ({
  matches: null,
  our: 'England',
  their: 'Spain',
  team: 'Spain',
  selectedMatch: null,
  windows: ['0-15', '15-30', '30-45', '45-60', '60-75', '75-90+'],
  network: null,
  networkLoading: false,
  networkAfter: null,
  simPlan: null,
  scores: {},
  profile: null,
  weights: { pr: 0.3, bt: 0.3, prog: 0.25, press_resist: 0.15 },
  simResult: null,
  simLoading: false,
  simError: null,
  simSel: { mode: 'suppress', target: null, presser: null, edge: null },
  simView: 'after',
  optimize: { status: 'idle', start: null, greedy: null, generations: [], final: null, error: null, fromCache: false },
  chat: { messages: [], streaming: false },
  highlights: new Set(),
  hover: new Set(),
  error: null,

  async init() {
    try {
      const m = await api.matches()
      const team = m.their
      const last = lastMatchOf(m, team)
      set({ matches: m, our: m.our, their: m.their, team, selectedMatch: last, windows: m.windows })
      await Promise.all([
        get().loadNetwork(),
        loadScores(set, get, m.our),
        loadScores(set, get, m.their),
        api.profile(team).then((profile) => set({ profile })).catch(() => undefined),
      ])
      void get().loadOptimizeLast()
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async setTeam(team) {
    const { matches } = get()
    if (!matches || team === get().team) return
    const last = lastMatchOf(matches, team)
    set({ team, selectedMatch: last, simResult: null, networkAfter: null, simPlan: null, simError: null, profile: null, simSel: { mode: 'suppress', target: null, presser: null, edge: null } })
    await Promise.all([
      get().loadNetwork(),
      api.profile(team).then((profile) => set({ profile })).catch(() => undefined),
    ])
  },

  async setMatch(id) {
    if (id === get().selectedMatch) return
    set({ selectedMatch: id })
    const { simResult } = get()
    const pm = simResult?.per_match.find((p) => p.match_id === id)
    set({ networkAfter: pm?.network_after ?? null })
    await get().loadNetwork()
  },

  toggleWindow(w) {
    const { windows, matches } = get()
    const all = matches?.windows ?? windows
    let next = windows.includes(w) ? windows.filter((x) => x !== w) : [...windows, w]
    if (!next.length) next = [w]
    next = all.filter((x) => next.includes(x))
    set({ windows: next })
    void get().loadNetwork()
  },

  async loadNetwork() {
    const { selectedMatch, team, windows } = get()
    if (!selectedMatch) return
    netAbort?.abort()
    netAbort = new AbortController()
    set({ networkLoading: true })
    try {
      const network = await api.network(selectedMatch, team, windows, netAbort.signal)
      set({ network, networkLoading: false })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      set({ error: (e as Error).message, networkLoading: false })
    }
  },

  async setWeights(w) {
    set({ weights: w })
    scoresAbort?.abort()
    scoresAbort = new AbortController()
    try {
      const s = await api.scores(get().team, w, scoresAbort.signal)
      set((st) => ({ scores: { ...st.scores, [s.team]: s } }))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message })
    }
  },

  async runSimulate(interventions) {
    const { team, selectedMatch } = get()
    set({ simLoading: true, simError: null })
    try {
      const res = await api.simulate({ team, interventions })
      const pm = res.per_match.find((p) => p.match_id === selectedMatch)
      set({ simResult: res, simLoading: false, networkAfter: pm?.network_after ?? null, simPlan: res.plan, simView: 'after' })
    } catch (e) {
      set({ simLoading: false, simError: (e as Error).message })
    }
  },

  clearSim() {
    set({ simResult: null, networkAfter: null, simPlan: null, simError: null, simView: 'after' })
  },
  setSimSel(p) { set((st) => ({ simSel: { ...st.simSel, ...p } })) },
  setSimView(v) { set({ simView: v }) },

  async runOptimize(method = 'ga') {
    const { our, their } = get()
    set({ optimize: { status: 'running', start: null, greedy: null, generations: [], final: null, error: null, fromCache: false } })
    try {
      await readSSE('/api/optimize', { our, their, method, max_commitments: 4, seed: 42 }, (ev, data) => {
        set((st) => {
          const o = { ...st.optimize }
          if (ev === 'start') o.start = data as OptStart
          else if (ev === 'greedy') { o.greedy = data as OptGreedy; persistRun(our, their, o.start, o.greedy) }
          else if (ev === 'generation') o.generations = [...o.generations, data as OptGeneration]
          else if (ev === 'final') {
            const f = data as OptFinal
            if (f && typeof f === 'object' && f.champion) { o.final = f; o.status = 'done' }
            else { o.error = 'optimizer returned a malformed final event'; o.status = 'error' }
          }
          else if (ev === 'error') { o.error = (data as { message: string })?.message ?? String(data); o.status = 'error' }
          return { optimize: o }
        })
      })
      set((st) => ({ optimize: { ...st.optimize, status: st.optimize.status === 'running' ? 'done' : st.optimize.status } }))
    } catch (e) {
      set((st) => ({ optimize: { ...st.optimize, status: 'error', error: (e as Error).message } }))
    }
  },

  async loadOptimizeLast() {
    const { our, their, optimize } = get()
    if (optimize.status !== 'idle') return
    try {
      const final = await api.optimizeLast(our, their)
      if (!final || get().optimize.status !== 'idle') return
      const saved = restoreRun(our, their, final.run_id)
      set({
        optimize: {
          status: 'done', start: saved?.start ?? final.start ?? null, greedy: saved?.greedy ?? final.greedy_event ?? null, final, error: null, fromCache: true,
          generations: final.evolution ?? [],
        },
      })
    } catch { /* no cached run */ }
  },

  async sendChat(question) {
    const history = get().chat.messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.text }))
    const userMsg: ChatMessage = { role: 'user', text: question }
    const asst: ChatMessage = { role: 'assistant', text: '', activity: [], claims: [], streaming: true }
    set((st) => ({ chat: { messages: [...st.chat.messages, userMsg, asst], streaming: true } }))
    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      set((st) => {
        const msgs = st.chat.messages.slice()
        msgs[msgs.length - 1] = fn(msgs[msgs.length - 1])
        return { chat: { ...st.chat, messages: msgs } }
      })
    const onEvent = (ev: string, data: unknown) => {
      const e = { event: ev, data } as ChatEvent
      if (e.event === 'text') patch((m) => ({ ...m, text: m.text + e.data.delta }))
      else if (e.event === 'tool_call') patch((m) => ({ ...m, activity: [...(m.activity ?? []), { kind: 'tool_call', name: e.data.name, args: e.data.args }] }))
      else if (e.event === 'tool_result') patch((m) => ({ ...m, activity: [...(m.activity ?? []), { kind: 'tool_result', name: e.data.name, summary: e.data.summary, is_error: e.data.is_error, refs: e.data.refs }] }))
      else if (e.event === 'claims') patch((m) => ({ ...m, claims: e.data.claims ?? [], plan_id: e.data.plan_id }))
      else if (e.event === 'done') patch((m) => ({ ...m, calls: e.data.calls, budget: e.data.budget }))
      else if (e.event === 'error') patch((m) => ({ ...m, error: e.data.message }))
    }
    try {
      const mock = new URLSearchParams(location.search).get('mockChat')
      if (mock) {
        const { mockChatStream } = await import('./lib/mockChat')
        await mockChatStream(question, onEvent)
      } else {
        await readSSE('/api/chat', { question, history }, onEvent)
      }
    } catch (e) {
      patch((m) => ({ ...m, error: (e as Error).message }))
    } finally {
      patch((m) => ({ ...m, streaming: false }))
      set((st) => ({ chat: { ...st.chat, streaming: false } }))
    }
  },

  addHighlight(...r) {
    set((st) => { const h = new Set(st.highlights); r.forEach((x) => h.add(x)); return { highlights: h } })
  },
  removeHighlight(...r) {
    set((st) => { const h = new Set(st.highlights); r.forEach((x) => h.delete(x)); return { highlights: h } })
  },
  clearHighlights() { set({ highlights: new Set(), hover: new Set() }) },
  setHover(r) { set({ hover: new Set(r) }) },
}))

function persistRun(our: string, their: string, start: OptStart | null, greedy: OptGreedy | null) {
  if (!start || !greedy) return
  try { sessionStorage.setItem(`gs.run.${our}.${their}`, JSON.stringify({ run_id: start.run_id, start, greedy })) } catch { /* quota or private mode */ }
}
function restoreRun(our: string, their: string, runId: string): { start: OptStart; greedy: OptGreedy } | null {
  try {
    const raw = sessionStorage.getItem(`gs.run.${our}.${their}`)
    if (!raw) return null
    const v = JSON.parse(raw) as { run_id: string; start: OptStart; greedy: OptGreedy }
    return v.run_id === runId ? { start: v.start, greedy: v.greedy } : null
  } catch { return null }
}

function lastMatchOf(m: MatchesResponse, team: string): number | null {
  const played = m.matches.filter((x) => x.home === team || x.away === team)
  return played.length ? played[played.length - 1].id : (m.matches[0]?.id ?? null)
}

async function loadScores(set: (p: Partial<State>) => void, get: () => State, team: string) {
  try {
    const s = await api.scores(team)
    set({ scores: { ...get().scores, [team]: s } })
  } catch (e) {
    set({ error: (e as Error).message })
  }
}

// ---- derived selectors -----------------------------------------------------

export const useTeamColor = () => useStore((s) => (s.team === s.our ? TEAM_BLUE : TEAM_RED))
export const useOtherColor = () => useStore((s) => (s.team === s.our ? TEAM_RED : TEAM_BLUE))
export const colorFor = (team: string, our: string) => (team === our ? TEAM_BLUE : TEAM_RED)

/** Union of pinned + hover highlights. */
export function useActiveHighlights(): Set<string> {
  const h = useStore((s) => s.highlights)
  const hv = useStore((s) => s.hover)
  if (!hv.size) return h
  if (!h.size) return hv
  const u = new Set(h); hv.forEach((x) => u.add(x)); return u
}

/** Positions of the other side's players mirrored into the displayed team's attacking frame. */
export function otherPositions(st: Pick<State, 'team' | 'our' | 'their' | 'scores'>): Record<number, Pos> {
  const other = st.team === st.our ? st.their : st.our
  const s = st.scores[other]
  const out: Record<number, Pos> = {}
  if (!s) return out
  for (const p of s.players) {
    const m = mirror({ x: p.avg_x, y: p.avg_y })
    out[p.id] = { id: p.id, x: m.x, y: m.y, name: p.name, jersey: p.jersey, team: other }
  }
  return out
}

export function teamPositions(st: Pick<State, 'team' | 'scores' | 'network'>): Record<number, Pos> {
  const out: Record<number, Pos> = {}
  const s = st.scores[st.team]
  if (s) for (const p of s.players) out[p.id] = { id: p.id, x: p.avg_x, y: p.avg_y, name: p.name, jersey: p.jersey, team: st.team }
  if (st.network) for (const p of st.network.players) out[p.id] = { id: p.id, x: p.avg_x, y: p.avg_y, name: p.name, jersey: p.jersey, team: st.team }
  return out
}

export const refs = R
