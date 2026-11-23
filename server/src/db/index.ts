// One small interface over two Postgres engines:
//  - real Postgres (Neon, Supabase, docker) via node-postgres when DATABASE_URL is set
//  - PGlite (Postgres compiled to WASM) for local dev, tests and evals — zero setup, same SQL, same pgvector.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: 'pg' | 'pglite';
}

const here = dirname(fileURLToPath(import.meta.url));

export async function createDb(opts: { url?: string; dir?: string } = {}): Promise<Db> {
  const url = opts.url ?? config.databaseUrl;
  let db: Db;
  if (url) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: url, ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false }, max: 5 });
    db = {
      kind: 'pg',
      query: async (sql, params) => (await pool.query(sql, params as any[])).rows,
      one: async (sql, params) => (await pool.query(sql, params as any[])).rows[0],
      exec: async (sql) => { await pool.query(sql); },
      close: async () => { await pool.end(); },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const V: any = await import('@electric-sql/pglite-pgvector');
    const dir = opts.dir ?? config.pgliteDir;
    const lite = new PGlite({ ...(dir === 'memory://' ? {} : { dataDir: dir }), extensions: { vector: V.vector ?? V.default } });
    db = {
      kind: 'pglite',
      query: async (sql, params) => (await lite.query(sql, params as any[])).rows as any[],
      one: async (sql, params) => (await lite.query(sql, params as any[])).rows[0] as any,
      exec: async (sql) => { await lite.exec(sql); },
      close: async () => { await lite.close(); },
    };
  }
  await db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  return db;
}

// pgvector literal from a JS array
export const vec = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
