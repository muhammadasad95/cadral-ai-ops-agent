// Escalation agent: writes a handover summary, opens an escalation, alerts Slack and tells the customer a human is coming.
import type { App } from '../core/context.js';
import { trace } from '../core/context.js';
import type { Memory } from './memory.js';
import { ESCALATION_SYSTEM } from './prompts.js';
import { parseJson } from '../llm/provider.js';
import { enqueue } from '../jobs/queue.js';
import { SHOP } from '../../../data/kb.js';
import type { Route } from './router.js';
import type { AgentReply } from './support.js';

export function inBusinessHours(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', hour12: false })
    .formatToParts(d).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday); const h = Number(parts.hour) % 24;
  return (day >= 1 && day <= 5 && h >= 8 && h < 18) || (day === 6 && h >= 9 && h < 13);
}

export async function escalationAgent(app: App, mem: Memory, text: string, routeInfo: Route, ctx: { conversationId: number; messageId: number }): Promise<AgentReply> {
  const transcript = [...mem.history.map((h) => `${h.role}: ${h.content}`)].join('\n');
  const res = await app.llm.chat({ purpose: 'escalation', fast: true, json: true, ctx, messages: [
    { role: 'system', content: ESCALATION_SYSTEM },
    { role: 'user', content: `${mem.profileText}\n\nRouter said: ${routeInfo.reason} (sentiment ${routeInfo.sentiment}, risk ${routeInfo.risk})\n\nTranscript:\n${transcript}` },
  ] });
  const h = parseJson(res.content, { summary: `Customer needs help: ${text.slice(0, 200)}`, reason: 'other', risk: routeInfo.risk, suggested_action: 'Review and contact the customer.' });
  const risk = Math.max(Number(h.risk) || 0, routeInfo.risk);
  const esc = await app.db.one(`INSERT INTO escalations (conversation_id, reason, risk_score, summary) VALUES ($1,$2,$3,$4) RETURNING *`,
    [ctx.conversationId, h.reason, risk.toFixed(2), `${h.summary} Suggested action: ${h.suggested_action}`]);
  await app.db.query(`UPDATE conversations SET status = 'escalated', updated_at = now() WHERE id = $1`, [ctx.conversationId]);
  await enqueue(app.db, 'slack_alert', { kind: 'escalation', escalationId: esc!.id, conversationId: ctx.conversationId, customer: mem.customer.name ?? mem.customer.email, reason: h.reason, risk, summary: h.summary });
  await trace(app, { ...ctx, agent: 'escalation', step: 'handover', detail: { escalation_id: esc!.id, ...h, risk } });
  app.bus.publish({ type: 'escalation', conversationId: ctx.conversationId, escalation: esc });

  const when = inBusinessHours() ? 'within the next hour' : `when we open (${SHOP.hours.split('.')[0]})`;
  const safety = h.reason === 'safety' ? 'For your safety, please stop using the item and unplug it if it is electrical. ' : '';
  const name = mem.customer.name ? ` ${mem.customer.name.split(' ')[0]}` : '';
  return { text: `I'm really sorry about this${name}. ${safety}I've passed your conversation to a member of our customer care team with a full summary, so you won't need to repeat yourself. They will reply here ${when}.`, citations: [], resolved: false };
}
