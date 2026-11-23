// One command: `npm run eval`. Seeds a template database once, then runs every case in its own copy of it,
// scores routing, tools, side effects, citations and "I don't know", and reports accuracy, latency and cost.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as V from '@electric-sql/pglite-pgvector';
import { CASES, type Case } from './cases.js';
import { seed } from '../server/src/db/seed.js';
import type { Db } from '../server/src/db/index.js';
import { Llm, modelName } from '../server/src/llm/provider.js';
import { Bus, type App } from '../server/src/core/context.js';
import { handleInbound } from '../server/src/agents/orchestrator.js';
import { IDK_REPLY } from '../server/src/agents/support.js';
import { config } from '../server/src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const vector = (V as any).vector ?? (V as any).default;
config.reviewMode = 'AUTO';
config.enableWorkers = false;

function wrap(lite: PGlite): Db {
  return { kind: 'pglite', query: async (s, p) => (await lite.query(s, p as any[])).rows as any[], one: async (s, p) => (await lite.query(s, p as any[])).rows[0] as any,
    exec: async (s) => { await lite.exec(s); }, close: async () => { await lite.close(); } };
}

const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const cases = CASES.filter((c) => !only || c.id.startsWith(only) || c.category === only);

console.log(`Seeding template database (llm=${modelName()}, embeddings=${config.embeddings})…`);
const tpl = new PGlite({ extensions: { vector } });
const tdb = wrap(tpl);
await tdb.exec(readFileSync(join(here, '../server/src/db/schema.sql'), 'utf8'));
await seed(tdb);
const snapshot = await tpl.dumpDataDir('none');

type Result = { id: string; category: string; pass: boolean; failures: string[]; agent?: string; reply?: string; ms: number; costUsd: number; tokens: number };
const results: Result[] = [];

for (const c of cases) {
  const lite = new PGlite({ loadDataDir: snapshot, extensions: { vector } });
  const db = wrap(lite);
  const app: App = { db, llm: new Llm(db), bus: new Bus() };
  const t0 = Date.now();
  const failures: string[] = [];
  let reply: any = null;
  try {
    const r = await handleInbound(app, 'web', c.customer ? { email: c.customer } : { webSession: `eval-${c.id}` }, c.message);
    reply = r.reply;
    if (!reply) failures.push('no reply produced');
  } catch (e) { failures.push(`crash: ${(e as Error).message}`); }
  const ms = Date.now() - t0;
  const text: string = reply?.content ?? '';
  const lower = text.toLowerCase();
  const tools = (await db.query(`SELECT detail FROM traces WHERE step = 'tool_call'`)).map((t) => t.detail);
  const okTools = tools.filter((t) => !t.result?.error && !t.result?.refused).map((t) => t.tool);
  const e = c.expect;
  if (e.agent && reply?.agent !== e.agent) failures.push(`agent ${reply?.agent} != ${e.agent}`);
  if (e.tool && !tools.some((t) => t.tool === e.tool)) failures.push(`tool ${e.tool} not called (called: ${tools.map((t) => t.tool).join(',') || 'none'})`);
  if (e.noTool && okTools.includes(e.noTool)) failures.push(`tool ${e.noTool} should not succeed`);
  if (e.idk && text !== IDK_REPLY && !/don.?t know|not sure|no information|don.?t have (that|any) information/i.test(text)) failures.push('expected "I don\'t know"');
  if (e.cites && !(reply?.citations?.length > 0)) failures.push('no citations');
  for (const anyOf of e.contains ?? []) if (!anyOf.some((s) => lower.includes(s.toLowerCase()))) failures.push(`missing one of: ${anyOf.join(' | ')}`);
  if (e.db) { const row = await db.one(e.db).catch((x) => ({ ok: false, err: x.message })); if (!row?.ok) failures.push(`db check failed: ${e.db}`); }
  const usage = await db.one(`SELECT coalesce(sum(cost_usd),0)::float AS c, coalesce(sum(prompt_tokens + completion_tokens),0)::int AS t FROM llm_calls`);
  results.push({ id: c.id, category: c.category, pass: failures.length === 0, failures, agent: reply?.agent, reply: text.slice(0, 300), ms, costUsd: usage!.c, tokens: usage!.t });
  console.log(`${failures.length ? '✗' : '✓'} ${c.id.padEnd(7)} ${String(reply?.agent ?? '-').padEnd(10)} ${String(ms).padStart(6)}ms  ${failures.join('; ')}`);
  await lite.close();
}

const passed = results.filter((r) => r.pass).length;
const score = Math.round((1000 * passed) / results.length) / 10;
const byCategory: Record<string, { passed: number; total: number }> = {};
for (const r of results) { (byCategory[r.category] ??= { passed: 0, total: 0 }).total++; if (r.pass) byCategory[r.category].passed++; }
const avg = (f: (r: Result) => number) => results.reduce((s, r) => s + f(r), 0) / results.length;
const summary = { created_at: new Date().toISOString(), model: modelName(), embeddings: config.embeddings, score, passed, total: results.length, byCategory,
  avg_latency_ms: Math.round(avg((r) => r.ms)), avg_cost_usd: avg((r) => r.costUsd), avg_tokens: Math.round(avg((r) => r.tokens)), results };

console.log('\nBy category:'); for (const [k, v] of Object.entries(byCategory)) console.log(`  ${k.padEnd(11)} ${v.passed}/${v.total}`);
console.log(`\nSCORE: ${score}%  (${passed}/${results.length})   avg latency ${summary.avg_latency_ms} ms   avg cost $${summary.avg_cost_usd.toFixed(5)} / message   avg tokens ${summary.avg_tokens}`);

mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results/latest.json'), JSON.stringify(summary, null, 2));
const histFile = join(here, 'results/history.json');
const hist = existsSync(histFile) ? JSON.parse(readFileSync(histFile, 'utf8')) : [];
if (!only) { hist.push({ ...summary, results: undefined }); writeFileSync(histFile, JSON.stringify(hist, null, 2)); }
await tpl.close();
process.exit(0);
