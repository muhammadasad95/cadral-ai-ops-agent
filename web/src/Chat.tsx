// Customer-facing web chat: pick a demo customer (or chat as a guest), streamed replies with citations.
import { useEffect, useRef, useState } from 'react';
import { api, postStream } from './api';

type M = { role: string; content: string; citations?: any[]; pending?: boolean };
const SKEY = 'bb_chat_session';

export function CustomerChat() {
  const [customers, setCustomers] = useState<{ name: string; email: string }[]>([]);
  const [session, setSession] = useState<string | null>(() => { try { return localStorage.getItem(SKEY); } catch { return null; } });
  const [who, setWho] = useState('');
  const [msgs, setMsgs] = useState<M[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { api('/api/chat/demo-customers').then(setCustomers).catch(() => {}); }, []);
  useEffect(() => {
    if (!session) return;
    api(`/api/chat/history?session=${session}`).then((h: any[]) => setMsgs(h.map((m) => ({ role: m.role, content: m.content, citations: m.citations })))).catch(() => setSession(null));
    const es = new EventSource(`/api/chat/stream?session=${session}`);
    es.addEventListener('message', (e) => {
      const m = JSON.parse((e as MessageEvent).data);
      if (m.role === 'human') setMsgs((x) => [...x.filter((y) => !y.pending), { role: 'human', content: m.content }]);
      if (m.role === 'assistant') setMsgs((x) => (x.some((y) => y.content === m.content) ? x : [...x.filter((y) => !y.pending), { role: 'assistant', content: m.content, citations: m.citations }]));
    });
    return () => es.close();
  }, [session]);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [msgs]);

  const start = async (email?: string) => {
    const r = await api('/api/chat/session', { body: email ? { email } : {} });
    try { localStorage.setItem(SKEY, r.session); } catch { /* ignore */ }
    setSession(r.session); setWho(r.customer.name ?? 'Guest'); setMsgs([]);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim(); if (!t || !session || busy) return;
    setText(''); setBusy(true);
    setMsgs((x) => [...x, { role: 'customer', content: t }, { role: 'assistant', content: '' }]);
    try {
      await postStream('/api/chat/message', { session, text: t }, (ev, d) => {
        setMsgs((x) => {
          const y = [...x]; const last = { ...y[y.length - 1] };
          if (ev === 'token') last.content += d.t;
          if (ev === 'message') { last.content = d.content; last.citations = d.citations; last.pending = d.pending; }
          y[y.length - 1] = last; return y;
        });
      });
    } finally { setBusy(false); }
  };

  if (!session) return (
    <div className="chat-page">
      <h1>Brightbasket Home — customer chat (demo)</h1>
      <p className="muted">Choose a demo customer to see order tools in action, or chat as a guest for general questions.</p>
      <div className="card grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {customers.map((c) => <button key={c.email} onClick={() => start(c.email)} style={{ textAlign: 'left' }}><b>{c.name}</b><div className="muted" style={{ fontSize: 12 }}>{c.email}</div></button>)}
        <button onClick={() => start()}>Continue as guest</button>
      </div>
    </div>
  );

  return (
    <div className="chat-page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Brightbasket Home help</h1>
        <div className="muted">{who && `Signed in as ${who} · `}<a href="#/chat" onClick={() => { try { localStorage.removeItem(SKEY); } catch { /* ignore */ } setSession(null); }}>switch customer</a></div>
      </div>
      <div className="card chat-box" ref={box}>
        {!msgs.length && <div className="muted">Try: “Where is my order?”, “How long do refunds take?”, “My kettle arrived cracked”, “Do you deliver to Ireland?”</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role === 'customer' ? 'customer' : m.role === 'human' ? 'human' : 'assistant'}`} style={{ alignSelf: m.role === 'customer' ? 'flex-end' : 'flex-start' }}>
            {m.role === 'human' && <div className="meta">Customer care team</div>}
            {m.content || <span className="muted">…</span>}
            {!!m.citations?.length && <div className="cites">{m.citations.map((c: any) => <span className="cite" key={c.n}>[{c.n}] {c.title}</span>)}</div>}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={send} style={{ marginTop: 10, flexWrap: 'nowrap' }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your message…" autoFocus />
        <button className="primary" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
