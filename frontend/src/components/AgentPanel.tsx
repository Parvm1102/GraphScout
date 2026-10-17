import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore, type ChatMessage } from '../store'
import { type Claim } from '../api'
import { BasisBadge } from './Badge'
import { AMBER } from '../lib/pitch'
import { useReduced } from '../lib/motion'

const SUGGESTIONS = [
  'How do we beat Spain?',
  "Who is Spain's most important player, and what happens if Rice marks him?",
  'Which progressive lane should we cut first?',
  'Is the modeled effect of marking Rodri backed by his real absence windows?',
]

/** Strip the trailing fenced ```json claims block from streamed prose (even while it is still arriving). */
export function stripClaimsBlock(text: string): string {
  const i = text.lastIndexOf('```json')
  return (i >= 0 ? text.slice(0, i) : text).replace(/\s+$/, '')
}

export default function AgentPanel() {
  const msgs = useStore((s) => s.chat.messages)
  const streaming = useStore((s) => s.chat.streaming)
  const send = useStore((s) => s.sendChat)
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs])

  const ask = (text: string) => {
    const t = text.trim()
    if (!t || streaming) return
    setQ('')
    void send(t)
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <div>
        <div className="text-[14px] font-semibold flex items-center gap-2">Scout agent <span className="badge badge-amber">tools over FalkorDB</span></div>
        <div className="text-[11px] text-ink-3">The model only plans tool calls and writes prose; every number comes from Cypher or the simulator. Hover a claim to light its players, lanes and matches on the pitch; click to pin.</div>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin flex flex-col gap-3 pr-1" style={{ minHeight: 240 }}>
        {!msgs.length && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] text-ink-3">Try</div>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip text-left" style={{ borderRadius: 8 }} onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => <Message key={i} m={m} />)}
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
        <input className="txt" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the opponent, a player, a lane, or a plan…" disabled={streaming} aria-label="Question" />
        <button type="submit" className="btn btn-amber shrink-0" disabled={streaming || !q.trim()}>{streaming ? 'Thinking…' : 'Ask'}</button>
      </form>
    </div>
  )
}

function Message({ m }: { m: ChatMessage }) {
  const reduced = useReduced()
  if (m.role === 'user') {
    return (
      <div className="self-end max-w-[85%] rounded-xl px-3 py-2 text-[12.5px]" style={{ background: 'rgba(255,255,255,0.08)' }}>{m.text}</div>
    )
  }
  const text = stripClaimsBlock(m.text)
  const paras = text.split(/\n{2,}/).filter(Boolean)
  return (
    <div className="flex flex-col gap-2 max-w-[96%]">
      {!!m.activity?.length && (
        <div className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {m.activity.map((a, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduced ? 0 : 0.25 }}
                className="flex items-start gap-2 rounded-md px-2 py-1 text-[11px]"
                style={{ background: a.is_error ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.08)', borderLeft: `2px solid ${a.is_error ? '#EF4444' : AMBER}` }}>
                <span className="font-semibold shrink-0 num" style={{ color: a.is_error ? '#FCA5A5' : AMBER }}>
                  {a.kind === 'tool_call' ? 'call' : 'result'} · {a.name}
                </span>
                <span className="text-ink-2 min-w-0 break-words">
                  {a.kind === 'tool_call' ? fmtArgs(a.args) : a.summary}
                  {a.kind === 'tool_result' && !!a.refs?.length && <span className="text-ink-3"> · {a.refs.length} refs</span>}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      {(paras.length > 0 || m.streaming) && (
        <div className="rounded-xl px-3 py-2 text-[12.5px] leading-relaxed flex flex-col gap-2" style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.18)' }}>
          {paras.map((p, i) => <p key={i} className="m-0">{p}</p>)}
          {m.streaming && !paras.length && <span className="text-ink-3 text-[11px]">{m.activity?.length ? 'reading tool results…' : 'planning…'}</span>}
          {m.streaming && paras.length > 0 && <span className="inline-block w-[6px] h-[12px] -mb-[2px]" style={{ background: AMBER, opacity: 0.8 }} aria-hidden />}
        </div>
      )}
      {!!m.claims?.length && (
        <div className="flex flex-col gap-1.5">
          <div className="panel-title">Claims · {m.claims.length}</div>
          {m.claims.map((c, i) => <ClaimCard key={i} c={c} />)}
        </div>
      )}
      {m.error && (
        <div className="rounded-md px-3 py-2 text-[11.5px]" style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5' }}>
          <div className="font-semibold">The agent could not answer</div>
          <div className="opacity-90 break-words">{m.error}</div>
          {/401|api-key|authentication/i.test(m.error) && <div className="mt-1 text-ink-2">The LLM key on this machine is rejected. Put a valid key in backend/.env; the loop reloads it per question. Simulation, optimizer and evidence need no LLM.</div>}
        </div>
      )}
      {m.calls != null && (
        <div className="text-[10.5px] text-ink-3 num">{m.calls} of {m.budget ?? 15} LLM calls used{m.plan_id ? ` · plan ${m.plan_id}` : ''}</div>
      )}
    </div>
  )
}

function ClaimCard({ c }: { c: Claim }) {
  const setHover = useStore((s) => s.setHover)
  const highlights = useStore((s) => s.highlights)
  const add = useStore((s) => s.addHighlight)
  const remove = useStore((s) => s.removeHighlight)
  const pinned = c.refs.length > 0 && c.refs.every((r) => highlights.has(r))
  return (
    <button
      className="text-left rounded-lg px-3 py-2 flex items-start gap-3 transition-colors duration-200"
      style={{ background: pinned ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)', border: `1px solid ${pinned ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)'}` }}
      onMouseEnter={() => setHover(c.refs)} onMouseLeave={() => setHover([])}
      onClick={() => (pinned ? remove(...c.refs) : add(...c.refs))}
      title={pinned ? 'Unpin highlights' : 'Pin highlights on the pitch'}>
      {c.value && <span className="num text-[16px] font-semibold shrink-0 w-[64px]" style={{ color: c.basis === 'empirical' ? '#93C5FD' : '#E7EEE9' }}>{c.value}</span>}
      <span className="flex-1 min-w-0">
        <span className="text-[12px] block">{c.text}</span>
        <span className="flex items-center gap-1.5 mt-1 flex-wrap">
          <BasisBadge basis={c.basis} />
          {c.refs.slice(0, 6).map((r) => <span key={r} className="text-[10px] num text-ink-3">{r}</span>)}
          {c.refs.length > 6 && <span className="text-[10px] text-ink-3">+{c.refs.length - 6}</span>}
        </span>
      </span>
    </button>
  )
}

function fmtArgs(args?: Record<string, unknown>): string {
  if (!args) return ''
  return Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' ').slice(0, 220)
}
