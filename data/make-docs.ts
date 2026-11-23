// Generates the 24-document knowledge base as real files (PDF, HTML web pages, CSV, Markdown).
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { DOCS, DELIVERY_ZONES, SHOP } from './kb.js';
import { PRODUCTS } from './shop.js';

const out = join(dirname(fileURLToPath(import.meta.url)), 'docs');
mkdirSync(out, { recursive: true });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function writePdf(file: string, title: string, sections: { h: string; p: string[] }[]) {
  await new Promise<void>((resolve) => {
    const doc = new PDFDocument({ margin: 56, info: { Title: title, Author: SHOP.name } });
    const stream = createWriteStream(join(out, file));
    doc.pipe(stream);
    doc.fontSize(9).fillColor('#666').text(`${SHOP.name} · ${SHOP.email} · ${SHOP.phone}`);
    doc.moveDown().fontSize(20).fillColor('#111').text(title);
    for (const s of sections) {
      doc.moveDown().fontSize(13).fillColor('#0d5e57').text(s.h);
      for (const p of s.p) doc.moveDown(0.3).fontSize(11).fillColor('#222').text(p);
    }
    doc.end();
    stream.on('finish', () => resolve());
  });
}

for (const d of DOCS) {
  if (d.type === 'pdf') await writePdf(d.file, d.title, d.sections);
  if (d.type === 'html') {
    const body = d.sections.map((s) => `<section><h2>${esc(s.h)}</h2>${s.p.map((p) => `<p>${esc(p)}</p>`).join('')}</section>`).join('\n');
    writeFileSync(join(out, d.file), `<!doctype html><html><head><title>${esc(d.title)} | ${SHOP.name}</title></head><body><nav>Home · Shop · Help</nav><main><h1>${esc(d.title)}</h1>\n${body}</main><footer>${SHOP.name}, ${esc(SHOP.address)}</footer></body></html>\n`);
  }
  if (d.type === 'md') writeFileSync(join(out, d.file), `# ${d.title}\n\n` + d.sections.map((s) => `## ${s.h}\n\n${s.p.join('\n\n')}`).join('\n\n') + '\n');
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => (/[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
writeFileSync(join(out, 'products.csv'), csv([['sku', 'name', 'category', 'price_gbp', 'in_stock'], ...PRODUCTS.map(([sku, n, c, p, s]) => [sku, n, c, p.toFixed(2), s > 0 ? 'yes' : 'no'])]));
writeFileSync(join(out, 'delivery-zones.csv'), csv(DELIVERY_ZONES));
console.log(`Wrote ${DOCS.length + 2} documents to ${out}`);
