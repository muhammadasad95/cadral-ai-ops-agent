// LLM access. One OpenAI-compatible client (Groq free tier by default; works with Gemini, OpenRouter, Ollama…).
// Every call is retried with exponential backoff and logged with tokens, cost and latency.
import OpenAI from 'openai';
import { config } from '../config.js';
import type { Db } from '../db/index.js';
import { mockChat } from './mock.js';

export type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Tool = OpenAI.Chat.Completions.ChatCompletionTool;
export type ToolCall = { id: string; name: string; args: any };
export type ChatResult = { content: string; toolCalls: ToolCall[]; model: string; promptTokens: number; completionTokens: number; latencyMs: number; costUsd: number };

export type ChatRequest = {
  purpose: 'router' | 'support' | 'orders' | 'escalation' | 'rules' | 'report' | 'eval';
  messages: Msg[];
  tools?: Tool[];
  json?: boolean;
  fast?: boolean;               // use the small fast model (routing, summaries)
  temperature?: number;
  onToken?: (t: string) => void; // stream tokens to the web chat
  ctx?: { conversationId?: number; messageId?: number };
};

let client: OpenAI | null = null;
const getClient = () => (client ??= new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl, maxRetries: 0, timeout: 45_000 }));

export function modelName(fast = false) {
  return config.llm.provider === 'mock' ? 'mock-llm' : fast ? config.llm.fastModel : config.llm.model;
}

function cost(fast: boolean, pin: number, pout: number) {
  const [i, o] = fast ? [config.llm.fastPriceIn, config.llm.fastPriceOut] : [config.llm.priceIn, config.llm.priceOut];
  return (pin * i + pout * o) / 1_000_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Llm {
  constructor(private db: Db) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const fast = !!req.fast;
    const model = modelName(fast);
    let lastErr: unknown;
    let noToolHint = false;
    const maxAttempts = config.llm.maxRetries + 3; // extra room for free-tier rate limits (429 waits are short and exact)
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const t0 = Date.now();
      try {
        // gpt-oss sometimes tries a built-in tool on requests that have none; retry once with an explicit instruction.
        const call = noToolHint ? { ...req, messages: [...req.messages, { role: 'system', content: 'Do not call any tools. Reply in plain text only.' } as any] } : req;
        const r = config.llm.provider === 'mock' ? await mockChat(call) : await this.callApi(call, model);
        const res: ChatResult = { ...r, model, latencyMs: Date.now() - t0, costUsd: cost(fast, r.promptTokens, r.completionTokens) };
        await this.log(req, res, true);
        return res;
      } catch (e: any) {
        lastErr = e;
        const status = e?.status ?? e?.response?.status;
        const msg = String(e?.message ?? '');
        const toolMisfire = status === 400 && /tool choice is none|called a tool/i.test(msg) && !noToolHint;
        const retryable = !status || status === 429 || status >= 500 || toolMisfire;
        await this.log(req, { content: '', toolCalls: [], model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, costUsd: 0 }, false);
        if (toolMisfire) { noToolHint = true; continue; }
        const limit = status === 429 ? maxAttempts : config.llm.maxRetries;
        if (!retryable || attempt >= limit) break;
        await sleep(retryDelay(e, attempt));
      }
    }
    throw lastErr;
  }

  private async callApi(req: ChatRequest, model: string) {
    const c = getClient();
    const base = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' as const } : {}),
      ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
    };
    if (req.onToken && !req.tools?.length) {
      const stream = await c.chat.completions.create({ ...base, stream: true, stream_options: { include_usage: true } } as any) as any;
      let content = ''; let usage: any = null;
      for await (const part of stream) {
        const d = part.choices?.[0]?.delta?.content;
        if (d) { content += d; req.onToken(d); }
        if (part.usage) usage = part.usage;
      }
      return { content: tidy(content), toolCalls: [], promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0 };
    }
    const r = await c.chat.completions.create(base);
    const m = r.choices[0].message;
    const toolCalls = (m.tool_calls ?? []).filter((t: any) => t.type === 'function').map((t: any) => {
      let args: any = {};
      try { args = JSON.parse(t.function.arguments || '{}'); } catch { args = { _raw: t.function.arguments }; }
      return { id: t.id, name: t.function.name, args };
    });
    return { content: tidy(m.content ?? ''), toolCalls, promptTokens: r.usage?.prompt_tokens ?? 0, completionTokens: r.usage?.completion_tokens ?? 0 };
  }

  private async log(req: ChatRequest, r: ChatResult, ok: boolean) {
    try {
      await this.db.query(`INSERT INTO llm_calls (conversation_id, message_id, purpose, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, ok)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.ctx?.conversationId ?? null, req.ctx?.messageId ?? null, req.purpose, r.model, r.promptTokens, r.completionTokens, r.costUsd, r.latencyMs, ok]);
    } catch { /* logging must never break a reply */ }
  }
}

export function parseJson<T = any>(s: string, fallback: T): T {
  try { return JSON.parse(s); } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
    return fallback;
  }
}

// Customer-facing text goes to plain-text channels (Telegram, email, web chat), so strip Markdown emphasis and
// normalise the non-breaking hyphens/spaces some models emit (e.g. "BB\u201110402"), which also break ID matching.
export function tidy(t: string): string {
  return t.replace(/【(\d+)(?:†[^】]*)?】/g, '[$1]').replace(/[\u2010\u2011]/g, '-').replace(/[\u00a0\u202f]/g, ' ').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
}

// Wait exactly as long as the provider asks ("try again in 4.6s", "435ms" or a Retry-After header), else back off exponentially.
export function retryDelay(e: any, attempt: number): number {
  const header = Number(e?.headers?.['retry-after'] ?? e?.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(20000, header * 1000 + 250);
  const m = String(e?.message ?? '').match(/try again in ([\d.]+)\s*(ms|s)/i);
  if (m) return Math.min(20000, Number(m[1]) * (m[2].toLowerCase() === 'ms' ? 1 : 1000) + 300);
  return Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
}
