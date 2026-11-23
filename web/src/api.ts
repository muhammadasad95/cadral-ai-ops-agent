// Tiny API client with JWT handling and an SSE helper.
export type User = { email: string; name: string; role: 'admin' | 'agent' };

const KEY = 'bb_auth';
export const auth = {
  get: (): { token: string; user: User } | null => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set: (v: { token: string; user: User } | null) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ } },
};

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const a = auth.get();
  const r = await fetch(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(a ? { authorization: `Bearer ${a.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401 && a) { auth.set(null); location.hash = '#/login'; }
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data as any)?.error ?? `HTTP ${r.status}`);
  return data as T;
}

/** POST that returns Server-Sent Events (used by the customer chat for token streaming). */
export async function postStream(path: string, body: any, on: (event: string, data: any) => void) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.body) throw new Error('no stream');
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = chunk.match(/^event: (.+)$/m)?.[1] ?? 'message';
      const d = chunk.match(/^data: (.+)$/m)?.[1];
      if (d) on(ev, JSON.parse(d));
    }
  }
}

export function live(on: (e: any) => void) {
  const a = auth.get();
  if (!a) return () => {};
  const es = new EventSource(`/api/live?token=${encodeURIComponent(a.token)}`);
  for (const t of ['message', 'trace', 'conversation', 'escalation']) es.addEventListener(t, (e) => on(JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}

export const money = (n: any) => `£${Number(n ?? 0).toFixed(2)}`;
export const usd = (n: any, d = 4) => `$${Number(n ?? 0).toFixed(d)}`;
export const ago = (s: string) => {
  const sec = (Date.now() - new Date(s).getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(s).toLocaleDateString('en-GB');
};
