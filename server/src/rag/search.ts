// Hybrid retrieval: keyword (Postgres full-text) + vector (pgvector cosine), fused with Reciprocal Rank Fusion,
// then reranked. The reranker score is also the "relevance" used to decide when to say "I don't know".
import type { Db } from '../db/index.js';
import { vec } from '../db/index.js';
import { embedOne } from './embed.js';
import { config } from '../config.js';

export type Hit = { id: number; source: string; title: string; heading: string; content: string; vScore: number; kScore: number; rrf: number; relevance: number };

const STOP = new Set('a an the is are was were be to of and or in on for with my me i you your it this that do does can could would how what when where which who please hi hello thanks there their them get got have has had will just'.split(' '));
const terms = (q: string) => [...new Set(q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];

let crossEncoder: any = null;
let rerankMode = config.reranker;
async function loadCross() {
  if (crossEncoder || rerankMode !== 'local') return crossEncoder;
  try {
    const t: any = await import('@huggingface/transformers');
    const tok = await t.AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2');
    const model = await t.AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' });
    crossEncoder = async (q: string, docs: string[]) => {
      const inputs = tok(new Array(docs.length).fill(q), { text_pair: docs, padding: true, truncation: true });
      const { logits } = await model(inputs);
      return (logits.tolist() as number[][]).map((l) => 1 / (1 + Math.exp(-l[0])));
    };
  } catch (e) {
    console.warn('[rerank] cross-encoder unavailable, using lexical reranker:', (e as Error).message);
    rerankMode = 'lexical';
  }
  return crossEncoder;
}

function lexicalRerank(q: string, hits: Hit[]) {
  const qt = terms(q);
  return hits.map((h) => {
    const head = (h.title + ' ' + h.heading).toLowerCase();
    const body = h.content.toLowerCase();
    const stem = (t: string) => t.replace(/(ing|ed|s)$/, '');
    const score = qt.reduce((s, t) => s + (head.includes(stem(t)) ? 1.5 : body.includes(stem(t)) ? 1 : 0), 0);
    const overlap = qt.length ? Math.min(1, score / (qt.length * 1.2)) : 0;
    return 0.6 * overlap + 0.4 * Math.max(0, h.vScore);
  });
}

export async function hybridSearch(db: Db, query: string, topK = config.rag.topK): Promise<Hit[]> {
  const qv = vec(await embedOne(query));
  const qt = terms(query);
  const vectorRows = await db.query(
    `SELECT c.id, d.source, d.title, c.heading, c.content, 1 - (c.embedding <=> $1::vector) AS score
     FROM chunks c JOIN documents d ON d.id = c.document_id ORDER BY c.embedding <=> $1::vector LIMIT 20`, [qv]);
  const keywordRows = qt.length ? await db.query(
    `SELECT c.id, d.source, d.title, c.heading, c.content, ts_rank(c.tsv, to_tsquery('english', $1)) AS score
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.tsv @@ to_tsquery('english', $1) ORDER BY score DESC LIMIT 20`, [qt.map((t) => t.replace(/'/g, '')).join(' | ')]) : [];

  // Reciprocal Rank Fusion (k = 60)
  const map = new Map<number, Hit>();
  const add = (rows: any[], kind: 'v' | 'k') => rows.forEach((r, i) => {
    const h = map.get(r.id) ?? { id: r.id, source: r.source, title: r.title, heading: r.heading ?? '', content: r.content, vScore: 0, kScore: 0, rrf: 0, relevance: 0 };
    if (kind === 'v') h.vScore = Number(r.score); else h.kScore = Number(r.score);
    h.rrf += 1 / (60 + i + 1);
    map.set(r.id, h);
  });
  add(vectorRows, 'v'); add(keywordRows, 'k');
  const fused = [...map.values()].sort((a, b) => b.rrf - a.rrf).slice(0, 12);
  if (!fused.length) return [];

  const ce = await loadCross();
  const scores = ce ? await ce(query, fused.map((h) => `${h.title}. ${h.heading}. ${h.content}`)) : lexicalRerank(query, fused);
  fused.forEach((h, i) => (h.relevance = scores[i]));
  return fused.sort((a, b) => b.relevance - a.relevance).slice(0, topK);
}

export function rerankerMode() { return rerankMode; }
