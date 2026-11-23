// Self-improving loop.
//  1. Every approve / edit / reject on the dashboard is stored as feedback (with an embedding of the customer message).
//  2. At answer time, the most similar past corrections are injected as examples ("this is how a human fixed it").
//  3. After enough new corrections, an LLM distils them into short reusable rules (learned_rules) that go into every prompt.
//  4. All feedback can be exported as a JSONL fine-tuning dataset.
import type { App } from '../core/context.js';
import { vec } from '../db/index.js';
import { embedOne } from '../rag/embed.js';
import { RULES_SYSTEM } from './prompts.js';
import { parseJson } from '../llm/provider.js';

export async function recordFeedback(app: App, f: { messageId: number; action: 'approved' | 'edited' | 'rejected'; corrected?: string; note?: string; userEmail?: string }) {
  const m = await app.db.one(`SELECT m.*, (SELECT content FROM messages c WHERE c.id = m.reply_to) AS customer_text FROM messages m WHERE m.id = $1`, [f.messageId]);
  if (!m) throw new Error('message not found');
  const customerText = m.customer_text ?? '';
  const emb = customerText ? vec(await embedOne(customerText)) : null;
  await app.db.query(`INSERT INTO feedback (message_id, action, customer_text, original_reply, corrected_reply, note, agent, embedding, user_email)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [f.messageId, f.action, customerText, m.content, f.corrected ?? null, f.note ?? null, m.agent, emb, f.userEmail ?? null]);
  if (f.action !== 'approved') await app.db.query(`INSERT INTO jobs (type, payload) VALUES ('distil_rules', $1)`, [JSON.stringify({ agent: m.agent })]);
}

export async function similarCorrections(app: App, agent: string, customerText: string, k = 2) {
  const rows = await app.db.query(
    `SELECT customer_text, original_reply, corrected_reply, note, action, 1 - (embedding <=> $2::vector) AS sim
     FROM feedback WHERE agent = $1 AND action IN ('edited','rejected') AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector LIMIT $3`, [agent, vec(await embedOne(customerText)), k]);
  return rows.filter((r) => Number(r.sim) > 0.6);
}

export async function guidanceBlock(app: App, agent: string, customerText: string) {
  const rules = await app.db.query(`SELECT rule FROM learned_rules WHERE agent = $1 AND active ORDER BY id DESC LIMIT 8`, [agent]);
  const ex = await similarCorrections(app, agent, customerText);
  const parts: string[] = [];
  if (rules.length) parts.push('Rules learned from human reviewers (follow them):\n' + rules.map((r) => `- ${r.rule}`).join('\n'));
  if (ex.length) parts.push('Similar past replies that a human corrected (learn from them):\n' + ex.map((e) =>
    `Customer: ${e.customer_text}\nAI wrote: ${e.original_reply}\n${e.action === 'edited' ? `Human changed it to: ${e.corrected_reply}` : `Human rejected it${e.note ? ': ' + e.note : ''}`}`).join('\n---\n'));
  return { text: parts.join('\n\n'), rules: rules.length, examples: ex.length };
}

// Job handler: distil recent corrections into rules once 3+ new ones exist for an agent.
export async function distilRules(app: App, agent: string) {
  const last = await app.db.one(`SELECT coalesce(max(id),0)::int AS id FROM learned_rules WHERE agent = $1`, [agent]);
  const lastIds = last!.id ? (await app.db.one(`SELECT source_feedback_ids FROM learned_rules WHERE id = $1`, [last!.id]))!.source_feedback_ids : [];
  const maxSeen = lastIds.length ? Math.max(...lastIds) : 0;
  const fresh = await app.db.query(`SELECT id, customer_text, original_reply, corrected_reply, note, action FROM feedback
    WHERE agent = $1 AND action IN ('edited','rejected') AND id > $2 ORDER BY id LIMIT 10`, [agent, maxSeen]);
  if (fresh.length < 3) return { skipped: true, pending: fresh.length };
  const r = await app.llm.chat({ purpose: 'rules', fast: true, json: true, messages: [
    { role: 'system', content: RULES_SYSTEM },
    { role: 'user', content: fresh.map((f) => `Customer: ${f.customer_text}\nAI: ${f.original_reply}\nHuman: ${f.action === 'edited' ? f.corrected_reply : 'REJECTED ' + (f.note ?? '')}`).join('\n\n') },
  ] });
  const rules: string[] = parseJson(r.content, { rules: [] as string[] }).rules ?? [];
  for (const rule of rules.slice(0, 3)) {
    await app.db.query(`INSERT INTO learned_rules (agent, rule, source_feedback_ids) VALUES ($1,$2,$3)`, [agent, rule, fresh.map((f) => f.id)]);
  }
  return { added: rules.length };
}

export async function exportDataset(app: App) {
  const rows = await app.db.query(`SELECT agent, action, customer_text, original_reply, corrected_reply FROM feedback WHERE action IN ('approved','edited') ORDER BY id`);
  return rows.map((r) => JSON.stringify({ messages: [
    { role: 'system', content: `You are the ${r.agent} agent for Brightbasket Home.` },
    { role: 'user', content: r.customer_text },
    { role: 'assistant', content: r.action === 'edited' ? r.corrected_reply : r.original_reply },
  ] })).join('\n') + (rows.length ? '\n' : '');
}
