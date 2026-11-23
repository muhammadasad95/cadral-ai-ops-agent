// Orders agent: an LLM tool-calling loop over real database functions. Each call and its reason is traced.
import type { App } from '../core/context.js';
import { trace } from '../core/context.js';
import type { Memory } from './memory.js';
import { historyAsMessages } from './memory.js';
import { ORDERS_SYSTEM } from './prompts.js';
import { ORDER_TOOLS, runTool } from './tools.js';
import type { Msg } from '../llm/provider.js';
import { guidanceBlock } from './learning.js';
import type { AgentReply } from './support.js';

export async function ordersAgent(app: App, mem: Memory, text: string, ctx: { conversationId: number; messageId: number }): Promise<AgentReply & { actions: string[]; approvalNeeded?: boolean }> {
  const guide = await guidanceBlock(app, 'orders', text);
  const messages: Msg[] = [
    { role: 'system', content: ORDERS_SYSTEM + (guide.text ? `\n\n${guide.text}` : '') + `\n\n${mem.profileText}\nToday is ${new Date().toISOString().slice(0, 10)}.` },
    ...historyAsMessages(mem, 8).slice(0, -1),
    { role: 'user', content: text },
  ];
  const actions: string[] = [];
  let pendingApproval = false;
  for (let step = 0; step < 5; step++) {
    const res = await app.llm.chat({ purpose: 'orders', ctx, messages, tools: ORDER_TOOLS, temperature: 0 });
    if (!res.toolCalls.length) {
      return { text: res.content.trim() || 'Sorry, something went wrong looking that up. A member of our team will check it for you.', citations: [], resolved: true, actions,
        approvalNeeded: pendingApproval };
    }
    messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } as Msg);
    for (const call of res.toolCalls) {
      const t0 = Date.now();
      let result: any;
      try { result = await runTool({ db: app.db, customerId: mem.customer.id, conversationId: ctx.conversationId }, call.name, call.args); }
      catch (e) { result = { error: (e as Error).message }; }
      if (call.name !== 'list_my_orders' && call.name !== 'get_order' && !result.error && !result.refused) actions.push(call.name);
      if (result.status === 'pending_approval') pendingApproval = true;
      await trace(app, { ...ctx, agent: 'orders', step: 'tool_call', detail: { tool: call.name, args: call.args, why: call.args?.reason, result, ms: Date.now() - t0 } });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) } as Msg);
    }
  }
  return { text: "I'm sorry, I couldn't finish that. I've passed it to our team, who will reply shortly.", citations: [], resolved: false, actions, needsReview: 'tool loop limit reached' };
}
