// Re-index a folder of documents: npm run ingest -- [dir]  (default: data/docs)
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../db/index.js';
import { config } from '../config.js';
import { ingestDirectory } from './ingest.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = resolve(process.argv[2] ?? join(root, 'data/docs'));

const db = await createDb({ url: config.databaseUrl, dir: config.pgliteDir });
const result = await ingestDirectory(db, dir);
console.log('Indexed', dir, result);
await db.close();
