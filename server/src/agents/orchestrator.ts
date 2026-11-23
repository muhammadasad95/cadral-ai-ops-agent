// Orchestrator: the single entry point for every inbound customer message, whatever the channel.
// persist -> load shared memory -> route -> specialist agent -> review policy -> deliver.
import { randomUUID } from 'node:crypto';
import type { App } from '../core/context.js';
import { trace } from '../core/context.js';
import { loadMemory } from './memory.js';
import { route } from './router.js';
import { supportAgent } from './support.js';
import { ordersAgent } from './orders.js';
import { escalationAgent } from './escalation.js';
import { enqueue } from '../jobs/queue.js';
import { config } from '../config.js';

export type Channel = 'web' | 'telegram' | 'email';
export type Identity = { email?: string; telegramChatId?: string; webSession?: string; name?: string };

export async function findOrCreateCustomer(app: App, id: Identity) {
  const db = app.db;
  let c = id.email ? await db.one('SELECT * FROM customers WHERE lower(email) = lower($1)', [id.email]) : undefined;
  if (!c && id.telegramChatId) c = await db.one('SELECT * FROM customers WHERE telegram_chat_id = $1', [id.telegramChatId]);
  if (!c && id.webSession) c = await db.one('SELECT * FROM customers WHERE web_session = $1', [id.webSession]);
  if (!c) c = await db.one('INSERT INTO customers (name, email, telegram_chat_id, web_session) VALUES ($1,$2,$3,$4) RETURNING *', [id.name ?? null, id.email ?? null, id.telegramChatId ?? null, id.webSession ?? null]);
  else if (id.telegramChatId && !c.telegram_chat_id) await db.query('UPDATE customers SET telegram_chat_id = $2 WHERE id = $1', [c.id, id.telegramChatId]);
  return c!;
}

export async function openConversation(app: App, customerId: number, channel: Channel, subject?: string) {
  const c = await app.db.one(`SELECT * FROM conversations WHERE customer_id = $1 AND channel = $2 AND status <> 'resolved'
    AND updated_at > now() - interval '24 hours' ORDER BY id DESC LIMIT 1`, [customerId, channel]);
  return c ?? (await app.db.one(`INSERT INTO conversations (customer_id, channel, subject) VALUES ($1,$2,$3) RETURNING *`, [customerId, channel, subject ?? null]))!;
}

/** Store the inbound message first, so nothing is lost even if every downstream API is down. */
export async function receive(app: App, channel: Channel, identity: Identity, text: string, subject?: string) {
  const customer = await findOrCreateCustomer(app, identity);
  const conv = await openConversation(app, customer.id, channel, subject);
  const msg = await app.db.one(`INSERT INTO messages (conversation_id, role, content, status) VALUES ($1,'customer',$2,'received') RETURNING *`, [conv.id, text.slice(0, 4000)]);
  await app.db.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conv.id]);
  app.bus.publish({ type: 'message', conversationId: conv.id, message: msg });
  return { customer, conversation: conv, message: msg! };
}

/** Run the agents for a stored customer message. Safe to retry (idempotent per customer message). */
export async function respond(app: App, customerMessageId: number, opts: { onToken?: (t: string) => void } = {}) {
  const db = app.db;
  const existing = await db.one(`SELECT * FROM messages WHERE reply_to = $1 AND role = 'assistant'`, [customerMessageId]);
  if (existing) return existing;
  const cm = (await db.one(`SELECT m.*, c.customer_id, c.channel, c.status AS conv_status, c.handled_by_human FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1`, [customerMessageId]))!;
  const ctx = { conversationId: cm.conversation_id as number, messageId: cm.id as number };

  // A human has taken over this conversation: the AI stays quiet and only drafts nothing.
  if (cm.handled_by_human) { await trace(app, { ...ctx, agent: 'router', step: 'skipped', detail: { reason: 'human agent has taken over this conversation' } }); return null; }

  const t0 = Date.now();
  const mem = await loadMemory(db, cm.conversation_id, cm.customer_id);
  const r = await route(app, mem, cm.content, ctx);
  await trace(app, { ...ctx, agent: 'router', step: 'route', detail: r });

  let reply;
  if (r.agent === 'escalation') reply = await escalationAgent(app, mem, cm.content, r, ctx);
  else if (r.agent === 'orders') reply = await ordersAgent(app, mem, cm.content, ctx);
  else reply = await supportAgent(app, mem, cm.content, ctx, opts.onToken);

  // Review policy (human in the loop).
  let reviewReason: string | undefined;
  if (config.reviewMode === 'REVIEW') reviewReason = 'review mode: every reply is approved by a human';
  else if (config.reviewMode === 'SMART') reviewReason = reply.needsReview ?? (r.confidence < 0.5 ? `router unsure (confidence ${r.confidence})` : undefined);
  if (r.agent === 'escalation') reviewReason = undefined; // the holding message always goes out immediately

  const status = reviewReason ? 'pending_review' : 'sent';
  const msg = (await db.one(`INSERT INTO messages (conversation_id, role, content, agent, status, review_reason, citations, reply_to, sent_at)
    VALUES ($1,'assistant',$2,$3,$4,$5,$6,$7, CASE WHEN $4 = 'sent' THEN now() ELSE NULL END) RETURNING *`,
    [cm.conversation_id, reply.text, r.agent, status, reviewReason ?? null, JSON.stringify(reply.citations), cm.id]))!;
  await db.query(`UPDATE messages SET status = 'sent' WHERE id = $1`, [cm.id]);
  await db.query(`UPDATE traces SET message_id = $2 WHERE message_id = $1 AND conversation_id = $3`, [cm.id, msg.id, cm.conversation_id]);
  if (r.agent !== 'escalation') await db.query(`UPDATE conversations SET status = CASE WHEN status = 'escalated' THEN status ELSE 'open' END, updated_at = now() WHERE id = $1`, [cm.conversation_id]);
  await trace(app, { conversationId: cm.conversation_id, messageId: msg.id, agent: r.agent, step: 'reply', detail: { status, review_reason: reviewReason, ms: Date.now() - t0, citations: reply.citations.length } });

  if ((reply as any).approvalNeeded) await enqueue(db, 'slack_alert', { kind: 'refund_approval', conversationId: cm.conversation_id, text: reply.text });
  if (status === 'sent') await deliver(app, msg.id);
  else app.bus.publish({ type: 'message', conversationId: cm.conversation_id, message: msg });
  return msg;
}

/** Push a message to the customer's channel. Web goes over the live bus; Telegram and email go through the retrying job queue. */
export async function deliver(app: App, messageId: number) {
  const m = (await app.db.one(`SELECT m.*, c.channel, c.subject, cu.email, cu.telegram_chat_id FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN customers cu ON cu.id = c.customer_id WHERE m.id = $1`, [messageId]))!;
  app.bus.publish({ type: 'message', conversationId: m.conversation_id, message: m });
  if (m.channel === 'telegram' && m.telegram_chat_id) await enqueue(app.db, 'send_telegram', { chatId: m.telegram_chat_id, text: m.content, messageId });
  if (m.channel === 'email' && m.email) await enqueue(app.db, 'send_email', { to: m.email, subject: `Re: ${m.subject ?? 'Your Brightbasket enquiry'}`, text: m.content, messageId });
}

/** Full pipeline with a safety net: if the AI step fails after its own retries, the job queue retries it later. */
export async function handleInbound(app: App, channel: Channel, identity: Identity, text: string, opts: { subject?: string; onToken?: (t: string) => void } = {}) {
  const { conversation, message } = await receive(app, channel, identity, text, opts.subject);
  try {
    const reply = await respond(app, message.id, { onToken: opts.onToken });
    return { conversationId: conversation.id, customerMessageId: message.id, reply };
  } catch (e) {
    await trace(app, { conversationId: conversation.id, messageId: message.id, agent: 'system', step: 'error', detail: { error: (e as Error).message, action: 'queued for retry' } });
    await enqueue(app.db, 'respond', { messageId: message.id }, { delayMs: 5000 });
    await enqueue(app.db, 'slack_alert', { kind: 'error', conversationId: conversation.id, error: (e as Error).message });
    return { conversationId: conversation.id, customerMessageId: message.id, reply: null, queued: true };
  }
}

export const newWebSession = () => randomUUID();
