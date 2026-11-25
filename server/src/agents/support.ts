// Support agent: answers from the knowledge base with citations, and says "I don't know" instead of guessing.
import type { App } from '../core/context.js';
import { trace } from '../core/context.js';
import type { Memory } from './memory.js';
import { historyAsMessages } from './memory.js';
import { hybridSearch } from '../rag/search.js';
import { SUPPORT_SYSTEM } from './prompts.js';
import { guidanceBlock } from './learning.js';
import { config } from '../config.js';
import { SHOP } from '../../../data/kb.js';

export type AgentReply = { text: string; citations: { n: number; source: string; title: string; heading: string }[]; needsReview?: string; resolved: boolean };

export const IDK_REPLY = `I'm sorry, I don't know the answer to that and I don't want to guess. I can pass your question to our customer care team (${SHOP.hours.split('.')[0]}), or you can email ${SHOP.email}. Would you like me to do that?`;

export async function supportAgent(app: App, mem: Memory, text: string, ctx: { conversationId: number; messageId: number }, onToken?: (t: string) => void): Promise<AgentReply> {
  // Rewrite follow-ups ("and for Ireland?") into a standalone query using the previous customer message.
  const prevCustomer = mem.history.filter((h) => h.role === 'customer').slice(-2, -1)[0]?.content;
  const query = text.split(' ').length < 6 && prevCustomer ? `${prevCustomer} ${text}` : text;
  const hits = await hybridSearch(app.db, query);
  const top = hits[0]?.relevance ?? 0;
  const topVector = Math.max(0, ...hits.map((h) => h.vScore));
  // Answer only if the reranker is confident OR the embedding match is strong; the LLM is the second guard (I_DONT_KNOW).
  const grounded = top >= config.rag.minRelevance || topVector >= config.rag.minVector;
  await trace(app, { ...ctx, agent: 'support', step: 'retrieval', detail: { query, hits: hits.map((h) => ({ source: h.source, heading: h.heading, relevance: +h.relevance.toFixed(3), vector: +h.vScore.toFixed(3), keyword: +h.kScore.toFixed(3) })) } });

  if (!grounded) {
    await trace(app, { ...ctx, agent: 'support', step: 'i_dont_know', detail: { reason: `best relevance ${top.toFixed(2)} < ${config.rag.minRelevance} and best vector ${topVector.toFixed(2)} < ${config.rag.minVector}` } });
    return { text: IDK_REPLY, citations: [], resolved: false };
  }

  const sources = hits.map((h, i) => `[${i + 1}] ${h.title} — ${h.heading}: ${h.content}`).join('\n');
  const guide = await guidanceBlock(app, 'support', text);
  if (guide.rules || guide.examples) await trace(app, { ...ctx, agent: 'support', step: 'learned_guidance', detail: { rules: guide.rules, examples: guide.examples } });

  const res = await app.llm.chat({
    purpose: 'support', ctx, temperature: 0.1,
    onToken: onToken ? bufferUntilSafe(onToken) : undefined,
    messages: [
      { role: 'system', content: SUPPORT_SYSTEM + (guide.text ? `\n\n${guide.text}` : '') },
      ...historyAsMessages(mem, 6).slice(0, -1),
      { role: 'user', content: `${mem.profileText}\n\nSOURCES:\n${sources}\n\nCustomer question: ${text}` },
    ],
  });

  const answer = res.content.trim();
  const cited = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].filter((n) => n >= 1 && n <= hits.length);
  if (/I_DONT_KNOW/.test(answer) || !cited.length) {
    await trace(app, { ...ctx, agent: 'support', step: 'i_dont_know', detail: { reason: cited.length ? 'model said it does not know' : 'answer had no valid citations, so it was not sent' } });
    return { text: IDK_REPLY, citations: [], resolved: false };
  }
  const citations = cited.map((n) => ({ n, source: hits[n - 1].source, title: hits[n - 1].title, heading: hits[n - 1].heading }));
  const borderline = top < config.rag.minRelevance && topVector < config.rag.minVector + 0.1;
  return { text: answer, citations, resolved: true, needsReview: borderline ? `low retrieval confidence (relevance ${top.toFixed(2)}, vector ${topVector.toFixed(2)})` : undefined };
}

// Hold back streamed tokens until we know the model is not about to say I_DONT_KNOW.
function bufferUntilSafe(onToken: (t: string) => void) {
  let buf = ''; let open = false;
  return (t: string) => {
    if (open) return onToken(t);
    buf += t;
    if (buf.length > 12 && !'I_DONT_KNOW'.startsWith(buf.trim().slice(0, 11))) { open = true; onToken(buf); }
  };
}
