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
// The join rules live in ingest/, so this check cannot drift from the code it
// verifies — the mistake this suite's own header warns about. The *invariant*
// below is still asserted independently.
import { fallbackMatch, FILE_OVERRIDES } from '../../ingest/reconcile.mjs';

const CORPUS_DIR = 'HVAC Data';

/**
 * Rows deleted from the manifest on 4 Aug 2026 by owner decision: the files on
 * disk are the corpus, and a row with no file is removed rather than carried as a
 * permanent unresolved gap.
 *
 * `04-3817.pdf` is deliberately NOT here — it is present on disk as `1.pdf`
 * (A1). Listing it as a gap was the same mis-identification, in a test.
 */
const KNOWN_GAPS = [];

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

  /**
   * Resolve a row to a file by the three documented rules, in order: the
   * SourceURL basename, a recorded identity correction (a file whose name lies
   * about what it is), then the FileName-stem fallback for rows whose URL ends in
   * an id. Anything unresolved by all three is genuinely undecided.
   */
  const resolveRow = (row) => {
    const base = sourceBasename(row.SourceURL);
    if (base && onDisk.includes(base)) return base;
    const override = Object.entries(FILE_OVERRIDES).find(([, target]) => target === base)?.[0];
    if (override && onDisk.includes(override)) return override;
    return fallbackMatch(row.FileName, onDisk);
  };

  const claimed = new Set();
  const rowsWithoutFile = [];
  for (const row of rows) {
    const file = resolveRow(row);
    if (file) claimed.add(file);
    else rowsWithoutFile.push(`${sourceBasename(row.SourceURL) || '(no basename)'}  (${row.Manufacturer} · ${row.DocType})`);
  }

  const filesWithoutRow = onDisk.filter((f) => !claimed.has(f));

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
      what: 'every manifest row and every file has a disposition — no gaps, no strays',
      async run(c) {
        const r = reconcile(c);
        if (!r) return fail(c.fromFile('data/manifest.csv', 'absent'), 'manifest not found');

        // Amendment 2 (4 Aug 2026): the files on disk ARE the corpus, and a row
        // with no file is deleted rather than carried. So this no longer asserts a
        // hardcoded row count — a count has to be edited every time the corpus
        // legitimately changes, and an assertion people routinely edit stops
        // meaning anything.
        //
        // The invariant is what must hold: nothing is undecided. Every row
        // resolves to a file, every file resolves to a row. That is brief AC 6 in
        // one sentence, and it stays true at any corpus size.
        const problems = [];
        if (!r.onDisk.length) problems.push('no PDFs found on disk');
        if (r.filesWithoutRow.length) {
          problems.push(
            `${r.filesWithoutRow.length} file(s) attributable to no manifest row — must not be ingested: ` +
              r.filesWithoutRow.join(', ')
          );
        }

        // The brief names exactly two gaps. Counts alone would pass while a third
        // row quietly failed to resolve, which is the discrepancy this check has
        // to catch: an unnamed orphan is a document nobody has decided about.
        // A row resolving by neither the basename join, nor the documented
        // FileName-stem fallback, nor a recorded identity correction is a document
        // nobody has decided about.
        const unexpected = [];
        for (const row of r.rows) {
          const base = sourceBasename(row.SourceURL);
          if (base && r.onDisk.includes(base)) continue;
          if (fallbackMatch(row.FileName, r.onDisk)) continue;
          if (Object.values(FILE_OVERRIDES).includes(base)) continue;
          unexpected.push(`${base || '(no basename)'} — ${row.Manufacturer}`);
        }
        if (unexpected.length) {
          problems.push(
            `${unexpected.length} manifest row(s) resolve to no file by any documented rule: ` +
              unexpected.join(', ')
          );
        }

        const ev = c.fromCheck(
          'assert brief §Corpus facts against the working tree',
          `manifest rows: ${r.rows.length}\nPDFs on disk: ${r.onDisk.length}\n` +
            `rows resolving to no file by any documented rule: ${unexpected.length}\n` +
            `files attributable to no row: ${r.filesWithoutRow.join(', ') || '(none)'}\n\n` +
            (problems.join('\n') || 'every row and every file has a disposition')
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
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        // Was a placeholder blocked() until Stage 2.5 defined the scheme. It has:
        // id = 'doc_' + sha256(SourceURL)[:16]. The check re-derives every live
        // document's id from its stored source_url — if any id had instead been
        // derived from a filename, or hand-assigned, the recomputation would not
        // match, and a rename could silently re-point that document's citations.
        const { createHash } = await import('node:crypto');
        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        const { data, error } = await supabaseAdmin()
          .from('documents')
          .select('id, source_url, file_name');
        if (error) return blocked(`documents not queryable: ${error.message}`);
        if (!data?.length) return blocked('documents table is empty — nothing ingested yet');

        const derive = (u) => 'doc_' + createHash('sha256').update(u.trim()).digest('hex').slice(0, 16);
        const bad = data.filter((d) => d.id !== derive(d.source_url));
        const ev = c.fromCheck(
          "re-derive id from source_url for every documents row; compare to stored id",
          `${data.length} documents checked\n` +
            (bad.length ? bad.map((d) => `MISMATCH ${d.file_name}: ${d.id}`).join('\n') : 'all ids derive from SourceURL')
        );
        return bad.length === 0
          ? pass(ev, `${data.length} ids derive from SourceURL, none from a filename`)
          : fail(ev, `${bad.length} document id(s) do not derive from their SourceURL — a rename can mis-cite`);
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
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        // Was a placeholder blocked() until E1.4's output existed. It does: every
        // ingested document row carries its disposition and reason. Two things to
        // hold: any non-clean disposition must state WHY (a caveat without a
        // reason is a flag nobody can act on), and excluded documents — which are
        // deliberately never upserted — must be accounted for in the artifact
        // rather than silently absent from both places.
        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        const { data, error } = await supabaseAdmin()
          .from('documents')
          .select('file_name, disposition, disposition_reason');
        if (error) return blocked(`documents not queryable: ${error.message}`);
        if (!data?.length) return blocked('documents table is empty — nothing ingested yet');

        const flagged = data.filter((d) => d.disposition !== 'ingest');
        const unreasoned = flagged.filter((d) => !d.disposition_reason?.trim());

        const artifact = c.read('.pipeline/025-knowledge.md') ?? '';
        const excludedRecorded = /excluded:\s*[1-9]/i.test(artifact) || /EXCLUDED/.test(artifact);

        const ev = c.fromCheck(
          'documents.disposition/_reason for every live row; artifact for exclusions',
          `${data.length} rows · ${flagged.length} flagged · ${unreasoned.length} without a reason\n` +
            `artifact records exclusions: ${excludedRecorded}`
        );
        if (unreasoned.length) {
          return fail(ev, `${unreasoned.length} flagged document(s) carry no reason: ${unreasoned.map((d) => d.file_name).join(', ')}`);
        }
        if (!excludedRecorded) {
          return fail(ev, 'excluded documents are absent from the DB by design but unrecorded in the artifact — they have vanished from both places');
        }
        return pass(ev, `${flagged.length} flagged, every one with a stated reason; exclusions recorded in the artifact`);
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
