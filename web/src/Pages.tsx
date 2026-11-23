// Dashboard pages: escalations, refunds, analytics, learning loop, evals & fine-tuning, knowledge base, operations.
import { useEffect, useState } from 'react';
import { api, ago, money, usd, live } from './api';

function useData<T = any>(path: string, deps: any[] = []) {
  const [d, setD] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const load = () => api<T>(path).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, deps); // eslint-disable-line
  return { d, err, load };
}

export function Escalations() {
  const { d, load } = useData<any[]>('/api/escalations');
  useEffect(() => live((e) => e.type === 'escalation' && load()), []); // eslint-disable-line
  return (
    <>
      <h1>Escalations</h1>
      <div className="card"><table><thead><tr><th>Risk</th><th>Customer</th><th>Reason</th><th>Summary</th><th>Status</th><th>When</th></tr></thead>
        <tbody>{(d ?? []).map((e) => (
          <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => (location.hash = `#/conversations/${e.conversation_id}`)}>
            <td><b style={{ color: Number(e.risk_score) >= 0.8 ? 'var(--bad)' : 'inherit' }}>{Number(e.risk_score).toFixed(2)}</b></td>
            <td>{e.customer_name}<div className="muted">{e.channel}</div></td><td>{e.reason}</td><td style={{ maxWidth: 480 }}>{e.summary}</td>
            <td><span className={`badge ${e.status}`}>{e.status}</span></td><td className="muted">{ago(e.created_at)}</td>
          </tr>))}</tbody></table>
        {d && !d.length && <div className="muted">No escalations.</div>}
      </div>
    </>
  );
}

export function Refunds({ isAdmin }: { isAdmin: boolean }) {
  const { d, load } = useData<any[]>('/api/refunds');
  const decide = async (id: number, x: 'approve' | 'reject') => { await api(`/api/refunds/${id}/${x}`, { method: 'POST', body: {} }); load(); };
  return (
    <>
      <h1>Refunds</h1>
      <p className="muted">The AI issues refunds up to the auto-approval limit on its own. Larger refunds wait here for an admin.</p>
      <div className="card"><table><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Reason</th><th>Status</th><th>Decided by</th><th /></tr></thead>
        <tbody>{(d ?? []).map((r) => (
          <tr key={r.id}><td>{r.order_id}</td><td>{r.customer_name}</td><td>{money(r.amount_gbp)} <span className="muted">of {money(r.total_gbp)}</span></td><td>{r.reason}</td>
            <td><span className={`badge ${r.status}`}>{r.status.replace('_', ' ')}</span></td><td className="muted">{r.decided_by ?? '—'}</td>
            <td>{r.status === 'pending_approval' && (isAdmin ? <div className="row"><button className="primary" onClick={() => decide(r.id, 'approve')}>Approve</button><button className="danger" onClick={() => decide(r.id, 'reject')}>Reject</button></div> : <span className="muted">admin only</span>)}
              {r.conversation_id && <a href={`#/conversations/${r.conversation_id}`} style={{ marginLeft: 8 }}>chat</a>}</td></tr>))}</tbody></table></div>
    </>
  );
}

function Bars({ rows, label, value, fmt = (v: number) => String(v) }: { rows: any[]; label: string; value: string; fmt?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value])));
  return <div className="bars">{rows.map((r, i) => (
    <div className="bar" key={i}><span title={r[label]}>{String(r[label] ?? '—').slice(0, 22)}</span><div className="track"><div className="fill" style={{ width: `${(100 * Number(r[value])) / max}%` }} /></div><span>{fmt(Number(r[value]))}</span></div>))}
    {!rows.length && <span className="muted">No data yet.</span>}</div>;
}

function Line({ points, max = 100, suffix = '%' }: { points: { x: string; y: number }[]; max?: number; suffix?: string }) {
  if (!points.length) return <span className="muted">No data yet.</span>;
  const w = 520, h = 140, pad = 24;
  const xs = (i: number) => pad + (points.length === 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (points.length - 1));
  const ys = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', maxWidth: w }}>
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="#e3e7e4" />
      <polyline fill="none" stroke="#0d5e57" strokeWidth="2.5" points={points.map((p, i) => `${xs(i)},${ys(p.y)}`).join(' ')} />
      {points.map((p, i) => <g key={i}><circle cx={xs(i)} cy={ys(p.y)} r="3.5" fill="#0d5e57" /><text x={xs(i)} y={ys(p.y) - 8} fontSize="10" textAnchor="middle">{Math.round(p.y)}{suffix}</text><text x={xs(i)} y={h - 6} fontSize="9" textAnchor="middle" fill="#66706c">{p.x}</text></g>)}
    </svg>
  );
}

export function Analytics() {
  const [days, setDays] = useState(7);
  const { d } = useData<any>(`/api/analytics?days=${days}`, [days]);
  if (!d) return <h1>Analytics</h1>;
  const kpis: [string, string][] = [
    ['Auto-resolution', `${d.auto_resolution_pct}%`], ['Median response time', `${d.response_time_median_s.toFixed(1)}s`],
    ['Cost per conversation', usd(d.cost_per_conversation_usd)], ['AI accuracy (human review)', d.ai_accuracy_pct == null ? '—' : `${d.ai_accuracy_pct}%`],
    ['Conversations', d.conversations], ['Escalations', d.escalations], ['Refunds issued', `${d.refunds_issued} · ${money(d.refunds_gbp)}`], ['Waiting for review', d.pending_review],
  ];
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}><h1>Analytics</h1>
        <div className="tabs">{[1, 7, 30].map((n) => <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n === 1 ? '24h' : `${n} days`}</button>)}</div></div>
      <div className="grid kpis">{kpis.map(([l, v]) => <div className="card kpi" key={l}><div className="l">{l}</div><div className="v">{v}</div></div>)}</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', marginTop: 14 }}>
        <div className="card"><h2>AI accuracy over time (approved ÷ reviewed)</h2><Line points={d.accuracy_over_time.map((r: any) => ({ x: String(r.day).slice(5, 10), y: r.pct }))} /></div>
        <div className="card"><h2>Eval score over time</h2><Line points={d.evals.map((r: any) => ({ x: new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }), y: Number(r.score) }))} /></div>
        <div className="card"><h2>Replies by agent</h2><Bars rows={d.by_agent} label="agent" value="n" /></div>
        <div className="card"><h2>Conversations by channel</h2><Bars rows={d.by_channel} label="channel" value="n" /></div>
        <div className="card"><h2>Top issues</h2><Bars rows={d.top_issues} label="issue" value="n" /></div>
        <div className="card"><h2>LLM cost per day</h2><Bars rows={d.daily.map((r: any) => ({ day: String(r.day).slice(0, 10), cost: r.cost_usd }))} label="day" value="cost" fmt={(v) => usd(v)} /></div>
      </div>
    </>
  );
}

export function Learning({ isAdmin }: { isAdmin: boolean }) {
  const { d, load } = useData<any>('/api/learning');
  const [msg, setMsg] = useState('');
  return (
    <>
      <h1>Learning loop</h1>
      <p className="muted">Every approve, edit or reject on a reply is saved. Similar corrections are shown to the AI as examples next time, recurring corrections are distilled into rules, and all approved/edited pairs export as a fine-tuning dataset.</p>
      {isAdmin && <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={async () => { const r = await api('/api/learning/distil', { method: 'POST', body: {} }); setMsg(JSON.stringify(r)); load(); }}>Distil rules now</button>
        <a href="#" onClick={async (e) => { e.preventDefault(); const t = await api<string>('/api/learning/export.jsonl'); const u = URL.createObjectURL(new Blob([t])); const a = document.createElement('a'); a.href = u; a.download = 'feedback-finetune.jsonl'; a.click(); }}>Export fine-tuning dataset (JSONL)</a>
        <span className="muted">{msg}</span></div>}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
        <div className="card"><h2>Learned rules</h2>
          {(d?.rules ?? []).map((r: any) => <div key={r.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
            <span style={{ opacity: r.active ? 1 : 0.5 }}><span className={`badge ${r.agent}`}>{r.agent}</span> {r.rule}</span>
            {isAdmin && <button onClick={async () => { await api(`/api/learning/rules/${r.id}/toggle`, { method: 'POST', body: {} }); load(); }}>{r.active ? 'Disable' : 'Enable'}</button>}</div>)}
          {d && !d.rules.length && <div className="muted">No rules yet. Edit or reject a few replies, then distil.</div>}
        </div>
        <div className="card"><h2>Recent feedback</h2><table><tbody>{(d?.feedback ?? []).map((f: any) => (
          <tr key={f.id}><td><span className={`badge ${f.action}`}>{f.action}</span><div className="muted">{f.agent}</div></td>
            <td><div className="muted">Customer: {f.customer_text}</div><div>AI: {f.original_reply}</div>{f.corrected_reply && <div style={{ color: 'var(--ok)' }}>Human: {f.corrected_reply}</div>}{f.note && <div className="muted">Note: {f.note}</div>}</td></tr>))}</tbody></table></div>
      </div>
    </>
  );
}

export function Evals() {
  const { d } = useData<any>('/api/evals');
  const ft = d?.finetune;
  return (
    <>
      <h1>Evals & fine-tuning</h1>
      <div className="card"><h2>Eval runs</h2><p className="muted">Run <code>npm run eval</code> — {'>'}50 scripted customer messages with expected routing, tools, citations and "I don't know" behaviour.</p>
        <table><thead><tr><th>When</th><th>Model</th><th>Score</th><th>Passed</th><th>By category</th></tr></thead><tbody>
          {(d?.runs ?? []).map((r: any) => <tr key={r.id}><td>{ago(r.created_at)}</td><td>{r.model}</td><td><b>{r.score}%</b></td><td>{r.passed}/{r.total}</td>
            <td className="muted">{Object.entries(r.details?.byCategory ?? {}).map(([k, v]: any) => `${k} ${v.passed}/${v.total}`).join(' · ')}</td></tr>)}</tbody></table></div>
      <div className="card" style={{ marginTop: 14 }}><h2>Fine-tuned router vs base model</h2>
        {!ft ? <div className="muted">Run <code>finetune/finetune_router.ipynb</code> on Colab and commit <code>finetune/results.json</code>.</div> : (
          <>
            <div className="muted">{ft.model} · LoRA · {ft.train_size} train / {ft.test_size} test examples · task: {ft.task}</div>
            <table style={{ marginTop: 8 }}><thead><tr><th>Model</th><th>Accuracy</th><th>Macro F1</th><th>Latency (ms/msg)</th><th>Cost per 1k msgs</th></tr></thead>
              <tbody>{ft.rows.map((r: any) => <tr key={r.name}><td>{r.name}</td><td><b>{(100 * r.accuracy).toFixed(1)}%</b></td><td>{r.macro_f1 != null ? (100 * r.macro_f1).toFixed(1) + '%' : '—'}</td><td>{r.latency_ms?.toFixed?.(0) ?? r.latency_ms}</td><td>{r.cost_per_1k_usd != null ? usd(r.cost_per_1k_usd, 3) : '—'}</td></tr>)}</tbody></table>
            {ft.notes && <p className="muted">{ft.notes}</p>}
          </>)}
      </div>
    </>
  );
}

export function Knowledge({ isAdmin }: { isAdmin: boolean }) {
  const { d, load } = useData<any[]>('/api/knowledge');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}><h1>Knowledge base</h1>
        {isAdmin && <button disabled={busy} onClick={async () => { setBusy(true); await api('/api/knowledge/reindex', { method: 'POST', body: {} }); setBusy(false); load(); }}>{busy ? 'Re-indexing…' : 'Re-index documents'}</button>}</div>
      <p className="muted">{d?.length ?? 0} documents (PDF policies, HTML help pages, CSV tables, Markdown), {d?.reduce((s, x) => s + x.chunks, 0) ?? 0} chunks. Search = Postgres full-text + pgvector, fused with RRF and reranked.</p>
      <div className="card"><table><thead><tr><th>Title</th><th>Type</th><th>File</th><th>Chunks</th></tr></thead>
        <tbody>{(d ?? []).map((x) => <tr key={x.id}><td>{x.title}</td><td><span className="badge">{x.doc_type}</span></td><td className="muted">{x.source}</td><td>{x.chunks}</td></tr>)}</tbody></table></div>
    </>
  );
}

export function Ops() {
  const { d, load } = useData<any>('/api/jobs');
  const s = useData<any>('/api/settings');
  const r = useData<any>('/api/reports/last');
  const [msg, setMsg] = useState('');
  return (
    <>
      <h1>Operations</h1>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
        <div className="card"><h2>Settings</h2>
          {s.d && <>
            <div className="muted">Model {s.d.model} · fast {s.d.fastModel} · embeddings {s.d.embeddings} · reranker {s.d.reranker} · auto-refund limit £{s.d.autoRefundLimitGbp}</div>
            <div className="row" style={{ marginTop: 10 }}>Human review:
              {['AUTO', 'SMART', 'REVIEW'].map((m) => <button key={m} className={s.d.reviewMode === m ? 'primary' : ''} onClick={async () => { await api('/api/settings', { method: 'PUT', body: { reviewMode: m } }); s.load(); }}>{m}</button>)}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>AUTO sends everything · SMART holds low-confidence replies · REVIEW holds every reply.</div>
            <div style={{ marginTop: 12 }}><button className="danger" onClick={async () => { if (!confirm('Delete all conversations, refunds and feedback and restore the demo orders?')) return; await api('/api/admin/reset', { method: 'POST', body: {} }); setMsg('Demo data reset.'); load(); }}>Reset demo data</button></div></>}
        </div>
        <div className="card"><h2>Daily management report</h2>
          <button onClick={async () => { await api('/api/reports/run', { method: 'POST', body: {} }); setMsg('Queued — refresh in a few seconds.'); setTimeout(() => r.load(), 3000); }}>Send report now</button> <span className="muted">{msg}</span>
          {r.d && <><div className="muted" style={{ marginTop: 8 }}>Last sent {ago(r.d.at)}</div><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{r.d.text}</pre></>}
        </div>
        <div className="card"><h2>Background jobs</h2>
          <table><tbody>{(d?.counts ?? []).map((c: any, i: number) => <tr key={i}><td>{c.type}</td><td><span className={`badge ${c.status}`}>{c.status}</span></td><td>{c.n}</td></tr>)}</tbody></table>
          <h2 style={{ marginTop: 12 }}>Recent failures (retried automatically)</h2>
          <table><tbody>{(d?.recent_failures ?? []).map((j: any) => <tr key={j.id}><td>#{j.id} {j.type}<div className="muted">{j.attempts} attempts · {ago(j.updated_at)}</div></td><td className="muted" style={{ fontSize: 12 }}>{j.last_error}</td>
            <td><span className={`badge ${j.status}`}>{j.status}</span>{j.status === 'dead' && <button onClick={async () => { await api(`/api/jobs/${j.id}/retry`, { method: 'POST', body: {} }); load(); }}>Retry</button>}</td></tr>)}</tbody></table>
        </div>
      </div>
    </>
  );
}
