// Telegram channel (Bot API, long polling — works on any free host without a public webhook).
// Inbound updates become durable "inbound" jobs; replies go out through the retrying "send_telegram" job.
import type { App } from '../core/context.js';
import { config } from '../config.js';
import { enqueue, registerJob } from '../jobs/queue.js';

const api = (method: string) => `https://api.telegram.org/bot${config.telegram.token}/${method}`;

export async function tgSend(chatId: string, text: string) {
  const r = await fetch(api('sendMessage'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }) });
  const j: any = await r.json();
  if (!j.ok) throw new Error(`Telegram sendMessage failed: ${j.description ?? r.status}`);
}

export function registerTelegramJobs(app: App) {
  registerJob('send_telegram', async (p) => {
    await tgSend(p.chatId, p.text);
    if (p.messageId) await app.db.query(`UPDATE messages SET sent_at = now() WHERE id = $1`, [p.messageId]);
  });
}

export function startTelegram(app: App) {
  if (!config.telegram.token) { console.log('[telegram] disabled (no TELEGRAM_BOT_TOKEN)'); return () => {}; }
  let stopped = false;
  (async () => {
    // Long polling must not compete with a webhook.
    await fetch(api('deleteWebhook')).catch(() => {});
    const row = await app.db.one(`SELECT value FROM kv WHERE key = 'telegram_offset'`);
    let offset = row ? Number(row.value) : 0;
    console.log('[telegram] polling');
    while (!stopped) {
      try {
        const r = await fetch(`${api('getUpdates')}?timeout=25&offset=${offset}`);
        const j: any = await r.json();
        for (const u of j.result ?? []) {
          offset = u.update_id + 1;
          const m = u.message;
          if (m?.text) {
            const chatId = String(m.chat.id);
            const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ');
            if (m.text === '/start') {
              await enqueue(app.db, 'send_telegram', { chatId, text: `Hi ${m.from?.first_name ?? 'there'}! I'm the Brightbasket Home assistant. Ask me anything about delivery, returns or your orders. To see your orders, first send me the email address you used at checkout.` });
            } else if (/^\S+@\S+\.\S+$/.test(m.text.trim())) {
              const c = await app.db.one(`UPDATE customers SET telegram_chat_id = $2 WHERE lower(email) = lower($1) AND (telegram_chat_id IS NULL OR telegram_chat_id = $2) RETURNING name`, [m.text.trim(), chatId]);
              await enqueue(app.db, 'send_telegram', { chatId, text: c ? `Thanks${c.name ? ' ' + c.name.split(' ')[0] : ''}, your account is linked. How can I help?` : `I couldn't find an account with that email. You can still ask me general questions.` });
            } else {
              await enqueue(app.db, 'inbound', { channel: 'telegram', identity: { telegramChatId: chatId, name }, text: m.text });
            }
          }
          await app.db.query(`INSERT INTO kv (key, value) VALUES ('telegram_offset', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(offset)]);
        }
      } catch (e) {
        console.error('[telegram]', (e as Error).message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
  return () => { stopped = true; };
}
