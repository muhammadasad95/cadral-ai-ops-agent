// Email channel: polls an IMAP inbox (e.g. a Gmail account with an app password) for unread mail.
// Each email is stored as a durable "inbound" job, then marked as read. Replies go out through the "send_email" job (SMTP).
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { App } from '../core/context.js';
import { config } from '../config.js';
import { enqueue } from '../jobs/queue.js';

// Keep only the new text of a reply, not the quoted thread below it.
export function stripQuoted(text: string) {
  const lines = text.replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l) => /^On .+wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l) || l.startsWith('>') || /^From: /.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}

export async function pollEmailOnce(app: App) {
  const client = new ImapFlow({ host: config.email.imapHost, port: 993, secure: true, auth: { user: config.email.user, pass: config.email.pass }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  let n = 0;
  try {
    const uids = (await client.search({ seen: false })) || [];
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const mail = await simpleParser(msg.source);
      const from = mail.from?.value?.[0];
      if (!from?.address || from.address.toLowerCase() === config.email.user.toLowerCase()) continue;
      const text = stripQuoted(mail.text ?? '');
      if (text) {
        await enqueue(app.db, 'inbound', { channel: 'email', identity: { email: from.address, name: from.name }, text, subject: (mail.subject ?? '').replace(/^(re|fwd?):\s*/i, '') });
        n++;
      }
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }
  } finally { lock.release(); await client.logout(); }
  return n;
}

export function startEmail(app: App) {
  if (!config.email.user || !config.email.pass) { console.log('[email] disabled (no EMAIL_USER / EMAIL_PASSWORD)'); return () => {}; }
  const tick = () => pollEmailOnce(app).then((n) => n && console.log(`[email] queued ${n} new emails`)).catch((e) => console.error('[email]', e.message));
  tick();
  const t = setInterval(tick, config.email.pollSeconds * 1000);
  return () => clearInterval(t);
}
