// Ingestion: parse PDF, HTML, CSV and Markdown into heading-aware chunks, embed them and store them.
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import * as cheerio from 'cheerio';
import { parse as parseCsv } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import type { Db } from '../db/index.js';
import { vec } from '../db/index.js';
import { embed } from './embed.js';

export type Chunk = { heading: string; content: string };

const MAX = 700;

function groupLines(lines: string[], title: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = title;
  let buf: string[] = [];
  const flush = () => { if (buf.length) chunks.push({ heading, content: buf.join(' ') }); buf = []; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isHeading = line.length < 70 && !/[.!?:,]$/.test(line) && !line.includes('·') && /^[A-Z0-9"]/.test(line) && line.split(' ').length <= 9;
    if (isHeading) { flush(); heading = line; continue; }
    if (buf.join(' ').length + line.length > MAX) flush();
    buf.push(line);
  }
  flush();
  return chunks;
}

export async function parseFile(path: string): Promise<{ title: string; type: string; chunks: Chunk[] }> {
  const ext = extname(path).slice(1).toLowerCase();
  const name = basename(path);
  if (ext === 'pdf') {
    const parser = new PDFParse({ data: readFileSync(path) });
    const { text } = await parser.getText();
    const lines = text.split('\n').filter((l) => !l.includes('@brightbasket') && !/^-- \d+ of \d+ --$/.test(l.trim()));
    const title = lines.find((l) => l.trim())?.trim() ?? name;
    return { title, type: 'pdf', chunks: groupLines(lines.slice(lines.indexOf(lines.find((l) => l.trim())!) + 1), title) };
  }
  if (ext === 'html') {
    const $ = cheerio.load(readFileSync(path, 'utf8'));
    $('nav, footer, script, style').remove();
    const title = $('h1').first().text().trim() || $('title').text().trim();
    const chunks: Chunk[] = [];
    $('section').each((_, s) => { chunks.push({ heading: $(s).find('h2').first().text().trim(), content: $(s).find('p').map((_, p) => $(p).text().trim()).get().join(' ') }); });
    if (!chunks.length) chunks.push(...groupLines($('main, body').text().split('\n'), title));
    return { title, type: 'html', chunks };
  }
  if (ext === 'md') {
    const md = readFileSync(path, 'utf8');
    const title = md.match(/^# (.+)$/m)?.[1] ?? name;
    const chunks: Chunk[] = [];
    for (const part of md.split(/^## /m).slice(1)) {
      const [h, ...rest] = part.split('\n');
      chunks.push({ heading: h.trim(), content: rest.join(' ').replace(/\s+/g, ' ').trim() });
    }
    return { title, type: 'md', chunks };
  }
  if (ext === 'csv') {
    const rows: Record<string, string>[] = parseCsv(readFileSync(path, 'utf8'), { columns: true });
    const title = name.replace('.csv', '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) + ' (table)';
    // one chunk per row, phrased as a sentence so keyword and vector search both work
    const chunks = rows.map((r) => ({ heading: title, content: Object.entries(r).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('; ') }));
    return { title, type: 'csv', chunks };
  }
  throw new Error(`Unsupported file type: ${name}`);
}

export async function ingestDirectory(db: Db, dir: string) {
  const files = readdirSync(dir).filter((f) => /\.(pdf|html|md|csv)$/i.test(f)).sort();
  let total = 0;
  for (const f of files) {
    const parsed = await parseFile(join(dir, f));
    const doc = await db.one<{ id: number }>(
      `INSERT INTO documents (source, title, doc_type) VALUES ($1,$2,$3)
       ON CONFLICT (source) DO UPDATE SET title = EXCLUDED.title RETURNING id`, [f, parsed.title, parsed.type]);
    await db.query('DELETE FROM chunks WHERE document_id = $1', [doc!.id]);
    const vectors = await embed(parsed.chunks.map((c) => `${parsed.title}. ${c.heading}. ${c.content}`));
    for (let i = 0; i < parsed.chunks.length; i++) {
      await db.query('INSERT INTO chunks (document_id, chunk_index, heading, content, embedding) VALUES ($1,$2,$3,$4,$5)',
        [doc!.id, i, parsed.chunks[i].heading, parsed.chunks[i].content, vec(vectors[i])]);
    }
    total += parsed.chunks.length;
  }
  return { documents: files.length, chunks: total };
}
