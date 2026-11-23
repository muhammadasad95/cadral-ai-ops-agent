// Durable job queue in Postgres. Every outbound side effect (Telegram/email replies, Slack alerts, reports) and every
// inbound message from async channels goes through here, so an API outage delays work instead of losing it.
// Retries use exponential backoff; after max_attempts a job is marked "dead" and an alert is raised.
import type { Db } from '../db/index.js';

export type Handler = (payload: any) => Promise<void>;
const handlers = new Map<string, Handler>();
export const registerJob = (type: string, h: Handler) => handlers.set(type, h);

export async function enqueue(db: Db, type: string, payload: any, opts: { delayMs?: number; maxAttempts?: number } = {}) {
  return db.one(`INSERT INTO jobs (type, payload, run_at, max_attempts) VALUES ($1,$2, now() + ($3 || ' milliseconds')::interval, $4) RETURNING id`,
    [type, JSON.stringify(payload), String(opts.delayMs ?? 0), opts.maxAttempts ?? 6]);
}

export async function runDueJobs(db: Db, limit = 10, onDead?: (job: any) => Promise<void>) {
  // Claim jobs atomically so two workers never run the same job.
  const jobs = await db.query(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY run_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING *`, [limit]);
  for (const job of jobs) {
    const h = handlers.get(job.type);
    try {
      if (!h) throw new Error(`no handler for ${job.type}`);
      await h(job.payload);
      await db.query(`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = $1`, [job.id]);
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 500) ?? String(e);
      if (job.attempts >= job.max_attempts) {
        await db.query(`UPDATE jobs SET status = 'dead', last_error = $2, updated_at = now() WHERE id = $1`, [job.id, msg]);
        if (onDead) await onDead({ ...job, last_error: msg }).catch(() => {});
      } else {
        const backoffMs = Math.min(15 * 60_000, 2_000 * 2 ** (job.attempts - 1));
        await db.query(`UPDATE jobs SET status = 'queued', last_error = $2, run_at = now() + ($3 || ' milliseconds')::interval, updated_at = now() WHERE id = $1`,
          [job.id, msg, String(backoffMs)]);
      }
    }
  }
  return jobs.length;
}

// Recover jobs stuck in "running" (e.g. the server restarted mid-job).
export async function recoverStuck(db: Db) {
  await db.query(`UPDATE jobs SET status = 'queued' WHERE status = 'running' AND updated_at < now() - interval '5 minutes'`);
}

export function startWorker(db: Db, onDead?: (job: any) => Promise<void>, everyMs = 2000) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return; busy = true;
    try { await recoverStuck(db); while ((await runDueJobs(db, 10, onDead)) > 0) { /* drain */ } }
    catch (e) { console.error('[jobs]', (e as Error).message); }
    finally { busy = false; }
  }, everyMs);
  return () => clearInterval(t);
}
