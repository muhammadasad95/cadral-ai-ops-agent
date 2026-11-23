// Fast unit/integration tests (offline: mock LLM, hash embeddings, in-memory Postgres).
process.env.LLM_PROVIDER = 'mock'; process.env.EMBEDDINGS = 'hash'; process.env.RERANKER = 'lexical'; process.env.PGLITE_DIR = 'memory://';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, type Db } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { runTool } from '../src/agents/tools.js';
import { enqueue, registerJob, runDueJobs } from '../src/jobs/queue.js';
import { stripQuoted } from '../src/channels/email.js';
import { Llm } from '../src/llm/provider.js';
import { Bus, type App } from '../src/core/context.js';
import { handleInbound } from '../src/agents/orchestrator.js';
import { recordFeedback, guidanceBlock } from '../src/agents/learning.js';
import { hybridSearch } from '../src/rag/search.js';

let db: Db; let app: App;
const cust = async (email: string) => (await db.one('SELECT id FROM customers WHERE email = $1', [email]))!.id as number;
before(async () => { db = await createDb({ dir: 'memory://' }); await seed(db); app = { db, llm: new Llm(db), bus: new Bus() }; });
after(async () => { await db.close(); });

test('knowledge base has 20+ documents of 4 types', async () => {
  const r = await db.query(`SELECT doc_type, count(*)::int n FROM documents GROUP BY 1`);
  assert.ok(r.reduce((s, x) => s + x.n, 0) >= 20);
  assert.deepEqual(r.map((x) => x.doc_type).sort(), ['csv', 'html', 'md', 'pdf']);
});

test('hybrid search finds opening hours', async () => {
  const hits = await hybridSearch(db, 'what time do you open on saturday');
  assert.equal(hits[0].source, 'contact-and-opening-hours.html');
});

test('refund policy is enforced in code, not the prompt', async () => {
  const james = await cust('james.patel@example.co.uk');
  const old = await runTool({ db, customerId: james, conversationId: 0 }, 'issue_refund', { order_id: 'BB-10404', refund_reason: 'changed my mind' });
  assert.equal(old.refused, true, 'outside 30-day window');
  const other = await runTool({ db, customerId: james, conversationId: 0 }, 'get_order', { order_id: 'BB-10401' });
  assert.ok(other.error, "cannot read another customer's order");
  const oliver = await cust('oliver.hughes@example.co.uk');
  const big = await runTool({ db, customerId: oliver, conversationId: 0 }, 'issue_refund', { order_id: 'BB-10407', refund_reason: 'changed my mind' });
  assert.equal(big.status, 'pending_approval', 'over the auto limit needs a human');
});

test('cancel only works before shipping', async () => {
  const emma = await cust('emma.clarke@example.co.uk');
  const r = await runTool({ db, customerId: emma, conversationId: 0 }, 'cancel_order', { order_id: 'BB-10402' });
  assert.equal(r.refused, true);
});

test('job queue retries with backoff then succeeds', async () => {
  let calls = 0;
  registerJob('flaky', async () => { calls++; if (calls < 2) throw new Error('boom'); });
  const j = await enqueue(db, 'flaky', {});
  await runDueJobs(db);
  let row = await db.one('SELECT status, attempts, last_error FROM jobs WHERE id = $1', [j.id]);
  assert.equal(row.status, 'queued'); assert.equal(row.last_error, 'boom');
  await db.query(`UPDATE jobs SET run_at = now() WHERE id = $1`, [j.id]);
  await runDueJobs(db);
  row = await db.one('SELECT status FROM jobs WHERE id = $1', [j.id]);
  assert.equal(row.status, 'done');
});

test('email reply text is stripped of the quoted thread', () => {
  assert.equal(stripQuoted('Where is my order?\n\nOn Mon, 1 Jan 2026, Shop wrote:\n> old text'), 'Where is my order?');
});

test('safety net escalates fire reports even if the model disagrees', async () => {
  const r = await handleInbound(app, 'web', { email: 'sophie.w@example.co.uk' }, 'my lamp is smoking, what do I do');
  assert.equal(r.reply.agent, 'escalation');
  const e = await db.one('SELECT count(*)::int n FROM escalations');
  assert.ok(e.n >= 1);
});

test('feedback is reused as guidance for similar questions', async () => {
  const r = await handleInbound(app, 'web', { email: 'grace.evans@example.co.uk' }, 'How much is standard delivery?');
  await recordFeedback(app, { messageId: r.reply.id, action: 'edited', corrected: 'Standard delivery is £3.99 and free over £50.' });
  const g = await guidanceBlock(app, 'support', 'how much is standard delivery');
  assert.equal(g.examples, 1);
});
