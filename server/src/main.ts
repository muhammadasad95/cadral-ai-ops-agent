// Server entry point: database, agents, background workers, channels, scheduled report, API and dashboard.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fstatic from '@fastify/static';
import cron from 'node-cron';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createDb } from './db/index.js';
import { seed } from './db/seed.js';
import { Llm } from './llm/provider.js';
import { Bus, type App } from './core/context.js';
import { registerRoutes } from './api/routes.js';
import { registerJob, startWorker, enqueue } from './jobs/queue.js';
import { receive, respond } from './agents/orchestrator.js';
import { distilRules } from './agents/learning.js';
import { registerNotifyJobs } from './channels/notify.js';
import { registerTelegramJobs, startTelegram } from './channels/telegram.js';
import { startEmail } from './channels/email.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export async function buildApp() {
  if (!config.databaseUrl && config.pgliteDir !== 'memory://') mkdirSync(config.pgliteDir, { recursive: true });
  const db = await createDb();
  const s = await seed(db);
  if (!s.skipped) console.log('[seed]', s);
  const saved = await db.one(`SELECT value FROM kv WHERE key = 'review_mode'`);
  if (saved) config.reviewMode = saved.value;
  const app: App = { db, llm: new Llm(db), bus: new Bus() };

  // Show eval runs produced by `npm run eval` on the dashboard.
  const hist = join(root, 'evals/results/history.json');
  if (existsSync(hist)) {
    for (const r of JSON.parse(readFileSync(hist, 'utf8'))) {
      const seen = await db.one(`SELECT 1 FROM eval_runs WHERE created_at = $1`, [r.created_at]);
      if (!seen) await db.query(`INSERT INTO eval_runs (score, total, passed, model, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [r.score, r.total, r.passed, r.model, JSON.stringify({ byCategory: r.byCategory, avg_latency_ms: r.avg_latency_ms, avg_cost_usd: r.avg_cost_usd, embeddings: r.embeddings }), r.created_at]);
    }
  }

  // Jobs
  registerJob('inbound', async (p) => { const { message } = await receive(app, p.channel, p.identity, p.text, p.subject); await respond(app, message.id); });
  registerJob('respond', async (p) => { await respond(app, p.messageId); });
  registerJob('distil_rules', async (p) => { await distilRules(app, p.agent ?? 'support'); });
  registerNotifyJobs(app);
  registerTelegramJobs(app);
  return app;
}

async function main() {
  const app = await buildApp();
  const f = Fastify({ logger: { level: 'info' } });
  await f.register(cors, { origin: true });
  await f.register(jwt, { secret: config.jwtSecret });
  f.setErrorHandler((err: any, _req, rep) => {
    const status = err.statusCode ?? (err.name === 'ZodError' ? 400 : 500);
    rep.code(status).send({ error: err.name === 'ZodError' ? 'Invalid request' : err.message, details: err.issues });
  });
  registerRoutes(f, app);

  const web = join(root, 'web/dist');
  if (existsSync(web)) {
    await f.register(fstatic, { root: web });
    f.setNotFoundHandler((req, rep) => (req.url.startsWith('/api') ? rep.code(404).send({ error: 'not found' }) : rep.sendFile('index.html')));
  }

  if (config.enableWorkers) {
    startWorker(app.db, async (job) => { if (job.type !== 'slack_alert') await enqueue(app.db, 'slack_alert', { kind: 'dead_job', type: job.type, jobId: job.id, error: job.last_error }); });
    cron.schedule(config.report.cron, () => { enqueue(app.db, 'daily_report', {}); }, { timezone: config.report.timezone });
    startTelegram(app);
    startEmail(app);
  }

  await f.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Brightbasket AI ops running on ${config.publicUrl} (llm=${config.llm.provider}, db=${app.db.kind}, review=${config.reviewMode})`);
}

if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) main().catch((e) => { console.error(e); process.exit(1); });
