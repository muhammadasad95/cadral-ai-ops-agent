// Central configuration. Every secret comes from environment variables; nothing is hard-coded.
import 'node:process';

const env = process.env;
const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export const config = {
  port: num(env.PORT, 7860),
  publicUrl: env.PUBLIC_URL ?? 'http://localhost:7860',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-change-me',

  // Database: Postgres (e.g. Neon) when DATABASE_URL is set, otherwise embedded PGlite (Postgres in WASM).
  databaseUrl: env.DATABASE_URL ?? '',
  pgliteDir: env.PGLITE_DIR ?? '.data/pglite', // use "memory://" for tests

  // LLM: any OpenAI-compatible endpoint. Default is Groq's free tier. LLM_PROVIDER=mock runs fully offline.
  llm: {
    provider: (env.LLM_PROVIDER ?? (env.LLM_API_KEY ? 'openai' : 'mock')) as 'openai' | 'mock',
    baseUrl: env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1',
    apiKey: env.LLM_API_KEY ?? '',
    model: env.LLM_MODEL ?? 'openai/gpt-oss-120b',
    fastModel: env.LLM_FAST_MODEL ?? 'openai/gpt-oss-20b',
    // USD per 1M tokens, used for cost tracking. Groq free tier is $0, so we track list price to show "what it would cost".
    priceIn: num(env.LLM_PRICE_IN, 0.59),
    priceOut: num(env.LLM_PRICE_OUT, 0.79),
    fastPriceIn: num(env.LLM_FAST_PRICE_IN, 0.05),
    fastPriceOut: num(env.LLM_FAST_PRICE_OUT, 0.08),
    maxRetries: num(env.LLM_MAX_RETRIES, 3),
  },

  // Embeddings: "local" = all-MiniLM-L6-v2 via transformers.js (free, runs in-process), "hash" = offline fallback.
  embeddings: (env.EMBEDDINGS ?? 'local') as 'local' | 'hash',
  reranker: (env.RERANKER ?? 'local') as 'local' | 'lexical',

  rag: {
    minRelevance: num(env.RAG_MIN_RELEVANCE, 0.3), // reranker relevance needed to answer...
    minVector: num(env.RAG_MIN_VECTOR, 0.45), // ...or this cosine similarity (the cross-encoder under-scores short paraphrased questions)
    topK: num(env.RAG_TOP_K, 4),
  },

  policy: {
    refundWindowDays: num(env.REFUND_WINDOW_DAYS, 30),
    autoRefundLimitGbp: num(env.AUTO_REFUND_LIMIT_GBP, 100), // above this a human must approve
  },

  // REVIEW = every AI reply waits for approval; SMART = only risky/low-confidence ones wait; AUTO = send everything.
  reviewMode: (env.REVIEW_MODE ?? 'SMART') as 'AUTO' | 'SMART' | 'REVIEW',

  telegram: { token: env.TELEGRAM_BOT_TOKEN ?? '' },
  email: {
    imapHost: env.IMAP_HOST ?? 'imap.gmail.com',
    smtpHost: env.SMTP_HOST ?? 'smtp.gmail.com',
    smtpPort: num(env.SMTP_PORT, 465),
    user: env.EMAIL_USER ?? '',
    pass: env.EMAIL_PASSWORD ?? '',
    pollSeconds: num(env.EMAIL_POLL_SECONDS, 60),
  },
  // Sending email: Brevo HTTP API if BREVO_API_KEY is set (works on hosts that block SMTP), otherwise SMTP.
  brevoApiKey: env.BREVO_API_KEY ?? '',
  emailFrom: env.EMAIL_FROM ?? env.EMAIL_USER ?? '',
  slackWebhookUrl: env.SLACK_WEBHOOK_URL ?? '',
  cronKey: env.CRON_KEY ?? '', // lets an external scheduler (GitHub Actions) trigger the daily report
  report: {
    to: env.REPORT_EMAIL_TO ?? '',
    cron: env.REPORT_CRON ?? '0 8 * * *',
    timezone: env.REPORT_TZ ?? 'Europe/London',
  },
  seedDemoUsers: bool(env.SEED_DEMO_USERS, true),
  adminEmail: env.ADMIN_EMAIL ?? 'admin@demo.shop',
  adminPassword: env.ADMIN_PASSWORD ?? 'admin123',
  agentEmail: env.AGENT_EMAIL ?? 'agent@demo.shop',
  agentPassword: env.AGENT_PASSWORD ?? 'agent123',
  enableWorkers: bool(env.ENABLE_WORKERS, true),
};

export type Config = typeof config;
