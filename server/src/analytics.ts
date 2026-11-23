// Metrics used by the dashboard and the daily management report.
import type { Db } from './db/index.js';

export async function analytics(db: Db, days = 7) {
  const p = [String(days)];
  const since = `now() - ($1 || ' days')::interval`;
  const totals = await db.one(`SELECT
      (SELECT count(*)::int FROM conversations WHERE created_at > ${since}) AS conversations,
      (SELECT count(*)::int FROM messages WHERE role = 'customer' AND created_at > ${since}) AS customer_messages,
      (SELECT count(*)::int FROM conversations WHERE created_at > ${since} AND status <> 'escalated' AND NOT handled_by_human) AS auto_resolved,
      (SELECT count(*)::int FROM escalations WHERE created_at > ${since}) AS escalations,
      (SELECT count(*)::int FROM refunds WHERE status = 'issued' AND created_at > ${since}) AS refunds_issued,
      (SELECT coalesce(sum(amount_gbp),0)::float FROM refunds WHERE status = 'issued' AND created_at > ${since}) AS refunds_gbp,
      (SELECT count(*)::int FROM refunds WHERE status = 'pending_approval') AS refunds_pending,
      (SELECT count(*)::int FROM messages WHERE status = 'pending_review') AS pending_review,
      (SELECT coalesce(sum(cost_usd),0)::float FROM llm_calls WHERE created_at > ${since}) AS llm_cost_usd,
      (SELECT coalesce(avg(latency_ms),0)::int FROM llm_calls WHERE ok AND created_at > ${since}) AS avg_llm_latency_ms,
      (SELECT count(*)::int FROM jobs WHERE status = 'dead') AS dead_jobs`, p);
  const resp = await db.one(`SELECT coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (a.created_at - c.created_at))), 0)::float AS median_s,
      coalesce(avg(extract(epoch FROM (a.created_at - c.created_at))),0)::float AS avg_s
    FROM messages a JOIN messages c ON c.id = a.reply_to WHERE a.role = 'assistant' AND a.created_at > ${since}`, p);
  const byAgent = await db.query(`SELECT agent, count(*)::int AS n FROM messages WHERE role = 'assistant' AND created_at > ${since} GROUP BY agent ORDER BY n DESC`, p);
  const byChannel = await db.query(`SELECT channel, count(*)::int AS n FROM conversations WHERE created_at > ${since} GROUP BY channel ORDER BY n DESC`, p);
  const topIssues = await db.query(`SELECT coalesce(detail->>'tool', detail->'hits'->0->>'heading', step) AS issue, agent, count(*)::int AS n
    FROM traces WHERE created_at > ${since} AND step IN ('tool_call','retrieval','handover') GROUP BY 1,2 ORDER BY n DESC LIMIT 8`, p);
  const accuracy = await db.query(`SELECT created_at::date AS day,
      count(*) FILTER (WHERE action = 'approved')::int AS approved, count(*) FILTER (WHERE action = 'edited')::int AS edited,
      count(*) FILTER (WHERE action = 'rejected')::int AS rejected FROM feedback GROUP BY 1 ORDER BY 1`);
  const fb = accuracy.reduce((a, r) => ({ ok: a.ok + r.approved, all: a.all + r.approved + r.edited + r.rejected }), { ok: 0, all: 0 });
  const daily = await db.query(`SELECT d::date AS day,
      (SELECT count(*)::int FROM conversations c WHERE c.created_at::date = d::date) AS conversations,
      (SELECT coalesce(sum(cost_usd),0)::float FROM llm_calls l WHERE l.created_at::date = d::date) AS cost_usd
    FROM generate_series(now() - ($1 || ' days')::interval, now(), interval '1 day') d`, p);
  const evals = await db.query(`SELECT created_at, score::float, passed, total, model FROM eval_runs ORDER BY id DESC LIMIT 20`);
  return {
    days, ...totals,
    auto_resolution_pct: totals!.conversations ? Math.round((100 * totals!.auto_resolved) / totals!.conversations) : 0,
    cost_per_conversation_usd: totals!.conversations ? totals!.llm_cost_usd / totals!.conversations : 0,
    response_time_median_s: resp!.median_s, response_time_avg_s: resp!.avg_s,
    ai_accuracy_pct: fb.all ? Math.round((100 * fb.ok) / fb.all) : null,
    accuracy_over_time: accuracy.map((r) => ({ ...r, pct: Math.round((100 * r.approved) / Math.max(1, r.approved + r.edited + r.rejected)) })),
    by_agent: byAgent, by_channel: byChannel, top_issues: topIssues, daily, evals: evals.reverse(),
  };
}
