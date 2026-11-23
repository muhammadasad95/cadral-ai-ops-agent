// Shared services passed to every agent, plus the live event bus used for streaming to the dashboard and web chat.
import { EventEmitter } from 'node:events';
import type { Db } from '../db/index.js';
import type { Llm } from '../llm/provider.js';

export type LiveEvent =
  | { type: 'message'; conversationId: number; message: any }
  | { type: 'token'; conversationId: number; replyId: string; token: string }
  | { type: 'trace'; conversationId: number; trace: any }
  | { type: 'conversation'; conversationId: number; status: string }
  | { type: 'escalation'; conversationId: number; escalation: any };

export class Bus extends EventEmitter {
  publish(e: LiveEvent) { this.emit('event', e); }
}

export type App = { db: Db; llm: Llm; bus: Bus };

export async function trace(app: App, t: { conversationId: number; messageId?: number; agent: string; step: string; detail?: any }) {
  const row = await app.db.one(`INSERT INTO traces (conversation_id, message_id, agent, step, detail) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [t.conversationId, t.messageId ?? null, t.agent, t.step, JSON.stringify(t.detail ?? {})]);
  app.bus.publish({ type: 'trace', conversationId: t.conversationId, trace: row });
  return row;
}
