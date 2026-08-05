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

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';
import { documents, CORPUS_DIR, isMain } from './reconcile.mjs';

const execFileAsync = promisify(execFile);
const CACHE = 'ingest/.cache/parsed';

/**
 * Parsing runs one process per document, several at a time.
 *
 * pdfplumber is slow on the graphics-heavy Carrier product-data books — 16–25 MB
 * files where most of the page is vector drawing. Sequentially the corpus takes
 * long enough that you stop re-running ingestion, and a corpus you avoid
 * re-ingesting drifts from its sources. Criterion 8 also measures full re-ingest
 * wall-clock, so this is part of the deliverable rather than a convenience.
 *
 * Capped below core count: each worker holds a whole PDF's object graph, and the
 * large files here are memory-hungry enough that oversubscribing trades CPU for
 * swap.
 */
const WORKERS = Math.max(2, Math.min(6, availableParallelism() - 2));

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
 * Document types that are *supposed* to be mostly numbers.
 *
 * A pressure-temperature chart is a lookup table; measuring its alpha ratio and
 * calling it low-quality penalises a document for being what it is. The three PT
 * charts score 0.23–0.44 and are exactly the right source for a saturation-
 * temperature question — flagging them would have put a caveat on the one
 * document type that answers a whole fault category correctly.
 *
 * Product-data books are different and keep the caveat: they are *mixed* prose and
 * tables, so a low ratio there genuinely does predict weak prose retrieval.
 */
const TABULAR_BY_DESIGN = ['PT Chart'];

/**
 * S13 — one disposition per document, from the measurement. Every document lands
 * in exactly one of these, and the artifact lists all of them.
 */
export function disposition(quality, doc) {
  const usableFrac = quality.page_count ? quality.usable_pages / quality.page_count : 0;
  const tabular = doc && TABULAR_BY_DESIGN.includes(doc.docType);

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
  if (tabular) {
    return {
      state: 'ingest',
      reason: `reference table by design (alpha ${quality.mean_alpha_ratio}) — numeric content is correct here`,
    };
  }
  if (quality.mean_alpha_ratio < LOW_ALPHA) {
    return {
      state: 'ingest-with-caveat',
      reason: `mean alpha ratio ${quality.mean_alpha_ratio} — mixed prose and dimensional tables, ` +
        `expect weak prose retrieval on the table-heavy pages`,
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

/** Async twin of parseDocument, so several can be in flight at once. */
async function parseDocumentAsync(doc) {
  const cachePath = join(CACHE, `${doc.file}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));

  const { stdout } = await execFileAsync('python', ['ingest/parse.py', join(CORPUS_DIR, doc.file)], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(parsed));
  return parsed;
}

export async function parseAll({ onProgress } = {}) {
  const queue = documents();
  const out = new Array(queue.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= queue.length) return;
      const doc = queue[i];
      const { pages, quality } = await parseDocumentAsync(doc);
      const d = disposition(quality, doc);
      out[i] = { doc, pages, quality, disposition: d };
      onProgress?.(doc, quality, d);
    }
  };

  await Promise.all(Array.from({ length: WORKERS }, worker));
  return out;
}

if (isMain(import.meta.url)) {
  const started = Date.now();
  const results = await parseAll({
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
