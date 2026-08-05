/**
 * parse.mjs — S11 + S13. Runs the parser over the corpus, measures it, and gives
 * every document an explicit disposition.
 *
 *   npm run ingest:parse
 *
 * Parsing is delegated to `ingest/parse.py` because pdfplumber is the only tool
 * here that exposes word geometry, and word geometry is what column detection
 * needs. `retrieval-architecture.md` §2 names pdfplumber for this reason.
 *
 * S13's rule: a document that parses badly gets a **stated disposition**, never a
 * silent pass. A page whose text is wrong is worse than a page with no text —
 * empty text retrieves nothing, while spliced text retrieves confidently.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { documents, CORPUS_DIR, isMain } from './reconcile.mjs';

const CACHE = 'ingest/.cache/parsed';

/**
 * Below this mean alpha ratio a document is mostly numbers and symbols — a
 * dimensional table rather than prose. Not a failure, but it retrieves poorly and
 * the artifact should say so rather than let it look like a normal document.
 */
const LOW_ALPHA = 0.55;

/** A document with almost no usable page is excluded rather than half-ingested. */
const MIN_USABLE_FRAC = 0.2;

export function parseDocument(doc) {
  const cachePath = join(CACHE, `${doc.file}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));

  const raw = execFileSync('python', ['ingest/parse.py', join(CORPUS_DIR, doc.file)], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw);

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(parsed));
  return parsed;
}

/**
 * S13 — one disposition per document, from the measurement. Every document lands
 * in exactly one of these, and the artifact lists all of them.
 */
export function disposition(quality) {
  const usableFrac = quality.page_count ? quality.usable_pages / quality.page_count : 0;

  if (quality.error_pages === quality.page_count && quality.page_count > 0) {
    return { state: 'excluded', reason: 'every page failed to parse' };
  }
  if (usableFrac < MIN_USABLE_FRAC) {
    return {
      state: 'excluded',
      reason: `only ${quality.usable_pages}/${quality.page_count} pages carry usable text ` +
        `(<${MIN_USABLE_FRAC * 100}%) — image-only or drawing-only document`,
    };
  }
  if (quality.mean_alpha_ratio < LOW_ALPHA) {
    return {
      state: 'ingest-with-caveat',
      reason: `mean alpha ratio ${quality.mean_alpha_ratio} — mostly tables and part numbers, ` +
        `expect weak prose retrieval`,
    };
  }
  if (quality.error_pages) {
    return {
      state: 'ingest-with-caveat',
      reason: `${quality.error_pages} page(s) failed to parse and are skipped`,
    };
  }
  return { state: 'ingest', reason: 'clean text layer' };
}

export function parseAll({ onProgress } = {}) {
  const out = [];
  for (const doc of documents()) {
    const { pages, quality } = parseDocument(doc);
    const d = disposition(quality);
    out.push({ doc, pages, quality, disposition: d });
    onProgress?.(doc, quality, d);
  }
  return out;
}

if (isMain(import.meta.url)) {
  const started = Date.now();
  const results = parseAll({
    onProgress: (doc, q, d) => {
      const flag = d.state === 'excluded' ? '✗' : d.state === 'ingest-with-caveat' ? '!' : ' ';
      console.log(
        `  ${flag} ${String(q.usable_pages).padStart(4)}/${String(q.page_count).padEnd(4)} pages  ` +
          `${String(q.two_column_pages).padStart(4)} 2-col  α=${q.mean_alpha_ratio.toFixed(2)}  ` +
          `${doc.inScope ? 'in ' : 'out'}  ${doc.label.slice(0, 46)}`
      );
    },
  });

  const sum = (k) => results.reduce((n, r) => n + r.quality[k], 0);
  const by = (s) => results.filter((r) => r.disposition.state === s);

  console.log(`\nS11 — parse quality across ${results.length} documents  (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
  console.log(`  pages parsed      : ${sum('page_count')}`);
  console.log(`  usable pages      : ${sum('usable_pages')}`);
  console.log(`  low-text pages    : ${sum('low_text_pages')}   (drawings and dimensional tables — nothing to OCR, per A2)`);
  console.log(`  two-column pages  : ${sum('two_column_pages')}   ← each one a splice a naive -layout read would have produced`);
  console.log(`  pages erroring    : ${sum('error_pages')}`);

  console.log(`\nS13 — dispositions`);
  for (const state of ['ingest', 'ingest-with-caveat', 'excluded']) {
    const group = by(state);
    console.log(`  ${state}: ${group.length}`);
    for (const r of group) {
      if (state !== 'ingest') console.log(`      ${r.doc.label.slice(0, 44)} — ${r.disposition.reason}`);
    }
  }
  console.log();
}
