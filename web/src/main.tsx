import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, auth } from './api';
import { Inbox } from './Inbox';
import { Analytics, Escalations, Refunds, Learning, Evals, Knowledge, Ops } from './Pages';
import { CustomerChat } from './Chat';

function useHash() {
  const [h, setH] = useState(location.hash || '#/inbox');
  useEffect(() => { const f = () => setH(location.hash || '#/inbox'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

function Login() {
  const [email, setEmail] = useState('admin@demo.shop');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try { const r = await api('/api/auth/login', { body: { email, password } }); auth.set(r); location.hash = '#/inbox'; }
    catch (x) { setErr((x as Error).message); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Brightbasket AI Ops</h1>
        <div className="muted">Sign in to the customer-operations dashboard.</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
        {err && <div className="err">{err}</div>}
        <button className="primary">Sign in</button>
        <div className="muted" style={{ fontSize: 12 }}>Demo: admin@demo.shop / admin123 (admin) · agent@demo.shop / agent123 (agent)</div>
        <a href="#/chat">Open the customer chat →</a>
      </form>
    </div>
  );
}

const NAV: [string, string, ('admin' | 'agent')[]][] = [
  ['#/inbox', 'Conversations', ['admin', 'agent']], ['#/escalations', 'Escalations', ['admin', 'agent']], ['#/refunds', 'Refunds', ['admin', 'agent']],
  ['#/analytics', 'Analytics', ['admin', 'agent']], ['#/learning', 'Learning loop', ['admin', 'agent']], ['#/evals', 'Evals & fine-tuning', ['admin', 'agent']],
  ['#/knowledge', 'Knowledge base', ['admin', 'agent']], ['#/ops', 'Operations', ['admin']],
];

function Shell() {
  const hash = useHash();
  const a = auth.get();
  if (hash.startsWith('#/chat')) return <CustomerChat />;
  if (!a || hash === '#/login') return <Login />;
  const page = hash.split('/')[1];
  const id = Number(hash.split('/')[2]) || undefined;
  return (
    <div className="layout">
      <nav className="side">
        <div className="logo">Brightbasket<small>AI customer operations</small></div>
        {NAV.filter((n) => n[2].includes(a.user.role)).map(([href, label]) => (
          <a key={href} href={href} className={hash.startsWith(href) || (page === 'conversations' && href === '#/inbox') ? 'active' : ''}>{label}</a>
        ))}
        <a href="#/chat" target="_blank" rel="noreferrer">Customer chat ↗</a>
        <div className="me">{a.user.name} · {a.user.role}<br /><a href="#/login" onClick={() => auth.set(null)} style={{ padding: 0 }}>Sign out</a></div>
      </nav>
      <main className="main">
        {(page === 'inbox' || page === 'conversations') && <Inbox selectedId={id} />}
        {page === 'escalations' && <Escalations />}
        {page === 'refunds' && <Refunds isAdmin={a.user.role === 'admin'} />}
        {page === 'analytics' && <Analytics />}
        {page === 'learning' && <Learning isAdmin={a.user.role === 'admin'} />}
        {page === 'evals' && <Evals />}
        {page === 'knowledge' && <Knowledge isAdmin={a.user.role === 'admin'} />}
        {page === 'ops' && <Ops />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Shell /></StrictMode>);
