// Conversations: live list, thread with approve / edit / reject, human takeover, and the agent trace.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { api, live, ago, money, usd } from './api';

type Conv = any; type Msg = any;

export function Inbox({ selectedId }: { selectedId?: number }) {
  const [filter, setFilter] = useState<string>('');
  const [list, setList] = useState<Conv[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [selMsg, setSelMsg] = useState<number | null>(null);

  const loadList = useCallback(() => api(`/api/conversations${filter ? `?status=${filter}` : ''}`).then(setList).catch(() => {}), [filter]);
  const loadDetail = useCallback(() => { if (selectedId) api(`/api/conversations/${selectedId}`).then(setDetail).catch(() => setDetail(null)); }, [selectedId]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { setDetail(null); setSelMsg(null); loadDetail(); }, [loadDetail]);
  useEffect(() => {
    let t: any;
    return live((e) => { clearTimeout(t); t = setTimeout(() => { loadList(); if (e.conversationId === selectedId) loadDetail(); }, 250); });
  }, [loadList, loadDetail, selectedId]);

  return (
    <div className="inbox">
      <div className="card list">
        <div className="tabs" style={{ padding: 10, margin: 0 }}>
          {[['', 'All'], ['pending', 'Needs review'], ['escalated', 'Escalated'], ['open', 'Open'], ['resolved', 'Resolved']].map(([v, l]) => (
            <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>))}
        </div>
        {list.map((c) => (
          <div key={c.id} className={`item ${c.id === selectedId ? 'sel' : ''}`} onClick={() => (location.hash = `#/conversations/${c.id}`)}>
            <div className="t"><span>{c.customer_name ?? c.customer_email ?? 'Guest'}</span><span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{ago(c.updated_at)}</span></div>
            <div className="row" style={{ marginTop: 4 }}>
              <span className={`badge ${c.channel}`}>{c.channel}</span><span className={`badge ${c.status}`}>{c.status}</span>
              {c.pending > 0 && <span className="badge pending_review">{c.pending} to review</span>}
              {c.handled_by_human && <span className="badge taken">human</span>}
            </div>
            <div className="p">{c.last_message}</div>
          </div>
        ))}
        {!list.length && <div className="muted" style={{ padding: 14 }}>No conversations yet. Open the customer chat and say hello.</div>}
      </div>
      {detail ? <Thread d={detail} reload={loadDetail} selMsg={selMsg} setSelMsg={setSelMsg} /> : <div className="card muted">Select a conversation.</div>}
      {detail ? <SidePanel d={detail} selMsg={selMsg} /> : <div />}
    </div>
  );
}

function Thread({ d, reload, selMsg, setSelMsg }: { d: any; reload: () => void; selMsg: number | null; setSelMsg: (n: number) => void }) {
  const c = d.conversation;
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const act = async (path: string, body?: any) => { await api(path, { method: 'POST', body: body ?? {} }); reload(); };
  return (
    <div className="card thread">
      <div className="head row" style={{ justifyContent: 'space-between' }}>
        <div><b>{c.customer_name ?? c.customer_email}</b> <span className="muted">#{c.id} · {c.channel}{c.tier === 'plus' ? ' · Plus member' : ''}</span></div>
        <div className="row">
          {c.handled_by_human ? <button onClick={() => act(`/api/conversations/${c.id}/release`)}>Hand back to AI</button>
            : <button onClick={() => act(`/api/conversations/${c.id}/takeover`)}>Take over</button>}
          {c.status !== 'resolved' ? <button onClick={() => act(`/api/conversations/${c.id}/resolve`)}>Resolve</button> : <button onClick={() => act(`/api/conversations/${c.id}/reopen`)}>Reopen</button>}
        </div>
      </div>
      <div className="msgs">
        {d.messages.map((m: Msg) => (
          <div key={m.id} className={`bubble ${m.role} ${m.status === 'rejected' ? 'rejected' : ''}`} onClick={() => m.role === 'assistant' && setSelMsg(m.id)}
            style={{ outline: selMsg === m.id ? '2px solid var(--brand)' : 'none', cursor: m.role === 'assistant' ? 'pointer' : 'default' }}>
            <div className="meta">
              <span>{m.role === 'assistant' ? 'AI' : m.role === 'human' ? 'Human agent' : 'Customer'}</span>
              {m.agent && <span className={`badge ${m.agent}`}>{m.agent}</span>}
              {m.status !== 'sent' && m.status !== 'received' && <span className={`badge ${m.status}`}>{m.status.replace('_', ' ')}</span>}
              <span>{new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {editing === m.id ? (
              <div onClick={(e) => e.stopPropagation()}>
                <textarea rows={4} value={editText} onChange={(e) => setEditText(e.target.value)} />
                <div className="acts"><button className="primary" onClick={async () => { await act(`/api/messages/${m.id}/edit`, { content: editText }); setEditing(null); }}>Save & send</button><button onClick={() => setEditing(null)}>Cancel</button></div>
              </div>
            ) : m.content}
            {m.review_reason && m.status === 'pending_review' && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Why it is waiting: {m.review_reason}</div>}
            {m.citations?.length > 0 && <div className="cites">{m.citations.map((ci: any) => <span key={ci.n} className="cite">[{ci.n}] {ci.title} — {ci.heading}</span>)}</div>}
            {m.role === 'assistant' && editing !== m.id && m.status !== 'rejected' && (
              <div className="acts" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => act(`/api/messages/${m.id}/approve`)}>{m.status === 'pending_review' ? 'Approve & send' : 'Approve'}</button>
                <button onClick={() => { setEditing(m.id); setEditText(m.content); }}>Edit</button>
                <button className="danger" onClick={() => { const note = prompt('Why is this reply wrong? (helps the AI learn)') ?? undefined; act(`/api/messages/${m.id}/reject`, { note }); }}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="composer" onSubmit={async (e) => { e.preventDefault(); if (!reply.trim()) return; await act(`/api/conversations/${c.id}/reply`, { content: reply }); setReply(''); }}>
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply as a human agent…" />
        <button className="primary">Send</button>
      </form>
    </div>
  );
}

function SidePanel({ d, selMsg }: { d: any; selMsg: number | null }) {
  const c = d.conversation;
  const msgId = selMsg ?? [...d.messages].reverse().find((m: any) => m.role === 'assistant')?.id;
  const traces = useMemo(() => d.traces.filter((t: any) => t.message_id === msgId), [d.traces, msgId]);
  const cost = d.llm_calls.reduce((s: number, x: any) => s + Number(x.cost_usd), 0);
  const tokens = d.llm_calls.reduce((s: number, x: any) => s + x.prompt_tokens + x.completion_tokens, 0);
  const lat = d.llm_calls.length ? Math.round(d.llm_calls.reduce((s: number, x: any) => s + x.latency_ms, 0) / d.llm_calls.length) : 0;
  return (
    <div className="side-panel">
      {d.escalations.map((e: any) => (
        <div key={e.id} className="card" style={{ borderColor: '#f0c6c3' }}>
          <h2>Escalation <span className={`badge ${e.status}`}>{e.status}</span></h2>
          <div className="muted" style={{ fontSize: 12 }}>Reason: {e.reason} · risk {Number(e.risk_score).toFixed(2)}</div>
          <p style={{ marginBottom: 0 }}>{e.summary}</p>
        </div>
      ))}
      <div className="card">
        <h2>Agent trace {msgId ? <span className="muted" style={{ fontWeight: 400 }}>· reply #{msgId}</span> : null}</h2>
        {!traces.length && <div className="muted">Click an AI reply to see how it was produced.</div>}
        <div className="trace">
          {traces.map((t: any) => <TraceStep key={t.id} t={t} />)}
        </div>
      </div>
      <div className="card">
        <h2>Customer</h2>
        <div>{c.customer_name} <span className="muted">{c.customer_email}</span></div>
        {c.notes && <div className="muted" style={{ fontSize: 12 }}>{c.notes}</div>}
        <table style={{ marginTop: 8 }}><tbody>{d.orders.map((o: any) => <tr key={o.id}><td>{o.id}</td><td><span className={`badge ${o.status}`}>{o.status}</span></td><td>{money(o.total_gbp)}</td></tr>)}</tbody></table>
      </div>
      <div className="card">
        <h2>Cost & latency</h2>
        <div className="muted">{d.llm_calls.length} LLM calls · {tokens.toLocaleString()} tokens · {usd(cost)} · avg {lat} ms</div>
      </div>
    </div>
  );
}

function TraceStep({ t }: { t: any }) {
  const d = t.detail ?? {};
  let summary: React.ReactNode = null;
  if (t.step === 'route') summary = <>Routed to <span className={`badge ${d.agent}`}>{d.agent}</span> (confidence {d.confidence}, sentiment {d.sentiment}, risk {d.risk}). {d.reason}{d.overridden && <div className="err">Override: {d.overridden}</div>}</>;
  else if (t.step === 'retrieval') summary = <>Hybrid search for “{d.query}”<pre>{(d.hits ?? []).map((h: any, i: number) => `${i + 1}. ${h.source} › ${h.heading}  rel ${h.relevance} (vec ${h.vector}, kw ${h.keyword})`).join('\n')}</pre></>;
  else if (t.step === 'tool_call') summary = <>Called <b style={{ textTransform: 'none' }}>{d.tool}</b> — {d.why}<pre>{JSON.stringify({ args: { ...d.args, reason: undefined }, result: d.result }, null, 2)}</pre></>;
  else if (t.step === 'handover') summary = <>Handed to humans ({d.reason}, risk {d.risk}). {d.summary}</>;
  else if (t.step === 'i_dont_know') summary = <>Said “I don't know”: {d.reason}</>;
  else if (t.step === 'learned_guidance') summary = <>Used {d.rules} learned rules and {d.examples} past human corrections.</>;
  else if (t.step === 'reply') summary = <>Reply {d.status === 'sent' ? 'sent' : 'held for review'} in {d.ms} ms{d.review_reason ? ` — ${d.review_reason}` : ''}.</>;
  else summary = <pre>{JSON.stringify(d, null, 2)}</pre>;
  return <div className="step"><b>{t.agent} · {t.step.replace('_', ' ')}</b><div>{summary}</div></div>;
}
