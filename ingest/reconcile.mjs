/**
 * reconcile.mjs — S8. Every file and every manifest row gets a disposition.
 *
 *   npm run ingest:reconcile
 *
 * This runs before anything is parsed. A document that cannot be attributed to a
 * manifest row must not enter the knowledge base, because the row is where the
 * manufacturer, coverage and licence come from — and a chunk whose provenance is
 * guessed produces a citation that looks right and is not.
 *
 * **Join on the SourceURL basename, never on `FileName`.** The `FileName` column
 * holds *intended* renames that were never applied; files kept their source names.
 * Joining on it resolves zero of 25 files.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Windows drive letters and backslashes make string comparison unreliable here.
 * `argv[1]` is undefined under `node -e`, where nothing is "main".
 */
export const isMain = (url) => !!process.argv[1] && url === pathToFileURL(process.argv[1]).href;

export const CORPUS_DIR = 'HVAC Data';
export const MANIFEST = 'data/manifest.csv';

/** Minimal RFC-4180-enough CSV reader — the manifest has quoted commas. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export const toCsv = (rows) =>
  rows.map((r) => r.map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(',')).join('\n') + '\n';

/**
 * The basename of a SourceURL, percent-decoded.
 *
 * Some rows carry a URL whose last segment is an id with no extension (row 23's
 * is `1929`). Those can never match a `*.pdf` on disk by basename, and A3 requires
 * them reported rather than silently dropped — so this returns what it finds and
 * lets the caller decide.
 */
export function urlBasename(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return path.slice(path.lastIndexOf('/') + 1);
  } catch {
    return '';
  }
}

/**
 * Known corrections that the raw join cannot make on its own.
 *
 * `1.pdf` is the **EPA Section 608 rule**, not the Mitsubishi City Multi handbook.
 * Stage 1 proved it five ways: `/Title` is literally `04-3817.pdf`, `/Producer` is
 * `Microsoft: Print To PDF`, zero `/Font` objects, US Letter geometry, and 43
 * pages matching the govinfo original.
 *
 * This mapping exists because the alternative — S10's original instruction to
 * rename `1.pdf` to the Mitsubishi handbook — would attach VRF metadata to EPA
 * regulatory text. `CLAUDE.md` calls a citation that does not support its claim
 * the worse of the two citation defects, and that is exactly what it would be.
 */
export const FILE_OVERRIDES = {
  '1.pdf': '04-3817.pdf',
};

/**
 * Fallback join, for rows whose SourceURL ends in an id rather than a filename.
 *
 * A3 requires the basename join to have an explicit fallback and these rows to be
 * *reported*, not silently dropped. Two Daikin rows are in this shape: their URLs
 * end in a numeric id, but the files are on disk under their source names.
 *
 * The rule is deterministic and narrow: take the `FileName` column's leading token
 * (up to the first `_`) and look for exactly that stem on disk.
 * `OM1164-4_Rebel-QuickStart-Operations.pdf` → stem `OM1164-4` → `OM1164-4.pdf`.
 *
 * It refuses to guess: a stem matching more than one file resolves to nothing, so
 * an ambiguous match can never silently attach the wrong provenance to a document.
 */
export function fallbackMatch(intendedName, available) {
  const stem = (intendedName || '').split('_')[0].replace(/\.pdf$/i, '').trim();
  if (stem.length < 4) return null;
  const hits = [...available].filter((f) => f.replace(/\.pdf$/i, '').toLowerCase() === stem.toLowerCase());
  return hits.length === 1 ? hits[0] : null;
}

export function reconcile() {
  const rows = parseCsv(readFileSync(MANIFEST, 'utf8'));
  const [header, ...data] = rows;
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

  const files = readdirSync(CORPUS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const unclaimed = new Set(files);

  const matched = [];
  const orphanRows = [];

  for (const r of data) {
    const url = r[col.SourceURL] ?? '';
    const base = urlBasename(url);
    const wanted = Object.entries(FILE_OVERRIDES).find(([, target]) => target === base)?.[0] ?? base;

    const intended = r[col.FileName] ?? '';
    const resolved =
      wanted && unclaimed.has(wanted) ? wanted : fallbackMatch(intended, unclaimed);

    if (resolved) {
      unclaimed.delete(resolved);
      matched.push({
        file: resolved,
        urlBasename: base,
        overridden: resolved !== base,
        viaFallback: !(wanted && wanted === resolved),
        manufacturer: r[col.Manufacturer] ?? '',
        docType: r[col.DocType] ?? '',
        coverage: r[col['Model / Coverage']] ?? '',
        sourceUrl: url,
        licenseStatus: r[col['Legal Status']] ?? '',
        intendedName: r[col.FileName] ?? '',
        row: r,
      });
    } else {
      orphanRows.push({
        urlBasename: base || '(no basename — URL ends in an id, not a filename)',
        intendedName: r[col.FileName] ?? '',
        manufacturer: r[col.Manufacturer] ?? '',
        sourceUrl: url,
        row: r,
      });
    }
  }

  return { header, matched, orphanRows, unattributed: [...unclaimed], files, col };
}

/**
 * Phase 1 answer scope, derived from the manifest — never from filenames.
 *
 * The brief defines it as "the 18 Trane + Carrier rooftop docs plus the 3 PT
 * charts". Both halves fall out of manifest columns: manufacturer for the first,
 * doc type for the second. Deriving it means adding a document to `HVAC Data/`
 * and its manifest row is all it takes to bring it into scope — no code edit, and
 * no list of filenames to fall out of date.
 *
 * Out-of-scope documents are still ingested and tagged, per the brief, so
 * retrieval precision is measured against the equipment actually under test.
 */
export const IN_SCOPE_MANUFACTURERS = ['Trane', 'Carrier'];
export const IN_SCOPE_DOCTYPES = ['PT Chart'];

export const isInScope = (doc) =>
  IN_SCOPE_MANUFACTURERS.includes(doc.manufacturer) || IN_SCOPE_DOCTYPES.includes(doc.docType);

/**
 * Every document that resolved, with its manifest provenance and scope flag.
 *
 * This is the only supported way to enumerate the corpus. Nothing downstream
 * should read `HVAC Data/` directly or name a file: a document that is not
 * attributable to a manifest row has no manufacturer, coverage or licence, and a
 * chunk whose provenance is guessed produces a citation that looks right and is
 * not.
 */
export function documents() {
  return reconcile().matched.map((m) => ({
    file: m.file,
    /** Citable name. From the manifest's intended name, which is descriptive. */
    label: (m.intendedName || m.file).replace(/\.pdf$/i, ''),
    manufacturer: m.manufacturer,
    docType: m.docType,
    coverage: m.coverage,
    sourceUrl: m.sourceUrl,
    licenseStatus: m.licenseStatus,
    inScope: isInScope(m),
  }));
}

if (isMain(import.meta.url)) {
  const { matched, orphanRows, unattributed, files } = reconcile();
  console.log(`\nS8 — corpus reconciliation\n`);
  console.log(`  files on disk : ${files.length}`);
  console.log(`  rows matched  : ${matched.length}`);
  console.log(`  orphan rows   : ${orphanRows.length}   (row with no file)`);
  console.log(`  unattributed  : ${unattributed.length}   (file with no row — must not be ingested)`);

  const identity = matched.filter((m) => m.overridden && !m.viaFallback);
  if (identity.length) {
    console.log(`\n  identity corrections (the file is not what its name suggests):`);
    for (const m of identity) console.log(`    ${m.file}  is actually  ${m.urlBasename}  (${m.manufacturer})`);
  }
  const fell = matched.filter((m) => m.viaFallback);
  if (fell.length) {
    console.log(`\n  matched by FileName-stem fallback (SourceURL ends in an id, not a filename):`);
    for (const m of fell) console.log(`    ${m.file}  ←  ${m.manufacturer} — ${m.intendedName}`);
  }
  if (orphanRows.length) {
    console.log(`\n  orphan rows:`);
    for (const o of orphanRows) console.log(`    ${o.urlBasename}  —  ${o.manufacturer} ${o.intendedName}`);
  }
  if (unattributed.length) {
    console.log(`\n  unattributed files:`);
    for (const f of unattributed) console.log(`    ${f}`);
  }
  console.log();
}
