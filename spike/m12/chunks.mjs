/**
 * chunks.mjs — real corpus text for the M12 gate.
 *
 * ⚠️ SPIKE. Built to be discarded. Not the ingestion pipeline, and nothing here
 * should be promoted into `ingest/` — Stage 2.5 owns parsing, chunking, tagging
 * and provenance under brief criterion 4.
 *
 * **Deviation from M12 as written, recorded deliberately.** M12 says "8 real
 * chunks from live pgvector". There is no `chunks` table yet — Stage 2.5 has not
 * run — so this extracts real per-page text straight from the in-scope PDFs with
 * `pdftotext` instead.
 *
 * That substitution is sound for this gate specifically: span-verification rate,
 * chunk-id fabrication rate, provider block rate and token counts are all
 * measurements of **what the model does with real manual text**. None of them
 * depends on where the text was stored on the way in. What would be unsound is
 * using *synthetic* text, because dense IOM prose — tables, model numbers,
 * fragmentary lines — is exactly what makes character-exact copying hard.
 *
 * It also unblocks the gate: M12 blocks M6–M10, and waiting for ingestion would
 * serialise the two for no measurement benefit.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CORPUS = 'HVAC Data';
const CACHE = 'spike/m12/.cache';

/** Phase 1 answer scope: Trane Precedent + Carrier 48/50 + a PT chart. */
export const DOCS = [
  { file: 'RT-SVX23R-EN_09222022.pdf', label: 'RT-SVX23R-EN — Precedent Rooftop IOM' },
  { file: 'RT-SVX21AD-EN_06172022.pdf', label: 'RT-SVX21AD-EN — Precedent IOM' },
  { file: '48-50LC-4-6-C01T.pdf', label: '48-50LC — Carrier 48/50 LC Service' },
  { file: '50HC-7-12-07SI.pdf', label: '50HC — Carrier 50HC Service' },
  { file: '48-50PGPM-03T.pdf', label: '48-50PG/PM — Carrier Product Data' },
  { file: 'R-454B-Pressure-Temperature-Chart.pdf', label: 'R-454B PT Chart' },
];

/** One page of one document. `page` is 1-based and is the citable unit. */
function pagesOf(doc) {
  const cachePath = join(CACHE, doc.file + '.json');
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));

  const src = join(CORPUS, doc.file);
  if (!existsSync(src)) return [];

  // -layout preserves the column structure that makes IOM tables legible; the
  // form feed is pdftotext's page delimiter.
  const raw = execFileSync('pdftotext', ['-layout', src, '-'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  const pages = raw.split('\f').map((text, i) => ({
    doc: doc.label,
    page: i + 1,
    text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
  }));

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(pages));
  return pages;
}

/**
 * Every in-scope page with enough text to be worth citing.
 *
 * The 400-char floor drops wiring diagrams and dimensional drawings, which carry
 * almost no extractable text — `docs/retrieval-architecture.md` §1 measured ~117
 * such pages in scope. They are a known ingestion gap, not this gate's subject.
 */
export function corpus() {
  const out = [];
  for (const doc of DOCS) {
    for (const p of pagesOf(doc)) {
      if (p.text.length >= 400) out.push(p);
    }
  }
  return out;
}

const STOP = new Set(['the', 'and', 'for', 'not', 'with', 'wont', 'will', 'a', 'to', 'on', 'of', 'is']);

/**
 * Pick the 8 pages most relevant to a fault by keyword overlap.
 *
 * Not vector retrieval — deliberately. This gate measures whether the model
 * copies spans faithfully and stays inside the id map it was given. Retrieval
 * quality is criterion 7 and belongs to Stage 2.5. Using keyword selection here
 * keeps the two measurements from contaminating each other, and it means a poor
 * retrieval result cannot be mistaken for a poor span-verification result.
 */
export function selectChunks(faultName, pool, k = 8) {
  const terms = faultName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));

  const scored = pool.map((p) => {
    const hay = p.text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      const n = hay.split(t).length - 1;
      if (n) score += Math.min(n, 5);
    }
    return { p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, k).map((s) => s.p);

  // Always hand the model 8 chunks even for a fault with poor keyword overlap.
  // A short context is an easier copying task, and an easier task would flatter
  // the span-verification number.
  let i = 0;
  while (picked.length < k && i < pool.length) {
    if (!picked.includes(pool[i])) picked.push(pool[i]);
    i++;
  }
  return picked.slice(0, k);
}

/** Whitespace-insensitive containment — the normalisation M12 permits. */
export const normalise = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
