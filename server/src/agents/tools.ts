// Real tools for the orders agent. They read and write the database; business rules live here, not in the prompt,
// so a confused or manipulated model still cannot refund outside policy or touch another customer's order.
import type { Tool } from '../llm/provider.js';
import type { Db } from '../db/index.js';
import { config } from '../config.js';

const reason = { type: 'string', description: 'Why you are calling this tool (shown in the agent trace).' };
const orderId = { type: 'string', description: 'Order number, e.g. BB-10401' };

export const ORDER_TOOLS: Tool[] = [
  { type: 'function', function: { name: 'list_my_orders', description: "List the signed-in customer's recent orders.", parameters: { type: 'object', properties: { reason }, required: ['reason'] } } },
  { type: 'function', function: { name: 'get_order', description: 'Get full details of one of the customer\'s orders (status, items, tracking, dates, refunds).', parameters: { type: 'object', properties: { order_id: orderId, reason }, required: ['order_id', 'reason'] } } },
  { type: 'function', function: { name: 'issue_refund', description: 'Refund all or part of a delivered order. Omit amount_gbp for a full refund of the remaining balance.', parameters: { type: 'object', properties: { order_id: orderId, amount_gbp: { type: 'number' }, refund_reason: { type: 'string', description: 'Customer-facing reason, e.g. damaged on arrival' }, reason }, required: ['order_id', 'refund_reason', 'reason'] } } },
  { type: 'function', function: { name: 'cancel_order', description: 'Cancel an order that is still processing (not yet shipped).', parameters: { type: 'object', properties: { order_id: orderId, reason }, required: ['order_id', 'reason'] } } },
  { type: 'function', function: { name: 'update_shipping_address', description: 'Change the delivery address of an order that has not shipped yet.', parameters: { type: 'object', properties: { order_id: orderId, new_address: { type: 'string' }, reason }, required: ['order_id', 'new_address', 'reason'] } } },
  { type: 'function', function: { name: 'report_delivery_problem', description: 'Record a late, lost or damaged parcel for an order and open a courier investigation.', parameters: { type: 'object', properties: { order_id: orderId, problem: { type: 'string', enum: ['late', 'lost', 'damaged'] }, reason }, required: ['order_id', 'problem', 'reason'] } } },
];

type Ctx = { db: Db; customerId: number; conversationId: number };
const money = (n: any) => Number(Number(n).toFixed(2));

async function ownOrder(ctx: Ctx, id: string) {
  const o = await ctx.db.one(`SELECT * FROM orders WHERE upper(id) = upper($1)`, [String(id ?? '').trim()]);
  if (!o) return { error: `No order ${id} was found.` };
  if (o.customer_id !== ctx.customerId) return { error: `Order ${id} is not on this customer's account.` };
  return { order: o };
}

function view(o: any) {
  return {
    order_id: o.id, status: o.status, placed: o.created_at, delivered: o.delivered_at, total_gbp: money(o.total_gbp), refunded_gbp: money(o.refunded_gbp),
    items: o.items, carrier: o.carrier, tracking_number: o.tracking_number, shipping_address: o.shipping_address,
  };
}

export async function runTool(ctx: Ctx, name: string, args: any): Promise<any> {
  switch (name) {
    case 'list_my_orders': {
      const rows = await ctx.db.query(`SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`, [ctx.customerId]);
      return { orders: rows.map((o) => ({ order_id: o.id, status: o.status, placed: o.created_at, total_gbp: money(o.total_gbp), items: o.items.map((i: any) => `${i.qty} x ${i.name}`) })) };
    }
    case 'get_order': {
      const r = await ownOrder(ctx, args.order_id);
      return 'error' in r ? r : view(r.order);
    }
    case 'issue_refund': {
      const r = await ownOrder(ctx, args.order_id);
      if ('error' in r) return r;
      const o = r.order;
      const remaining = money(o.total_gbp - o.refunded_gbp);
      if (['processing'].includes(o.status)) return { refused: true, why: 'Order has not shipped yet. Cancel it instead of refunding.' };
      if (o.status === 'cancelled' || remaining <= 0) return { refused: true, why: 'Nothing left to refund on this order.' };
      const reasonText = String(args.refund_reason ?? '').toLowerCase();
      const faulty = /damag|faulty|broken|lost|missing|wrong|defect/.test(reasonText);
      if (o.status === 'delivered' && o.delivered_at) {
        const days = (Date.now() - new Date(o.delivered_at).getTime()) / 86_400_000;
        if (days > config.policy.refundWindowDays && !faulty) return { refused: true, why: `Delivered ${Math.floor(days)} days ago; the return window is ${config.policy.refundWindowDays} days.` };
      }
      if (o.status === 'shipped' && !/lost|missing/.test(reasonText)) return { refused: true, why: 'Order is still in transit. Refunds for undelivered parcels need a lost-parcel report first.' };
      const amount = money(args.amount_gbp ?? remaining);
      if (amount <= 0 || amount > remaining) return { refused: true, why: `Amount must be between £0.01 and £${remaining.toFixed(2)}.` };
      const needsApproval = amount > config.policy.autoRefundLimitGbp;
      const status = needsApproval ? 'pending_approval' : 'issued';
      const ref = await ctx.db.one(`INSERT INTO refunds (order_id, amount_gbp, reason, status, conversation_id, decided_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [o.id, amount, args.refund_reason, status, ctx.conversationId, needsApproval ? null : 'ai-auto']);
      if (!needsApproval) {
        const newRefunded = money(Number(o.refunded_gbp) + amount);
        await ctx.db.query(`UPDATE orders SET refunded_gbp = $2, status = $3, updated_at = now() WHERE id = $1`,
          [o.id, newRefunded, newRefunded >= Number(o.total_gbp) ? 'refunded' : 'partially_refunded']);
      }
      return { refund_id: ref!.id, order_id: o.id, amount_gbp: amount, status, note: needsApproval ? `Over £${config.policy.autoRefundLimitGbp}: a human must approve it.` : 'Refund issued to the original payment method; it appears in 5-7 working days.' };
    }
    case 'cancel_order': {
      const r = await ownOrder(ctx, args.order_id);
      if ('error' in r) return r;
      if (r.order.status !== 'processing') return { refused: true, why: `Order is ${r.order.status}; only processing orders can be cancelled.` };
      await ctx.db.query(`UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1`, [r.order.id]);
      await ctx.db.query(`INSERT INTO refunds (order_id, amount_gbp, reason, status, conversation_id, decided_by) VALUES ($1,$2,'order cancelled','issued',$3,'ai-auto')`, [r.order.id, r.order.total_gbp, ctx.conversationId]);
      return { order_id: r.order.id, status: 'cancelled', refunded_gbp: money(r.order.total_gbp) };
    }
    case 'update_shipping_address': {
      const r = await ownOrder(ctx, args.order_id);
      if ('error' in r) return r;
      if (r.order.status !== 'processing') return { refused: true, why: `Order is ${r.order.status}; the address can only change before it ships.` };
      const addr = String(args.new_address ?? '').trim();
      if (addr.length < 8) return { refused: true, why: 'The new address looks incomplete. Ask for the full address including postcode.' };
      await ctx.db.query(`UPDATE orders SET shipping_address = $2, updated_at = now() WHERE id = $1`, [r.order.id, addr]);
      return { order_id: r.order.id, shipping_address: addr, status: 'updated' };
    }
    case 'report_delivery_problem': {
      const r = await ownOrder(ctx, args.order_id);
      if ('error' in r) return r;
      const caseId = `INV-${r.order.id.slice(3)}-${Date.now().toString().slice(-4)}`;
      return { order_id: r.order.id, problem: args.problem, investigation: caseId, next_step: args.problem === 'damaged' ? 'Customer can have a free replacement or full refund; ask for a photo.' : 'Courier investigation opened; if confirmed lost we replace or refund in full.' };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
