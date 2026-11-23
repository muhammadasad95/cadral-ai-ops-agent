// Router agent: reads the message and picks the specialist. A deterministic safety net runs after the model:
// clear safety/legal/human-request signals always escalate, even if the model disagrees.
import type { App } from '../core/context.js';
import type { Memory } from './memory.js';
import { historyAsMessages } from './memory.js';
import { ROUTER_SYSTEM } from './prompts.js';
import { parseJson } from '../llm/provider.js';

export type Route = { agent: 'support' | 'orders' | 'escalation'; confidence: number; sentiment: string; risk: number; reason: string; overridden?: string };

const HARD_ESCALATE: [RegExp, string][] = [
  [/\b(solicitor|lawyer|legal action|sue|small claims|trading standards|court)\b/i, 'legal threat'],
  [/\b(chargeback|charge ?back|dispute (the|this) (payment|charge)|report you to my bank)\b/i, 'chargeback threat'],
  [/\b(fire|caught fire|smok(e|ing)|burn(t|ed)?|injur(y|ed)|electric shock|sparks?)\b/i, 'product safety'],
  [/\b(hacked|fraud|scam|stolen card|someone else (used|ordered))\b/i, 'fraud or account security'],
  [/\b(speak|talk|chat) (to|with) (a |an )?(human|person|manager|real person|someone)\b|\b(human|manager) please\b/i, 'customer asked for a human'],
];

export async function route(app: App, mem: Memory, text: string, ctx: { conversationId: number; messageId: number }): Promise<Route> {
  const res = await app.llm.chat({
    purpose: 'router', fast: true, json: true, temperature: 0, ctx,
    messages: [
      { role: 'system', content: ROUTER_SYSTEM },
      ...historyAsMessages(mem, 4).slice(0, -1),
      { role: 'user', content: `Customer context:\n${mem.profileText}\n\nLatest message:\n${text}` },
    ],
  });
  const raw = parseJson<Partial<Route>>(res.content, {});
  const r: Route = {
    agent: (['support', 'orders', 'escalation'].includes(raw.agent as string) ? raw.agent : 'support') as Route['agent'],
    confidence: clamp(Number(raw.confidence ?? 0.5)),
    sentiment: String(raw.sentiment ?? 'neutral'),
    risk: clamp(Number(raw.risk ?? 0)),
    reason: String(raw.reason ?? 'no reason given'),
  };
  for (const [re, why] of HARD_ESCALATE) {
    if (re.test(text) && r.agent !== 'escalation') { r.overridden = `${r.agent} -> escalation (${why})`; r.agent = 'escalation'; r.risk = Math.max(r.risk, 0.8); r.reason = `Safety net: ${why}. ${r.reason}`; break; }
  }
  if (r.agent !== 'escalation' && (r.sentiment === 'angry' && r.risk >= 0.7)) { r.overridden = `${r.agent} -> escalation (angry, high risk)`; r.agent = 'escalation'; }
  return r;
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
