/**
 * Epic 1 — Corpus normalization & ingestion. Run A.
 * Stories E1.1–E1.10 · brief AC 5, 6, 8.
 *
 * E1.1's reconciliation runs today against the manifest and the corpus on disk —
 * it needs no ingestion code, only the two artifacts, and it is the check that
 * proves the brief's stated corpus facts are still true. Everything downstream of
 * parsing is BLOCKED against Stage 2.5 until 025-knowledge.md lands.
 */

import { defineSuite, pass, fail, blocked } from '../harness.mjs';
import { parseCsv, sourceBasename } from '../lib/csv.mjs';

const CORPUS_DIR = 'HVAC Data';

/** The two rows the brief names as having no file on disk. */
const KNOWN_GAPS = ['RT-SVX096C-EN_02282025.pdf', '04-3817.pdf'];

function reconcile(c) {
  const csv = c.read('data/manifest.csv');
  if (!csv) return null;

  const { rows } = parseCsv(csv);
  const onDisk = c.list(CORPUS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));

  const byBasename = new Map();
  for (const row of rows) {
    const key = sourceBasename(row.SourceURL);
    if (key) byBasename.set(key, row);
  }

  const rowsWithoutFile = [...byBasename.entries()]
    .filter(([key]) => !onDisk.includes(key))
    .map(([key, row]) => `${key}  (${row.Manufacturer} · ${row.DocType})`);

  const filesWithoutRow = onDisk.filter((f) => !byBasename.has(f));

  return { rows, onDisk, byBasename, rowsWithoutFile, filesWithoutRow };
}

export default defineSuite({
  epic: 'E1',
  title: 'Corpus normalization & ingestion',
  run: 'A',
  checks: [
    {
      story: 'E1.1',
      ac: 'brief AC 6',
      what: 'reconciliation joins on SourceURL basename, not the FileName column',
      async run(c) {
        const r = reconcile(c);
        if (!r) return fail(c.fromFile('data/manifest.csv', 'absent'), 'manifest not found');

        // The distinction is the whole point of E1.1: FileName is a descriptive
        // rename, and joining on it produces zero matches against a corpus stored
        // under source names. Proving the wrong key fails is what makes the right
        // key a decision rather than a coincidence.
        const byFileName = r.rows.filter((row) => r.onDisk.includes(row.FileName)).length;
        const byUrl = r.onDisk.filter((f) => r.byBasename.has(f)).length;

        const ev = c.fromCheck(
          'join data/manifest.csv against HVAC Data/*.pdf on both candidate keys',
          `matches joining on FileName column: ${byFileName}\n` +
            `matches joining on SourceURL basename: ${byUrl}\n` +
            `files on disk: ${r.onDisk.length}`
        );
        return byUrl > byFileName
          ? pass(ev, `SourceURL basename resolves ${byUrl}/${r.onDisk.length} files; FileName resolves ${byFileName}`)
          : fail(ev, 'SourceURL basename is not the stronger join key — E1.1s premise no longer holds');
      },
    },

    {
      story: 'E1.1',
      ac: 'brief AC 6',
      what: 'every manifest row without a file and every file without a row is named',
      async run(c) {
        const r = reconcile(c);
        if (!r) return fail(c.fromFile('data/manifest.csv', 'absent'), 'manifest not found');

        const ev = c.fromCheck(
          'reconcile data/manifest.csv ↔ HVAC Data/',
          `manifest rows: ${r.rows.length}\n` +
            `PDFs on disk: ${r.onDisk.length}\n\n` +
            `rows with no file (${r.rowsWithoutFile.length}):\n` +
            (r.rowsWithoutFile.map((s) => `  ${s}`).join('\n') || '  (none)') +
            `\n\nfiles with no row (${r.filesWithoutRow.length}):\n` +
            (r.filesWithoutRow.map((s) => `  ${s}`).join('\n') || '  (none)')
        );

        // Neither side may be silently skipped. Both being enumerable is the pass
        // condition; the gaps themselves are E1.2's problem, not this check's.
        return pass(ev, `${r.rowsWithoutFile.length} orphan row(s), ${r.filesWithoutRow.length} unattributed file(s)`);
      },
    },

    {
      story: 'E1.1',
      ac: 'brief AC 6',
      what: 'the corpus matches the facts the brief states (27 rows, 25 PDFs, 2 named gaps)',
      async run(c) {
        const r = reconcile(c);
        if (!r) return fail(c.fromFile('data/manifest.csv', 'absent'), 'manifest not found');

        const problems = [];
        if (r.rows.length !== 27) problems.push(`expected 27 manifest rows, found ${r.rows.length}`);
        if (r.onDisk.length !== 25) problems.push(`expected 25 PDFs, found ${r.onDisk.length}`);
        for (const gap of KNOWN_GAPS) {
          if (r.onDisk.includes(gap)) problems.push(`${gap} is now present — the brief says it is missing`);
        }

        // The brief names exactly two gaps. Counts alone would pass while a third
        // row quietly failed to resolve, which is the discrepancy this check has
        // to catch: an unnamed orphan is a document nobody has decided about.
        const unexpected = r.rowsWithoutFile.filter(
          (row) => !KNOWN_GAPS.some((gap) => row.startsWith(gap))
        );
        if (unexpected.length) {
          problems.push(
            `${unexpected.length} manifest row(s) fail to resolve that the brief does not name: ` +
              unexpected.map((u) => u.split('  ')[0]).join(', ')
          );
        }

        const ev = c.fromCheck(
          'assert brief §Corpus facts against the working tree',
          `rows: ${r.rows.length} (expect 27)\nPDFs: ${r.onDisk.length} (expect 25)\n` +
            `named gaps still absent: ${KNOWN_GAPS.filter((g) => !r.onDisk.includes(g)).join(', ') || '(none)'}\n` +
            `orphan rows: ${r.rowsWithoutFile.length} (brief names 2)\n` +
            `unattributed files: ${r.filesWithoutRow.join(', ') || '(none)'}\n\n` +
            (problems.join('\n') || 'corpus matches the brief')
        );

        // Drift here is not necessarily a defect — E1.2 may legitimately drop or
        // re-download a row. But it means the brief and the tree disagree, and
        // that has to surface rather than be absorbed.
        return problems.length === 0
          ? pass(ev)
          : fail(ev, `corpus has drifted from the brief: ${problems.join('; ')} — reconcile the brief or record the decision in 025-knowledge.md`);
      },
    },

    {
      story: 'E1.2',
      what: 'the two orphan manifest rows are resolved, not ignored',
      requires: 'knowledge',
      async run(c) {
        const r = reconcile(c);
        const artifact = c.read('.pipeline/025-knowledge.md') ?? '';
        const documented = KNOWN_GAPS.filter((g) => artifact.includes(g));
        const ev = c.fromCheck(
          'cross-reference orphan rows against 025-knowledge.md',
          `unresolved rows: ${r.rowsWithoutFile.length}\ndocumented in artifact: ${documented.join(', ') || '(none)'}`
        );
        if (r.rowsWithoutFile.length === 0) return pass(ev, 'manifest and disk agree');
        return documented.length === r.rowsWithoutFile.length
          ? pass(ev, 'every gap has a recorded decision')
          : fail(ev, 'an orphan row has no recorded re-download-or-drop decision');
      },
    },

    {
      story: 'E1.3',
      what: 'documents are keyed by a stable ID, so a rename cannot mis-cite',
      requires: 'knowledge',
      async run(c) {
        return blocked('document-identity scheme not yet defined — Stage 2.5 owns it');
      },
    },

    {
      story: 'E1.4',
      what: 'parse quality is recorded per document and low scores are flagged',
      requires: 'knowledge',
      async run(c) {
        const artifact = c.read('.pipeline/025-knowledge.md') ?? '';
        const hasTable = /parse quality|extraction quality/i.test(artifact);
        const ev = c.fromFile('.pipeline/025-knowledge.md', hasTable ? 'quality section present' : 'no quality section found');
        return hasTable ? pass(ev) : fail(ev, 'no per-document parse-quality table in the artifact');
      },
    },

    {
      story: 'E1.5',
      what: 'every flagged document has exactly one disposition',
      requires: 'knowledge',
      async run() {
        return blocked('depends on E1.4 output, which does not exist yet');
      },
    },

    {
      story: 'E1.6',
      ac: 'brief AC 4',
      what: 'zero page-less chunks were written',
      requires: 'knowledge',
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        const { count, error } = await supabaseAdmin()
          .from('chunks')
          .select('*', { count: 'exact', head: true })
          .is('page_number', null);

        if (error) return blocked(`chunks table not queryable: ${error.message}`);
        const ev = c.fromCheck('count chunks where page_number is null', `page-less chunks: ${count}`);
        return count === 0
          ? pass(ev)
          : fail(ev, `${count} chunk(s) cannot name their page — every citation from them is unverifiable`);
      },
    },

    {
      story: 'E1.7',
      ac: 'brief AC 4',
      what: 'Phase 1 answer scope is tagged: 18 rooftop docs + 3 PT charts in, the rest out',
      requires: 'knowledge',
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        const { data, error } = await supabaseAdmin().from('chunks').select('source_document, in_phase1_scope');
        if (error) return blocked(`scope column not queryable: ${error.message}`);

        const docs = new Map();
        for (const row of data ?? []) docs.set(row.source_document, row.in_phase1_scope);
        const inScope = [...docs.values()].filter(Boolean).length;

        const ev = c.fromCheck(
          'distinct source_document by in_phase1_scope',
          `documents in scope: ${inScope}\ndocuments out of scope: ${docs.size - inScope}`
        );
        return inScope === 21
          ? pass(ev, '21 in-scope documents (18 rooftop + 3 PT charts)')
          : fail(ev, `expected 21 in-scope documents, found ${inScope}`);
      },
    },

    {
      story: 'E1.9',
      ac: 'brief AC 5',
      what: 'running ingestion twice leaves the chunk count identical',
      requires: 'knowledge',
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        const pkg = JSON.parse(c.read('package.json') ?? '{}');
        const cmd = Object.keys(pkg.scripts ?? {}).find((k) => /ingest/i.test(k));
        if (!cmd) return blocked('no ingest script in package.json — E1.10 has not landed');

        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        const countChunks = async () => {
          const { count } = await supabaseAdmin().from('chunks').select('*', { count: 'exact', head: true });
          return count;
        };

        const before = await countChunks();
        const run = await c.sh('npm', ['run', cmd]);
        const after = await countChunks();

        const ev = c.fromCheck(
          `count chunks; npm run ${cmd}; count chunks`,
          `before: ${before}\nafter:  ${after}\n\nexit code: ${run.exitCode}`
        );
        return before === after
          ? pass(ev, `idempotent — ${after} chunks before and after`)
          : fail(ev, `re-ingest changed the chunk count ${before} → ${after}`);
      },
    },

    {
      story: 'E1.10',
      ac: 'brief AC 5, 8',
      what: 'one documented command runs ingestion end to end, with cost and runtime reported',
      requires: 'knowledge',
      async run(c) {
        const pkg = JSON.parse(c.read('package.json') ?? '{}');
        const cmd = Object.keys(pkg.scripts ?? {}).find((k) => /ingest/i.test(k));
        const artifact = c.read('.pipeline/025-knowledge.md') ?? '';
        const hasCost = /\$\s?\d/.test(artifact);
        const hasRuntime = /(runtime|wall.?clock|elapsed)/i.test(artifact);

        const ev = c.fromCheck(
          'package.json scripts + 025-knowledge.md cost/runtime sections',
          `ingest script: ${cmd ?? '(none)'}\ncost stated: ${hasCost}\nruntime stated: ${hasRuntime}`
        );
        if (!cmd) return fail(ev, 'no single documented ingestion command');
        return hasCost && hasRuntime
          ? pass(ev)
          : fail(ev, 'artifact does not state both re-ingest cost and wall-clock runtime');
      },
    },
  ],
});
