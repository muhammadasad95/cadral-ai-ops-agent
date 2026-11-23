// Outbound integrations: Slack alerts, email (SMTP) and the daily management report. All run as retrying jobs.
import nodemailer from 'nodemailer';
import type { App } from '../core/context.js';
import { config } from '../config.js';
import { registerJob } from '../jobs/queue.js';
import { analytics } from '../analytics.js';

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
const mailer = () => (transporter ??= nodemailer.createTransport({ host: config.email.smtpHost, port: config.email.smtpPort, secure: config.email.smtpPort === 465, auth: { user: config.email.user, pass: config.email.pass } }));

export async function postSlack(text: string, blocks?: any[]) {
  if (!config.slackWebhookUrl) { console.log('[slack:disabled]', text); return; }
  const r = await fetch(config.slackWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, blocks }) });
  if (!r.ok) throw new Error(`Slack webhook ${r.status}: ${await r.text()}`);
}

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  if (config.brevoApiKey) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: 'Brightbasket Home', email: config.emailFrom }, to: [{ email: to }], subject, textContent: text, htmlContent: html ?? `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>` }) });
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
    return;
  }
  if (!config.email.user || !config.email.pass) { console.log('[email:disabled]', to, subject); return; }
  await mailer().sendMail({ from: `Brightbasket Home <${config.emailFrom || config.email.user}>`, to, subject, text, html });
}

export async function buildReport(app: App) {
  const a = await analytics(app.db, 1);
  const lines = [
    `Conversations: ${a.conversations} (${a.customer_messages} customer messages)`,
    `Auto-resolved by AI: ${a.auto_resolution_pct}%`,
    `Escalated to humans: ${a.escalations}`,
    `Refunds issued: ${a.refunds_issued} (£${Number(a.refunds_gbp).toFixed(2)}); waiting for approval: ${a.refunds_pending}`,
    `AI accuracy (human review): ${a.ai_accuracy_pct ?? 'n/a'}%`,
    `Median response time: ${a.response_time_median_s.toFixed(1)}s`,
    `LLM cost: $${Number(a.llm_cost_usd).toFixed(4)} ($${a.cost_per_conversation_usd.toFixed(4)} per conversation)`,
    `Top issues: ${a.top_issues.slice(0, 5).map((t: any) => `${t.issue} (${t.n})`).join(', ') || 'none'}`,
    a.dead_jobs ? `ATTENTION: ${a.dead_jobs} failed background jobs need a look.` : '',
  ].filter(Boolean);
  const date = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' });
  const html = `<h2>Brightbasket customer operations — ${date}</h2><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul><p><a href="${config.publicUrl}">Open the dashboard</a></p>`;
  return { subject: `Daily customer-ops report — ${date}`, text: lines.join('\n'), html, data: a };
}

export function registerNotifyJobs(app: App) {
  registerJob('slack_alert', async (p) => {
    const link = `${config.publicUrl}/#/conversations/${p.conversationId}`;
    if (p.kind === 'escalation') await postSlack(`:rotating_light: *Escalation* (risk ${Number(p.risk).toFixed(2)}, ${p.reason}) — ${p.customer ?? 'customer'}\n${p.summary}\n<${link}|Open conversation #${p.conversationId}>`);
    else if (p.kind === 'refund_approval') await postSlack(`:moneybag: *Refund waiting for approval* — conversation #${p.conversationId}\n${p.text}\n<${link}|Review>`);
    else if (p.kind === 'error') await postSlack(`:warning: *System error* on conversation #${p.conversationId}: ${p.error}. The message is queued for retry.`);
    else if (p.kind === 'dead_job') await postSlack(`:x: *Job failed permanently*: ${p.type} #${p.jobId} — ${p.error}`);
  });
  registerJob('send_email', async (p) => {
    await sendEmail(p.to, p.subject, p.text);
    if (p.messageId) await app.db.query(`UPDATE messages SET sent_at = now() WHERE id = $1`, [p.messageId]);
  });
  registerJob('daily_report', async () => {
    const r = await buildReport(app);
    if (config.report.to) await sendEmail(config.report.to, r.subject, r.text, r.html);
    await postSlack(`:bar_chart: *${r.subject}*\n${r.text}`);
    await app.db.query(`INSERT INTO kv (key, value) VALUES ('last_report', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ at: new Date(), ...r })]);
  });
}
