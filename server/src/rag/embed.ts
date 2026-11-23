// Embeddings. Default: all-MiniLM-L6-v2 running locally through transformers.js (free, no API key, 384 dims).
// Fallback "hash" embedder (feature hashing + a small synonym map) keeps tests and offline demos working.
import { config } from '../config.js';

export const DIM = 384;
let extractor: any | null = null;
let mode: 'local' | 'hash' = config.embeddings;

async function loadLocal() {
  if (extractor) return extractor;
  try {
    const t: any = await import('@huggingface/transformers');
    extractor = await t.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
    return extractor;
  } catch (e) {
    console.warn('[embed] local model unavailable, falling back to hash embeddings:', (e as Error).message);
    mode = 'hash';
    return null;
  }
}

export function embeddingMode() { return mode; }

export async function embed(texts: string[]): Promise<number[][]> {
  if (mode === 'local') {
    const ex = await loadLocal();
    if (ex) {
      const out = await ex(texts, { pooling: 'mean', normalize: true });
      return out.tolist() as number[][];
    }
  }
  return texts.map(hashEmbed);
}

export async function embedOne(text: string) { return (await embed([text]))[0]; }

// ---- offline fallback ----
const SYN: Record<string, string> = {
  refund: 'refund', refunds: 'refund', money: 'refund', reimburse: 'refund', return: 'return', returns: 'return', returning: 'return', send: 'return',
  delivery: 'delivery', deliver: 'delivery', delivered: 'delivery', shipping: 'delivery', ship: 'delivery', postage: 'delivery', courier: 'delivery', parcel: 'delivery', package: 'delivery',
  broken: 'damaged', damaged: 'damaged', cracked: 'damaged', faulty: 'damaged', defective: 'damaged', smashed: 'damaged',
  cancel: 'cancel', cancelling: 'cancel', cancellation: 'cancel', hours: 'hours', open: 'hours', opening: 'hours',
  warranty: 'warranty', guarantee: 'warranty', abroad: 'international', ireland: 'international', eu: 'international', europe: 'international',
};
const STOP = new Set('a an the is are was were be to of and or in on for with my me i you your it this that do does can could would how what when where which who please hi hello thanks'.split(' '));

function tokens(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9£ ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => SYN[w] ?? w.replace(/(ing|ed|s)$/, ''));
}
function h(s: string) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

export function hashEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  const t = tokens(text);
  const feats = [...t, ...t.slice(1).map((w, i) => t[i] + '_' + w)];
  for (const f of feats) { const k = h(f); v[k % DIM] += (k & 1 ? 1 : -1) * (f.includes('_') ? 0.5 : 1); }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
