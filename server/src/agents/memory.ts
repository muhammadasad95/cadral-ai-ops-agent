// Shared memory: every agent gets the same view of the conversation and the customer's history.
import type { Db } from '../db/index.js';
import type { Msg } from '../llm/provider.js';

export type Customer = { id: number; name: string | null; email: string | null; tier: string; notes: string };
export type Memory = {
  customer: Customer;
  history: { role: string; content: string; agent: string | null }[];
  profileText: string; // compact text block injected into prompts
};

export async function loadMemory(db: Db, conversationId: number, customerId: number): Promise<Memory> {
  const customer = (await db.one<Customer>('SELECT id, name, email, tier, notes FROM customers WHERE id = $1', [customerId]))!;
  const history = (await db.query(
    `SELECT role, content, agent FROM messages WHERE conversation_id = $1 AND status IN ('received','sent') ORDER BY id DESC LIMIT 12`, [conversationId])).reverse();
  const orders = await db.query(
    `SELECT id, status, total_gbp, created_at::date AS placed FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 5`, [customerId]);
  const past = await db.query(
    `SELECT c.id, c.channel, c.status, c.created_at::date AS d, e.summary FROM conversations c
     LEFT JOIN escalations e ON e.conversation_id = c.id
     WHERE c.customer_id = $1 AND c.id <> $2 ORDER BY c.id DESC LIMIT 3`, [customerId, conversationId]);
  const profileText = [
    `Customer: ${customer.name ?? 'unknown'}${customer.email ? ` <${customer.email}>` : ''}, tier: ${customer.tier}${customer.tier === 'plus' ? ' (Brightbasket Plus member: free returns, free next-day delivery)' : ''}.`,
    customer.notes ? `Account notes: ${customer.notes}` : '',
    orders.length ? `Recent orders: ${orders.map((o: any) => `${o.id} (${o.status}, £${o.total_gbp}, placed ${fmt(o.placed)})`).join('; ')}.` : 'No orders on file.',
    past.length ? `Previous conversations: ${past.map((p: any) => `#${p.id} via ${p.channel} on ${fmt(p.d)} (${p.status})${p.summary ? ': ' + p.summary : ''}`).join(' | ')}` : '',
  ].filter(Boolean).join('\n');
  return { customer, history, profileText };
}

const fmt = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export function historyAsMessages(mem: Memory, max = 8): Msg[] {
  return mem.history.slice(-max).map((m) => ({
    role: m.role === 'customer' ? 'user' : 'assistant',
    content: m.role === 'human' ? `[Human agent] ${m.content}` : m.content,
  }) as Msg);
}
