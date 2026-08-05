/**
 * Epic 2 — Retrieval & citation contract. Run A.
 * Stories E2.1–E2.3 · brief AC 7.
 *
 * This suite checks the smoke set; it does not write it. E2.2 belongs to
 * Knowledge, and a stage that authors its own test queries and then reports its
 * own score against them has measured nothing. See tests/fixtures/SCHEMAS.md for
 * the shape these checks read.
 */

import { defineSuite, pass, fail, blocked } from '../harness.mjs';

const SMOKE_SET = 'tests/fixtures/retrieval-smoke-set.json';
const SMOKE_RESULTS = 'tests/fixtures/retrieval-smoke-results.json';

function loadJson(c, rel) {
  const raw = c.read(rel);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${rel} is not valid JSON: ${e.message}`, { cause: e });
  }
}

export default defineSuite({
  epic: 'E2',
  title: 'Retrieval & citation contract',
  run: 'A',
  checks: [
    {
      story: 'E2.1',
      what: 'the retrieval contract is documented well enough to build against blind',
      requires: 'knowledge',
      async run(c) {
        const artifact = c.read('.pipeline/025-knowledge.md') ?? '';
        // Stage 3 builds against this document, not against ingestion code, so
        // the check is on the document rather than on any exported function.
        const required = [
          { label: 'query interface', re: /query interface|retrieval interface/i },
          { label: 'returned chunk shape', re: /chunk shape|returned shape|response shape/i },
          { label: 'top-k default', re: /top.?k/i },
          { label: 'result ordering', re: /ordering|ranked by|sort/i },
          { label: 'scope filtering', re: /scope filter|in_phase1_scope|filter to in-scope/i },
          { label: 'citation rendering', re: /citation.*render|render.*citation/i },
        ];
        const missing = required.filter((r) => !r.re.test(artifact)).map((r) => r.label);
        const ev = c.fromFile(
          '.pipeline/025-knowledge.md',
          required.map((r) => `${r.re.test(artifact) ? 'ok  ' : 'MISS'}  ${r.label}`).join('\n')
        );
        return missing.length === 0 ? pass(ev) : fail(ev, `contract omits: ${missing.join(', ')}`);
      },
    },

    {
      story: 'E2.2',
      ac: 'brief AC 7',
      what: 'the smoke set exists, is version-controlled, and has at least 12 queries',
      async run(c) {
        const set = loadJson(c, SMOKE_SET);
        if (!set) {
          return blocked(
            `${SMOKE_SET} does not exist — Knowledge (Stage 2.5) owns it; see tests/fixtures/SCHEMAS.md`
          );
        }

        const queries = set.queries ?? [];
        const tracked = await c.git('ls-files', SMOKE_SET);
        // Schema per SCHEMAS.md (reconciled 6 Aug 2026): expectDocs is a non-empty
        // list of label regexes, expectTerms a non-empty term list. Equally strict
        // as the old single-document shape — every query must still say what a
        // correct answer looks like, in a form a machine can judge.
        const malformed = queries
          .filter(
            (q) =>
              !q.id || !q.query ||
              !Array.isArray(q.expectDocs) || q.expectDocs.length === 0 ||
              !Array.isArray(q.expectTerms) || q.expectTerms.length === 0
          )
          .map((q) => q.id ?? '(no id)');

        const ev = c.fromCheck(
          `parse ${SMOKE_SET}; git ls-files it`,
          `queries: ${queries.length} (brief AC 7 requires ≥ 12)\n` +
            `version-controlled: ${tracked.stdout.trim() ? 'yes' : 'NO — untracked'}\n` +
            `malformed entries: ${malformed.join(', ') || '(none)'}`
        );

        if (!tracked.stdout.trim()) return fail(ev, 'the smoke set is not tracked by git — it must be version-controlled, not ad hoc');
        if (malformed.length) return fail(ev, `entries missing id/query/expectDocs/expectTerms: ${malformed.join(', ')}`);
        return queries.length >= 12 ? pass(ev, `${queries.length} queries`) : fail(ev, `only ${queries.length} queries, need ≥ 12`);
      },
    },

    {
      story: 'E2.2',
      ac: 'brief AC 7',
      what: 'at least 10 of 12 return the correct document, with the page correct on those 10',
      requires: 'knowledge',
      async run(c) {
        const set = loadJson(c, SMOKE_SET);
        const results = loadJson(c, SMOKE_RESULTS);
        if (!set) return blocked(`${SMOKE_SET} does not exist`);
        if (!results) return blocked(`${SMOKE_RESULTS} does not exist — retrieval has not been run against the set`);

        const byId = new Map((results.queries ?? []).map((r) => [r.id, r]));
        const rows = [];
        let docCorrect = 0;
        let pageCorrectAmongDocCorrect = 0;

        for (const q of set.queries ?? []) {
          const got = byId.get(q.id);
          const top = got?.returned?.[0];
          // Re-judged here from the raw returned results, not read from the
          // runner's own docOk/pageOk fields — Stage 5 verifies, it does not
          // take the implementing code's word for its own score.
          const docOk = !!top && (q.expectDocs ?? []).some((p) => new RegExp(p, 'i').test(top.document));
          const text = (top?.text ?? '').toLowerCase();
          const pageOk = docOk && (q.expectTerms ?? []).some((t) => text.includes(t.toLowerCase()));
          if (docOk) docCorrect++;
          if (pageOk) pageCorrectAmongDocCorrect++;
          rows.push(
            `${q.id}  doc:${docOk ? 'ok ' : 'BAD'}  page:${docOk ? (pageOk ? 'ok ' : 'BAD') : '—  '}  ` +
              `expected /${(q.expectDocs ?? []).join('|')}/  got ${top?.document ?? '(nothing)'} p.${top?.page ?? '—'}`
          );
        }

        const total = (set.queries ?? []).length;
        const ev = c.fromCheck(
          `compare ${SMOKE_RESULTS} against ${SMOKE_SET}`,
          rows.join('\n') +
            `\n\ncorrect document: ${docCorrect}/${total}\ncorrect page among those: ${pageCorrectAmongDocCorrect}/${docCorrect}`
        );

        // The bar is stated as an absolute in brief AC 7, not a percentage, and
        // page accuracy is only counted on the queries that got the document
        // right — a right page in the wrong document is not a partial credit.
        const bar = Math.min(10, Math.ceil(total * (10 / 12)));
        if (docCorrect < bar) return fail(ev, `${docCorrect}/${total} correct documents, bar is ${bar}`);
        return pageCorrectAmongDocCorrect >= bar
          ? pass(ev, `${docCorrect}/${total} documents, ${pageCorrectAmongDocCorrect} with the correct page`)
          : fail(ev, `document bar met but only ${pageCorrectAmongDocCorrect} of ${docCorrect} have the correct page`);
      },
    },

    {
      story: 'E2.3',
      what: 'out-of-scope equipment is distinguishable at retrieval time',
      requires: 'knowledge',
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        // Daikin / Mitsubishi / chiller / EPA documents are ingested but tagged
        // out of Phase 1 scope, so Run B can refuse rather than improvise. This
        // asserts the tag exists and partitions the corpus — not that retrieval
        // ranks well, which is E2.2's job.
        const { data, error } = await supabaseAdmin()
          .from('chunks')
          .select('manufacturer, in_phase1_scope')
          .in('manufacturer', ['Daikin', 'Mitsubishi', 'EPA']);

        if (error) return blocked(`scope query failed: ${error.message}`);
        const leaked = (data ?? []).filter((r) => r.in_phase1_scope === true);
        const ev = c.fromCheck(
          "select manufacturer, in_phase1_scope from chunks where manufacturer in ('Daikin','Mitsubishi','EPA')",
          `rows: ${data?.length ?? 0}\nincorrectly marked in-scope: ${leaked.length}`
        );
        if (!data?.length) return blocked('no out-of-scope documents ingested yet');
        return leaked.length === 0
          ? pass(ev)
          : fail(ev, `${leaked.length} out-of-scope chunk(s) are tagged in Phase 1 scope`);
      },
    },
  ],
});
