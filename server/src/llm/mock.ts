// Deterministic offline LLM used when no API key is set (LLM_PROVIDER=mock). It follows the same contracts as the real
// model (router JSON, cited answers, tool calls) so the whole system, the dashboard and the evals run without any key.
// It is deliberately simple: real quality numbers come from running the evals with a real model.
import type { ChatRequest } from './provider.js';

const tok = (s: string) => Math.ceil(s.length / 4);
const lastUser = (req: ChatRequest) => {
  const u = [...req.messages].reverse().find((m) => m.role === 'user');
  return typeof u?.content === 'string' ? u.content : '';
};

function routerMock(text: string) {
  const t = text.toLowerCase().split('latest message:').pop()!;
  if (/(solicitor|lawyer|legal|chargeback|fire|smok|burn|injur|hacked|fraud|scam|human|manager|real person|furious|disgusting|unacceptable|worst|ridiculous|useless|joke)/.test(t))
    return { agent: 'escalation', confidence: 0.9, sentiment: /furious|disgusting|worst|ridiculous|useless|unacceptable|joke/.test(t) ? 'angry' : 'negative', risk: 0.85, reason: 'Customer is upset or raises a high-risk issue.' };
  if (/\bbb-\d{5}\b|where is my|my order|my parcel|my refund|refund (me|my)|cancel (my|the|it|order)|change (my|the) (delivery )?address|track(ing)? (my|number)|hasn'?t arrived|not arrived|arrived (broken|damaged|cracked)|broken|damaged|cracked|i ordered/.test(t))
    return { agent: 'orders', confidence: 0.85, sentiment: /broken|damaged|cracked|not arrived/.test(t) ? 'negative' : 'neutral', risk: 0.3, reason: 'Needs this customer\'s order data or an action on an order.' };
  return { agent: 'support', confidence: 0.8, sentiment: 'neutral', risk: 0.05, reason: 'General policy or product question.' };
}

function supportMock(user: string) {
  const q = user.split('Customer question:').pop()!.toLowerCase();
  const srcBlock = user.split('SOURCES:')[1]?.split('Customer question:')[0] ?? '';
  const sources = srcBlock.trim().split('\n').filter((l) => /^\[\d+\]/.test(l));
  const qWords = q.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  let best = { n: 0, sentence: '', score: 0 };
  for (const s of sources) {
    const n = Number(s.match(/^\[(\d+)\]/)![1]);
    const body = s.split(': ').slice(1).join(': ');
    for (const sentence of body.split(/(?<=\.)\s+/)) {
      const lw = sentence.toLowerCase();
      const score = qWords.filter((w) => lw.includes(w.replace(/s$/, ''))).length;
      if (score > best.score) best = { n, sentence, score };
    }
  }
  if (best.score === 0) return 'I_DONT_KNOW';
  return `${best.sentence.trim()} [${best.n}]`;
}

function ordersMock(req: ChatRequest) {
  const toolMsgs = req.messages.filter((m) => m.role === 'tool');
  const text = lastUser(req).toLowerCase();
  const id = text.match(/bb-\d{5}/i)?.[0]?.toUpperCase();
  if (!toolMsgs.length) {
    const call = (name: string, args: any) => ({ content: '', toolCalls: [{ id: 'call_1', name, args: { ...args, reason: args.reason } }] });
    if (!id) return call('list_my_orders', { reason: 'Customer did not give an order number, so I need their orders.' });
    if (/cancel/.test(text)) return call('cancel_order', { order_id: id, reason: 'Customer asked to cancel this order.' });
    if (/address/.test(text)) return call('update_shipping_address', { order_id: id, new_address: text.split(/ to /).pop()!.trim(), reason: 'Customer asked to change the delivery address.' });
    if (/refund|money back/.test(text)) return call('issue_refund', { order_id: id, refund_reason: /damag|broken|crack/.test(text) ? 'damaged on arrival' : 'customer return', reason: 'Customer asked for a refund on this order.' });
    if (/broken|damaged|cracked/.test(text)) return call('report_delivery_problem', { order_id: id, problem: 'damaged', reason: 'Customer says the item arrived damaged.' });
    if (/lost|not arrived|hasn'?t arrived|never arrived/.test(text)) return call('report_delivery_problem', { order_id: id, problem: 'lost', reason: 'Customer says the parcel has not arrived.' });
    return call('get_order', { order_id: id, reason: 'Customer asked about this order.' });
  }
  const last = JSON.parse(String(toolMsgs[toolMsgs.length - 1].content));
  if (last.error) return { content: `I'm sorry, I couldn't find that order on your account. Could you check the order number? It starts with BB- followed by five digits.`, toolCalls: [] };
  if (last.refused) return { content: `I'm sorry, I can't do that: ${last.why}`, toolCalls: [] };
  if (last.orders) return { content: `Here are your recent orders: ${last.orders.map((o: any) => `${o.order_id} (${o.status}, £${o.total_gbp.toFixed(2)})`).join(', ')}. Which one do you need help with?`, toolCalls: [] };
  if (last.refund_id) return { content: last.status === 'issued' ? `I've refunded £${last.amount_gbp.toFixed(2)} for order ${last.order_id}. It will reach your original payment method in 5 to 7 working days.` : `I've requested a refund of £${last.amount_gbp.toFixed(2)} for order ${last.order_id}. A team member will approve it within 1 working day.`, toolCalls: [] };
  if (last.status === 'cancelled') return { content: `Order ${last.order_id} is cancelled and £${last.refunded_gbp.toFixed(2)} will be refunded to your original payment method.`, toolCalls: [] };
  if (last.shipping_address && last.status === 'updated') return { content: `Done. Order ${last.order_id} will now be delivered to ${last.shipping_address}.`, toolCalls: [] };
  if (last.investigation) return { content: `I'm sorry about order ${last.order_id}. I've opened case ${last.investigation}. ${last.problem === 'damaged' ? 'Please send a photo and we will send a free replacement or a full refund, whichever you prefer.' : 'If the courier confirms it is lost, we will send a replacement or a full refund.'}`, toolCalls: [] };
  if (last.order_id) return { content: `Order ${last.order_id} is ${last.status}${last.tracking_number ? ` with ${last.carrier}, tracking number ${last.tracking_number}` : ''}.`, toolCalls: [] };
  return { content: 'Thanks, I have checked that for you.', toolCalls: [] };
}

export async function mockChat(req: ChatRequest) {
  const user = lastUser(req);
  let content = ''; let toolCalls: any[] = [];
  switch (req.purpose) {
    case 'router': content = JSON.stringify(routerMock(user)); break;
    case 'support': content = supportMock(user); break;
    case 'orders': ({ content, toolCalls } = ordersMock(req)); break;
    case 'escalation': content = JSON.stringify({ summary: `Customer wrote: "${user.split('Transcript:').pop()!.trim().slice(-200)}"`, reason: /fire|smok|burn|injur/.test(user.toLowerCase()) ? 'safety' : /solicitor|legal|lawyer/.test(user.toLowerCase()) ? 'legal' : /human|manager|person/.test(user.toLowerCase()) ? 'human_requested' : 'angry', risk: 0.8, suggested_action: 'Call or reply to the customer and resolve the issue personally.' }); break;
    case 'rules': content = JSON.stringify({ rules: ['Apologise once, then give the concrete next step and timescale.'] }); break;
    default: content = 'OK';
  }
  if (req.onToken && content && !toolCalls.length) for (const w of content.split(/(?<= )/)) req.onToken(w);
  const prompt = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' ');
  return { content, toolCalls, promptTokens: tok(prompt), completionTokens: tok(content) };
}
