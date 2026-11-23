// Seeds demo users, the shop catalogue, customers, orders and the knowledge base. Safe to run repeatedly.
import bcrypt from 'bcryptjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';
import { createDb } from './index.js';
import { config } from '../config.js';
import { PRODUCTS, CUSTOMERS, ORDERS, ADDRESSES } from '../../../data/shop.js';
import { ingestDirectory } from '../rag/ingest.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export async function seed(db: Db, opts: { force?: boolean } = {}) {
  const already = await db.one<{ n: number }>('SELECT count(*)::int AS n FROM orders');
  if (already!.n > 0 && !opts.force) return { skipped: true };

  if (config.seedDemoUsers) {
    for (const [email, name, pass, role] of [
      [config.adminEmail, 'Admin', config.adminPassword, 'admin'],
      [config.agentEmail, 'Support Agent', config.agentPassword, 'agent'],
    ]) {
      await db.query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4)
        ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`, [email, name, await bcrypt.hash(pass, 10), role]);
    }
  }

  for (const [sku, name, cat, price, stock] of PRODUCTS) {
    await db.query(`INSERT INTO products VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sku) DO UPDATE SET price_gbp = EXCLUDED.price_gbp, stock = EXCLUDED.stock`, [sku, name, cat, price, stock]);
  }
  const ids: number[] = [];
  for (const c of CUSTOMERS) {
    const r = await db.one<{ id: number }>(`INSERT INTO customers (name, email, tier, notes) VALUES ($1,$2,$3,$4)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [c.name, c.email, c.tier, c.notes ?? '']);
    ids.push(r!.id);
  }
  const price = new Map(PRODUCTS.map((p) => [p[0], p[3]]));
  const pname = new Map(PRODUCTS.map((p) => [p[0], p[1]]));
  for (const [id, ci, status, items, created, delivered, carrier] of ORDERS) {
    const lines = items.map(([sku, qty]) => ({ sku, name: pname.get(sku), qty, price_gbp: price.get(sku) }));
    const subtotal = lines.reduce((s, l) => s + l.qty * (l.price_gbp ?? 0), 0);
    const total = subtotal + (subtotal >= 50 ? 0 : 3.99);
    await db.query(`INSERT INTO orders (id, customer_id, status, items, total_gbp, refunded_gbp, shipping_address, carrier, tracking_number, created_at, delivered_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - ($10 || ' days')::interval, CASE WHEN $11::int IS NULL THEN NULL ELSE now() - ($11 || ' days')::interval END)
      ON CONFLICT (id) DO NOTHING`,
      [id, ids[ci], status, JSON.stringify(lines), total.toFixed(2), status === 'refunded' ? total.toFixed(2) : 0, ADDRESSES[ci], carrier,
        carrier ? (carrier === 'DPD' ? '15501' : 'RM') + id.slice(3) + 'GB' : null, String(created), delivered]);
  }
  const kb = await ingestDirectory(db, join(root, 'data/docs'));
  return { skipped: false, customers: ids.length, orders: ORDERS.length, ...kb };
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const db = await createDb();
  console.log(await seed(db, { force: true }));
  await db.close();
}
