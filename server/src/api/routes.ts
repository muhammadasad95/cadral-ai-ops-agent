// HTTP API: public web chat (streaming), staff auth with roles, dashboard endpoints.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { App, LiveEvent } from '../core/context.js';
import { handleInbound, deliver, findOrCreateCustomer } from '../agents/orchestrator.js';
import { recordFeedback, distilRules, exportDataset } from '../agents/learning.js';
import { analytics } from '../analytics.js';
import { enqueue } from '../jobs/queue.js';
import { ingestDirectory } from '../rag/ingest.js';
import { embeddingMode } from '../rag/embed.js';
import { rerankerMode } from '../rag/search.js';
import { modelName } from '../llm/provider.js';
import { config } from '../config.js';
import { CUSTOMERS } from '../../../data/shop.js';
import { seed } from '../db/seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
type User = { email: string; name: string; role: 'admin' | 'agent' };

export function registerRoutes(f: FastifyInstance, app: App) {
  const db = app.db;

  const auth = (roles: User['role'][] = ['admin', 'agent']) => async (req: FastifyRequest, rep: FastifyReply) => {
    try {
      const q = (req.query as any)?.token;
      if (q && !req.headers.authorization) req.headers.authorization = `Bearer ${q}`;
      await req.jwtVerify();
      if (!roles.includes((req.user as User).role)) return rep.code(403).send({ error: 'forbidden for your role' });
    } catch { return rep.code(401).send({ error: 'unauthorised' }); }
  };
  const user = (req: FastifyRequest) => req.user as User;

  f.get('/api/health', async () => ({ ok: true, db: db.kind, llm: modelName(), embeddings: embeddingMode(), reranker: rerankerMode(), reviewMode: config.reviewMode }));

  // ---------------- public web chat ----------------
  f.get('/api/chat/demo-customers', async () => CUSTOMERS.map((c) => ({ name: c.name, email: c.email })));

  f.post('/api/chat/session', async (req) => {
    const body = z.object({ email: z.string().email().optional(), name: z.string().max(80).optional() }).parse(req.body ?? {});
    const session = randomUUID();
    const c = await findOrCreateCustomer(app, { email: body.email, name: body.name, webSession: session });
    await db.query('UPDATE customers SET web_session = $2 WHERE id = $1', [c.id, session]);
    return { session, customer: { name: c.name, email: c.email } };
  });

  f.get('/api/chat/history', async (req) => {
    const { session } = z.object({ session: z.string() }).parse(req.query);
    return db.query(`SELECT m.id, m.role, m.content, m.citations, m.created_at FROM messages m JOIN conversations c ON c.id = m.conversation_id
      JOIN customers cu ON cu.id = c.customer_id WHERE cu.web_session = $1 AND c.channel = 'web' AND m.status IN ('received','sent') ORDER BY m.id DESC LIMIT 50`, [session]).then((r) => r.reverse());
  });

  // Streams the reply as Server-Sent Events: "token" events while the model writes, then the final "message".
  f.post('/api/chat/message', async (req, rep) => {
    const { session, text } = z.object({ session: z.string(), text: z.string().min(1).max(2000) }).parse(req.body);
    const cu = await db.one('SELECT * FROM customers WHERE web_session = $1', [session]);
    if (!cu) return rep.code(401).send({ error: 'unknown session' });
    rep.hijack();
    rep.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (event: string, data: any) => rep.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const replyId = randomUUID();
    try {
      const r = await handleInbound(app, 'web', { webSession: session, email: cu.email ?? undefined }, text, {
        onToken: (t) => { send('token', { t }); app.bus.publish({ type: 'token', conversationId: -1, replyId, token: t }); },
      });
      const m = r.reply;
      if (!m) send('message', { content: (r as any).queued ? "Sorry, I'm having trouble right now. Your message is saved and we'll reply shortly." : 'A member of our team is handling this conversation and will reply here.', role: 'assistant' });
      else if (m.status === 'pending_review') send('message', { content: 'Thanks, a member of our team is checking my answer and will reply here in a moment.', role: 'assistant', pending: true });
      else send('message', { id: m.id, content: m.content, citations: m.citations, agent: m.agent, role: 'assistant' });
    } catch (e) {
      send('message', { content: 'Sorry, something went wrong. Please try again.', role: 'assistant', error: (e as Error).message });
    }
    rep.raw.end();
  });

  // Web chat can also receive later messages (human replies, approved drafts) via SSE.
  f.get('/api/chat/stream', async (req, rep) => {
    const { session } = z.object({ session: z.string() }).parse(req.query);
    const cu = await db.one('SELECT id FROM customers WHERE web_session = $1', [session]);
    if (!cu) return rep.code(401).send({ error: 'unknown session' });
    rep.hijack();
    rep.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const convIds = new Set((await db.query(`SELECT id FROM conversations WHERE customer_id = $1`, [cu.id])).map((r) => r.id));
    const on = async (e: LiveEvent) => {
      if (e.type !== 'message') return;
      if (!convIds.has(e.conversationId)) {
        const c = await db.one(`SELECT customer_id FROM conversations WHERE id = $1`, [e.conversationId]);
        if (c?.customer_id !== cu.id) return; convIds.add(e.conversationId);
      }
      const m = e.message;
      if ((m.role === 'human' || m.role === 'assistant') && m.status === 'sent') rep.raw.write(`event: message\ndata: ${JSON.stringify({ id: m.id, role: m.role, content: m.content, citations: m.citations })}\n\n`);
    };
    app.bus.on('event', on);
    const ping = setInterval(() => rep.raw.write(': ping\n\n'), 20000);
    req.raw.on('close', () => { app.bus.off('event', on); clearInterval(ping); });
  });

  // ---------------- auth ----------------
  f.post('/api/auth/login', async (req, rep) => {
    const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const u = await db.one('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    if (!u || !(await bcrypt.compare(password, u.password_hash))) return rep.code(401).send({ error: 'Wrong email or password' });
    const payload: User = { email: u.email, name: u.name, role: u.role };
    return { token: f.jwt.sign(payload, { expiresIn: '12h' }), user: payload };
  });
  f.get('/api/me', { preHandler: auth() }, async (req) => user(req));

  // ---------------- live dashboard feed ----------------
  f.get('/api/live', { preHandler: auth() }, async (req, rep) => {
    rep.hijack();
    rep.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const on = (e: LiveEvent) => rep.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    app.bus.on('event', on);
    const ping = setInterval(() => rep.raw.write(': ping\n\n'), 20000);
    req.raw.on('close', () => { app.bus.off('event', on); clearInterval(ping); });
  });

  // ---------------- conversations ----------------
  f.get('/api/conversations', { preHandler: auth() }, async (req) => {
    const { status, q } = z.object({ status: z.string().optional(), q: z.string().optional() }).parse(req.query);
    return db.query(`SELECT c.*, cu.name AS customer_name, cu.email AS customer_email,
        (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
        (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.status = 'pending_review') AS pending,
        (SELECT coalesce(sum(cost_usd),0)::float FROM llm_calls l WHERE l.conversation_id = c.id) AS cost_usd
      FROM conversations c JOIN customers cu ON cu.id = c.customer_id
      WHERE ($1::text IS NULL OR c.status = $1 OR ($1 = 'pending' AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.status = 'pending_review')))
        AND ($2::text IS NULL OR cu.name ILIKE '%' || $2 || '%' OR cu.email ILIKE '%' || $2 || '%')
      ORDER BY c.updated_at DESC LIMIT 200`, [status ?? null, q ?? null]);
  });

  f.get('/api/conversations/:id', { preHandler: auth() }, async (req, rep) => {
    const id = Number((req.params as any).id);
    const conv = await db.one(`SELECT c.*, cu.name AS customer_name, cu.email AS customer_email, cu.tier, cu.notes FROM conversations c JOIN customers cu ON cu.id = c.customer_id WHERE c.id = $1`, [id]);
    if (!conv) return rep.code(404).send({ error: 'not found' });
    const [messages, traces, orders, escalations, calls, refunds] = await Promise.all([
      db.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id`, [id]),
      db.query(`SELECT * FROM traces WHERE conversation_id = $1 ORDER BY id`, [id]),
      db.query(`SELECT id, status, total_gbp, refunded_gbp, created_at FROM orders WHERE customer_id = $1 ORDER BY created_at DESC`, [conv.customer_id]),
      db.query(`SELECT * FROM escalations WHERE conversation_id = $1 ORDER BY id`, [id]),
      db.query(`SELECT purpose, model, prompt_tokens, completion_tokens, cost_usd::float, latency_ms, ok, created_at FROM llm_calls WHERE conversation_id = $1 ORDER BY id`, [id]),
      db.query(`SELECT * FROM refunds WHERE conversation_id = $1 ORDER BY id`, [id]),
    ]);
    return { conversation: conv, messages, traces, orders, escalations, llm_calls: calls, refunds };
  });

  const msgAction = async (req: FastifyRequest) => {
    const id = Number((req.params as any).id);
    const m = await db.one(`SELECT * FROM messages WHERE id = $1 AND role = 'assistant'`, [id]);
    if (!m) throw Object.assign(new Error('message not found'), { statusCode: 404 });
    return m;
  };

  f.post('/api/messages/:id/approve', { preHandler: auth() }, async (req) => {
    const m = await msgAction(req);
    if (m.status === 'pending_review') { await db.query(`UPDATE messages SET status = 'sent', sent_at = now() WHERE id = $1`, [m.id]); await deliver(app, m.id); }
    await recordFeedback(app, { messageId: m.id, action: 'approved', userEmail: user(req).email });
    return { ok: true };
  });

  f.post('/api/messages/:id/edit', { preHandler: auth() }, async (req) => {
    const { content, note } = z.object({ content: z.string().min(1), note: z.string().optional() }).parse(req.body);
    const m = await msgAction(req);
    await recordFeedback(app, { messageId: m.id, action: 'edited', corrected: content, note, userEmail: user(req).email });
    if (m.status === 'pending_review') {
      await db.query(`UPDATE messages SET content = $2, status = 'sent', sent_at = now() WHERE id = $1`, [m.id, content]);
      await deliver(app, m.id);
    } else {
      // Already sent: send the corrected version as a follow-up from a human.
      const h = await db.one(`INSERT INTO messages (conversation_id, role, content, status, sent_at) VALUES ($1,'human',$2,'sent',now()) RETURNING id`, [m.conversation_id, `Correction: ${content}`]);
      await deliver(app, h!.id);
    }
    return { ok: true };
  });

  f.post('/api/messages/:id/reject', { preHandler: auth() }, async (req) => {
    const { note } = z.object({ note: z.string().optional() }).parse(req.body ?? {});
    const m = await msgAction(req);
    await db.query(`UPDATE messages SET status = 'rejected' WHERE id = $1 AND status = 'pending_review'`, [m.id]);
    await recordFeedback(app, { messageId: m.id, action: 'rejected', note, userEmail: user(req).email });
    app.bus.publish({ type: 'message', conversationId: m.conversation_id, message: { ...m, status: 'rejected' } });
    return { ok: true };
  });

  f.post('/api/conversations/:id/reply', { preHandler: auth() }, async (req) => {
    const id = Number((req.params as any).id);
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);
    const h = await db.one(`INSERT INTO messages (conversation_id, role, content, status, sent_at) VALUES ($1,'human',$2,'sent',now()) RETURNING id`, [id, content]);
    await db.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [id]);
    await deliver(app, h!.id);
    return { ok: true };
  });

  f.post('/api/conversations/:id/:action(takeover|release|resolve|reopen)', { preHandler: auth() }, async (req) => {
    const { id, action } = req.params as any;
    const sql = {
      takeover: `UPDATE conversations SET handled_by_human = true, updated_at = now() WHERE id = $1`,
      release: `UPDATE conversations SET handled_by_human = false, updated_at = now() WHERE id = $1`,
      resolve: `UPDATE conversations SET status = 'resolved', updated_at = now() WHERE id = $1`,
      reopen: `UPDATE conversations SET status = 'open', updated_at = now() WHERE id = $1`,
    }[action as 'takeover'];
    await db.query(sql, [Number(id)]);
    if (action === 'resolve') await db.query(`UPDATE escalations SET status = 'closed' WHERE conversation_id = $1`, [Number(id)]);
    if (action === 'takeover') await db.query(`UPDATE escalations SET status = 'taken' WHERE conversation_id = $1 AND status = 'open'`, [Number(id)]);
    app.bus.publish({ type: 'conversation', conversationId: Number(id), status: action });
    return { ok: true };
  });

  // ---------------- escalations & refunds ----------------
  f.get('/api/escalations', { preHandler: auth() }, async () => db.query(`SELECT e.*, cu.name AS customer_name, c.channel FROM escalations e
    JOIN conversations c ON c.id = e.conversation_id JOIN customers cu ON cu.id = c.customer_id ORDER BY (e.status = 'open') DESC, e.risk_score DESC, e.id DESC LIMIT 100`));

  f.get('/api/refunds', { preHandler: auth() }, async () => db.query(`SELECT r.*, o.total_gbp, cu.name AS customer_name FROM refunds r JOIN orders o ON o.id = r.order_id
    JOIN customers cu ON cu.id = o.customer_id ORDER BY (r.status = 'pending_approval') DESC, r.id DESC LIMIT 100`));

  f.post('/api/refunds/:id/:decision(approve|reject)', { preHandler: auth(['admin']) }, async (req, rep) => {
    const { id, decision } = req.params as any;
    const r = await db.one(`SELECT r.*, o.total_gbp, o.refunded_gbp FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.id = $1 AND r.status = 'pending_approval'`, [Number(id)]);
    if (!r) return rep.code(404).send({ error: 'no pending refund' });
    if (decision === 'approve') {
      const refunded = Number(r.refunded_gbp) + Number(r.amount_gbp);
      await db.query(`UPDATE orders SET refunded_gbp = $2, status = $3, updated_at = now() WHERE id = $1`, [r.order_id, refunded.toFixed(2), refunded >= Number(r.total_gbp) ? 'refunded' : 'partially_refunded']);
    }
    await db.query(`UPDATE refunds SET status = $2, decided_by = $3 WHERE id = $1`, [r.id, decision === 'approve' ? 'issued' : 'rejected', user(req).email]);
    if (r.conversation_id) {
      const text = decision === 'approve' ? `Good news: your refund of £${Number(r.amount_gbp).toFixed(2)} for order ${r.order_id} has been approved. It will reach your original payment method in 5 to 7 working days.`
        : `We've reviewed your refund request for order ${r.order_id} and can't approve it as requested. A member of our team will explain the options.`;
      const h = await db.one(`INSERT INTO messages (conversation_id, role, content, status, sent_at) VALUES ($1,'human',$2,'sent',now()) RETURNING id`, [r.conversation_id, text]);
      await deliver(app, h!.id);
    }
    return { ok: true };
  });

  // ---------------- analytics, knowledge, learning, evals ----------------
  f.get('/api/analytics', { preHandler: auth() }, async (req) => analytics(db, Number((req.query as any).days ?? 7)));

  f.get('/api/knowledge', { preHandler: auth() }, async () => db.query(`SELECT d.*, count(c.id)::int AS chunks FROM documents d LEFT JOIN chunks c ON c.document_id = d.id GROUP BY d.id ORDER BY d.doc_type, d.title`));
  f.post('/api/knowledge/reindex', { preHandler: auth(['admin']) }, async () => ingestDirectory(db, join(root, 'data/docs')));

  f.get('/api/learning', { preHandler: auth() }, async () => ({
    rules: await db.query(`SELECT * FROM learned_rules ORDER BY id DESC`),
    feedback: await db.query(`SELECT id, message_id, action, agent, customer_text, original_reply, corrected_reply, note, user_email, created_at FROM feedback ORDER BY id DESC LIMIT 100`),
  }));
  f.post('/api/learning/rules/:id/toggle', { preHandler: auth(['admin']) }, async (req) => {
    await db.query(`UPDATE learned_rules SET active = NOT active WHERE id = $1`, [Number((req.params as any).id)]); return { ok: true };
  });
  f.post('/api/learning/distil', { preHandler: auth(['admin']) }, async () => ({ support: await distilRules(app, 'support'), orders: await distilRules(app, 'orders') }));
  f.get('/api/learning/export.jsonl', { preHandler: auth(['admin']) }, async (_req, rep) => {
    rep.header('content-type', 'application/jsonl').header('content-disposition', 'attachment; filename="feedback-finetune.jsonl"');
    return exportDataset(app);
  });

  f.get('/api/evals', { preHandler: auth() }, async () => {
    const ft = join(root, 'finetune/results.json');
    return { runs: await db.query(`SELECT id, score::float, passed, total, model, created_at, details FROM eval_runs ORDER BY id DESC LIMIT 10`),
      finetune: existsSync(ft) ? JSON.parse(readFileSync(ft, 'utf8')) : null };
  });

  // ---------------- operations ----------------
  // External scheduler hook (GitHub Actions cron) so the report still goes out if the free host was asleep at 8am.
  f.post('/api/reports/cron', async (req, rep) => {
    const key = (req.headers['x-cron-key'] as string) ?? (req.query as any)?.key;
    if (!config.cronKey || key !== config.cronKey) return rep.code(401).send({ error: 'bad key' });
    const today = new Date().toISOString().slice(0, 10);
    const last = await db.one(`SELECT value FROM kv WHERE key = 'last_report'`);
    if (last && String(last.value.at).slice(0, 10) === today) return { skipped: 'already sent today' };
    await enqueue(db, 'daily_report', {}); return { queued: true };
  });
  f.post('/api/reports/run', { preHandler: auth(['admin']) }, async () => { await enqueue(db, 'daily_report', {}); return { queued: true }; });
  f.get('/api/reports/last', { preHandler: auth() }, async () => (await db.one(`SELECT value FROM kv WHERE key = 'last_report'`))?.value ?? null);
  f.get('/api/jobs', { preHandler: auth(['admin']) }, async () => ({
    counts: await db.query(`SELECT type, status, count(*)::int AS n FROM jobs GROUP BY 1,2 ORDER BY 1,2`),
    recent_failures: await db.query(`SELECT id, type, status, attempts, last_error, updated_at FROM jobs WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 20`),
  }));
  f.post('/api/jobs/:id/retry', { preHandler: auth(['admin']) }, async (req) => {
    await db.query(`UPDATE jobs SET status = 'queued', attempts = 0, run_at = now() WHERE id = $1`, [Number((req.params as any).id)]); return { ok: true };
  });
  f.post('/api/admin/reset', { preHandler: auth(['admin']) }, async () => {
    await db.exec(`DELETE FROM feedback; DELETE FROM learned_rules; DELETE FROM traces; DELETE FROM llm_calls; DELETE FROM escalations;
      DELETE FROM refunds; DELETE FROM messages; DELETE FROM conversations; DELETE FROM jobs; DELETE FROM orders; DELETE FROM kv WHERE key = 'last_report';`);
    return seed(db, { force: true });
  });
  f.get('/api/settings', { preHandler: auth() }, async () => ({ reviewMode: config.reviewMode, autoRefundLimitGbp: config.policy.autoRefundLimitGbp, model: modelName(), fastModel: modelName(true), embeddings: embeddingMode(), reranker: rerankerMode() }));
  f.put('/api/settings', { preHandler: auth(['admin']) }, async (req) => {
    const b = z.object({ reviewMode: z.enum(['AUTO', 'SMART', 'REVIEW']) }).parse(req.body);
    config.reviewMode = b.reviewMode;
    await db.query(`INSERT INTO kv (key, value) VALUES ('review_mode', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(b.reviewMode)]);
    return { ok: true };
  });
}
