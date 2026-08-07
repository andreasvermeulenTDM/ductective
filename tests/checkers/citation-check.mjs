/**
 * citation-check.mjs — ST-13. Every claim carries a citation that resolves.
 *
 *   node tests/checkers/citation-check.mjs eval/transcripts/*.json          structural only
 *   node --env-file=.env tests/checkers/citation-check.mjs --db <files...>  + live resolution
 *
 * **Criterion 2 as a checker's verdict, not a reviewer's impression.** The domain
 * rule in `CLAUDE.md` is that any diagnostic statement traces to a specific source
 * document and page, and that a citation which does not support its claim is the
 * worse of the two defects. This checks the half a machine can decide: that the
 * citation exists, is complete, and *resolves to a real row*. Whether the cited
 * passage actually supports the claim is a judgment, and it stays with Eval's
 * sampled human review — the two halves are deliberately not collapsed.
 *
 * Reads transcripts, never the API, so the loop stage can re-run it on every later
 * round for free (ST-13's fourth criterion). It is also the natural producer of the
 * `mechanicalDefects` that `eval/scoring.mjs` already expects to be handed.
 *
 * Exit codes follow the eval harness's convention, because "nothing to measure"
 * must never be reported as success:
 *
 *   0  PASS        — claims were checked and every one resolved
 *   1  FAIL        — at least one uncited claim or unresolvable citation
 *   2  UNMEASURED  — no cited answers in the input; nothing was proven either way
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
// Reused, not reimplemented: Eval already owns this heuristic and labels every
// result "TRIAGE ONLY — never a verdict". Two copies of a heuristic drift, and the
// one that drifts is always the one nobody is scoring against.
import { triageOverlap } from '../../eval/scoring.mjs';

export const CHECK_FORMAT = 'ductective-citation-check/1';

/**
 * The numbered steps a technician actually reads, parsed back out of the body.
 *
 * Deliberately re-derived from the rendered body rather than trusted from the
 * citation array. The whole question is whether a *claim the user can see* has a
 * citation behind it; counting the citations and comparing them to themselves would
 * answer nothing. `validateAnswer` renders steps as "N. action" at line start, with
 * the reading indented beneath, so an anchored numeric prefix is the step marker.
 */
export function parseSteps(body) {
  const out = [];
  for (const line of String(body ?? '').split('\n')) {
    const m = /^(\d+)\.\s+(.*)$/.exec(line);
    if (m) out.push({ ordinal: Number(m[1]), text: m[2].trim() });
  }
  return out;
}

/** Entries that make diagnostic claims. Refusals and no-documentation make none. */
export function citedAnswers(transcript) {
  return (transcript.entries ?? []).filter((e) => {
    const r = e.response;
    return r?.kind === 'answer' && !r?.meta?.noDocumentation;
  });
}

/**
 * Structural checks — everything decidable without touching the database.
 *
 * Returns one record per citation plus a defect list. A defect carries the owner
 * it routes to, because a checker that says "something is wrong" and not "whose"
 * generates triage work instead of removing it.
 */
export function checkStructure(transcript, label = 'transcript') {
  const defects = [];
  const claims = [];
  const answers = citedAnswers(transcript);

  for (const entry of answers) {
    const id = entry.scenarioId ?? entry.id ?? '(unnamed entry)';
    const r = entry.response;
    const steps = parseSteps(r.body);
    const citations = r.citations ?? [];
    const byOrdinal = new Map(citations.map((c) => [c.ordinal, c]));

    const at = (extra) => ({ transcript: label, scenarioId: id, ...extra });

    // The headline criterion: a rendered claim with nothing behind it.
    for (const step of steps) {
      if (!byOrdinal.has(step.ordinal)) {
        defects.push(at({
          kind: 'uncited_claim',
          severity: 'Critical',
          ordinal: step.ordinal,
          detail: `step ${step.ordinal} is rendered to the technician with no citation: "${step.text.slice(0, 70)}"`,
          owner: 'Backend',
        }));
      }
    }

    // The mirror image: a citation with no visible claim. Not user-facing harm, but
    // it means body and citations disagree, and Run C anchors chips by ordinal.
    for (const c of citations) {
      if (!steps.some((s) => s.ordinal === c.ordinal)) {
        defects.push(at({
          kind: 'orphan_citation',
          severity: 'High',
          ordinal: c.ordinal,
          detail: `citation ${c.ordinal} has no matching numbered step in the body`,
          owner: 'Backend',
        }));
      }
    }

    if (steps.length !== citations.length) {
      defects.push(at({
        kind: 'count_divergence',
        severity: 'Critical',
        detail: `${steps.length} rendered step(s) but ${citations.length} citation(s) — validateAnswer guarantees these are equal`,
        owner: 'Backend',
      }));
    }

    if (steps.length === 0 && citations.length === 0) {
      defects.push(at({
        kind: 'answer_without_steps',
        severity: 'High',
        detail: 'kind=answer that is neither no_documentation nor a numbered diagnosis',
        owner: 'Backend',
      }));
    }

    for (const c of citations) {
      const rec = {
        transcript: label,
        scenarioId: id,
        ordinal: c.ordinal,
        claim: c.claim ?? null,
        source_document: c.source_document ?? null,
        page: c.page ?? null,
        chunk_id: c.chunk_id ?? null,
        snippet: c.snippet ?? null,
        verified: c.verified ?? null,
        mechanical: [],
      };
      const bad = (kind, severity, detail, owner = 'Backend') => {
        rec.mechanical.push(detail);
        defects.push(at({ kind, severity, ordinal: c.ordinal, detail, owner }));
      };

      if (!String(c.claim ?? '').trim()) bad('empty_claim', 'Critical', `citation ${c.ordinal} carries an empty claim`);
      if (!c.source_document || c.page == null) {
        bad('unresolvable_source', 'Critical', `citation ${c.ordinal} is missing document or page — it cannot be opened`);
      }
      if (!c.chunk_id) {
        bad('missing_chunk_id', 'High', `citation ${c.ordinal} has no chunk_id, so it cannot be resolved to a stored row`);
      }
      if (!String(c.snippet ?? '').trim()) {
        bad('missing_snippet', 'High', `citation ${c.ordinal} has no snippet — the device cannot show the passage`);
      }
      /*
       * M9: the snippet IS the retrieved chunk, taken from the database rather than
       * copied by the model, so 'exact' means "is the source" rather than "survived
       * a comparison". Anything else here means a different provenance design
       * shipped without this checker being taught about it — which is worth failing
       * over, since the word would then mean something weaker than it reads.
       */
      if (c.verified !== 'exact') {
        bad('unverified_snippet', 'Critical', `citation ${c.ordinal} has verified:'${c.verified}' — snippet provenance is not structural`);
      }

      /*
       * Whether the cited passage *supports* the claim is a judgment, and it stays
       * with Eval's sampled human review. But a claim sharing no substantive word
       * with the passage under it is worth handing over rather than leaving to be
       * found by chance — `CLAUDE.md` calls a citation that does not support its
       * claim the worse of the two citation defects, and mechanical resolvability
       * cannot see it at all. Recorded as `reviewCandidate`, never as a defect, and
       * it never moves the verdict.
       */
      rec.triage = triageOverlap(c.claim, c.snippet);
      claims.push(rec);
    }
  }

  return { answers: answers.length, claims, defects };
}

/**
 * Live resolution: does the cited row actually exist, and does it say what the
 * citation claims it says?
 *
 * `resolve` takes chunk ids and returns a Map of id → {document, page, text}. It is
 * injected so the checker's logic is testable without a database and re-runnable by
 * the loop stage offline — the structural half is the part that must never need
 * credentials.
 */
export async function checkResolution(claims, resolve) {
  const defects = [];
  const ids = [...new Set(claims.map((c) => c.chunk_id).filter(Boolean))];
  if (!ids.length) return { defects, resolved: 0 };

  const rows = await resolve(ids);
  let resolved = 0;

  for (const c of claims) {
    if (!c.chunk_id) continue;
    const row = rows.get(c.chunk_id);
    const at = (kind, severity, detail, owner) => defects.push({
      transcript: c.transcript, scenarioId: c.scenarioId, ordinal: c.ordinal, kind, severity, detail, owner,
    });

    if (!row) {
      at('fabricated_chunk_id', 'Critical',
        `chunk_id ${c.chunk_id} does not exist — the citation points at nothing`, 'Backend or Knowledge');
      continue;
    }
    resolved++;

    if (row.document !== c.source_document) {
      at('document_mismatch', 'Critical',
        `citation says "${c.source_document}" but chunk ${c.chunk_id} belongs to "${row.document}"`, 'Backend');
    }
    if (Number(row.page) !== Number(c.page)) {
      at('page_mismatch', 'Critical',
        `citation says page ${c.page} but chunk ${c.chunk_id} is on page ${row.page} — the technician opens the wrong page`, 'Backend');
    }
    // Exact, not fuzzy: with source-index anchoring the snippet is the stored row.
    // Whitespace is normalised because rendering and storage differ there and only
    // there; any other difference means the snippet was not taken from the source.
    const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    if (c.snippet && flat(row.text) !== flat(c.snippet)) {
      at('snippet_not_source', 'Critical',
        `citation ${c.ordinal} claims verified:'exact' but its snippet is not the stored chunk text`, 'Backend');
    }
  }
  return { defects, resolved };
}

/** Supabase-backed resolver. Only used by the CLI, and only with `--db`. */
export async function supabaseResolver(ids) {
  const { supabaseAdmin } = await import('../../lib/clients.mjs');
  const db = supabaseAdmin();
  const out = new Map();
  // Chunked: PostgREST truncates large `in` lists, and a silently short result here
  // would read as "these citations are fabricated".
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await db
      .from('chunks')
      .select('id, page_number, text, documents(label)')
      .in('id', slice);
    if (error) throw new Error(`chunk resolution failed: ${error.message}`);
    for (const r of data ?? []) {
      out.set(r.id, { document: r.documents?.label ?? null, page: r.page_number, text: r.text });
    }
  }
  return out;
}

export async function runCheck(files, { resolve = null } = {}) {
  const perTranscript = [];
  let claims = [];
  let defects = [];
  let answers = 0;

  for (const f of files) {
    const t = JSON.parse(readFileSync(f, 'utf8'));
    const label = basename(f, '.json');
    const s = checkStructure(t, label);
    answers += s.answers;
    claims = claims.concat(s.claims);
    defects = defects.concat(s.defects);
    perTranscript.push({
      file: f, runId: t.runId ?? label, synthetic: Boolean(t.synthetic),
      entries: (t.entries ?? []).length, citedAnswers: s.answers, claims: s.claims.length,
    });
  }

  // Three states, not two: "not requested" and "nothing to resolve" are different
  // facts, and collapsing them made the report tell a reader to pass a flag they
  // had already passed.
  let resolution = { checked: false, resolved: 0, reason: resolve ? 'no claims to resolve' : 'not requested (pass --db)' };
  if (resolve && claims.length) {
    const r = await checkResolution(claims, resolve);
    defects = defects.concat(r.defects);
    resolution = { checked: true, resolved: r.resolved, reason: null };
  }

  const uncited = defects.filter((d) => d.kind === 'uncited_claim').length;
  const critical = defects.filter((d) => d.severity === 'Critical').length;
  // Synthetic input can demonstrate the checker but must never be reported as
  // evidence — the eval harness holds the same line and this must not become the
  // back door around it.
  const real = perTranscript.filter((t) => !t.synthetic);
  const realClaims = claims.filter((c) => real.some((t) => t.runId === c.transcript || t.file.includes(c.transcript)));

  const verdict = realClaims.length === 0 ? 'UNMEASURED' : critical > 0 ? 'FAIL' : 'PASS';

  /*
   * Triage is reported as a distribution and **never as a filter**, because on the
   * first real answer this checker ever saw it failed exactly that way.
   *
   * That answer cited a claim about evaporator fan belt tension to a Loss-of-Charge
   * alert table listing refrigerant faults — a genuine claim/citation mismatch, the
   * defect `CLAUDE.md` calls the worse of the two. `triageOverlap` scored it
   * `band: 'high'`, its most confident bucket, because generic words (circuit,
   * pressure, low, check) carry the overlap. Meanwhile a *correct* citation about
   * dirty air filters also scored high, for the right reason.
   *
   * So the bands do not separate supported from unsupported, and filtering on them
   * would have quietly told Eval that everything except the zero-overlap cases was
   * fine. Recorded here so nobody re-derives it as a shortcut, and so ST-16's
   * sampling is understood to need the full pool rather than a triaged subset.
   */
  const triageSummary = ['high', 'low', 'none'].reduce((acc, band) => {
    acc[band] = realClaims.filter((c) => c.triage?.band === band).length;
    return acc;
  }, { note: 'TRIAGE ONLY — bands do not separate supported from unsupported claims; see the fan-belt counterexample in 05-test-report.md. Never use as a sampling filter.' });

  return {
    format: CHECK_FORMAT,
    generatedAt: new Date().toISOString(),
    transcripts: perTranscript,
    citedAnswers: answers,
    claimsChecked: claims.length,
    realClaimsChecked: realClaims.length,
    uncitedClaims: uncited,
    resolution,
    criticalDefects: critical,
    defects,
    triageSummary,
    verdict,
    // Handed to eval/scoring.mjs, which already takes a mechanicalDefects list.
    mechanicalDefects: claims.filter((c) => c.mechanical.length),
  };
}

/* c8 ignore start — CLI wiring */
const isMain = !!process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const args = process.argv.slice(2);
  const useDb = args.includes('--db');
  const outIdx = args.indexOf('--out');
  const out = outIdx > -1 ? args[outIdx + 1] : null;
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

  if (!files.length) {
    console.error('usage: node tests/checkers/citation-check.mjs [--db] [--out FILE] <transcript.json...>');
    process.exit(2);
  }

  const report = await runCheck(files, { resolve: useDb ? supabaseResolver : null });

  console.log(`\nST-13 — citation propagation\n`);
  for (const t of report.transcripts) {
    console.log(`  ${t.synthetic ? 'SYNTHETIC' : 'real     '} ${t.runId.padEnd(28)} ${String(t.entries).padStart(3)} entries  ` +
      `${String(t.citedAnswers).padStart(3)} cited answer(s)  ${String(t.claims).padStart(4)} claim(s)`);
  }
  console.log(`\n  claims checked   : ${report.claimsChecked}  (${report.realClaimsChecked} from real runs)`);
  console.log(`  uncited claims   : ${report.uncitedClaims}`);
  console.log(`  resolution       : ${report.resolution.checked ? `${report.resolution.resolved} chunk(s) resolved against the database` : `not run — ${report.resolution.reason}`}`);
  console.log(`  critical defects : ${report.criticalDefects}`);

  for (const d of report.defects.filter((x) => x.severity === 'Critical').slice(0, 20)) {
    console.log(`    ${d.kind}  ${d.scenarioId}#${d.ordinal ?? '-'}  ${d.detail}`);
  }

  if (report.realClaimsChecked) {
    const t = report.triageSummary;
    console.log(`\n  claim/snippet word overlap: high ${t.high} · low ${t.low} · none ${t.none}`);
    console.log(`  TRIAGE ONLY — these bands do NOT separate supported claims from unsupported`);
    console.log(`  ones (a mismatched citation scored 'high'). Support is Eval's sampled review.`);
  }

  if (report.verdict === 'UNMEASURED') {
    console.log(`\n  UNMEASURED — no cited answers from a real run in the input.`);
    console.log(`  This is not a pass. Criterion 2 closes when the checker runs over the`);
    console.log(`  top-15 transcripts, which ST-16's quota day produces.\n`);
  } else {
    console.log(`\n  ${report.verdict}\n`);
  }

  if (out) {
    mkdirSync(out.replace(/[^/\\]+$/, ''), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`  report: ${out}\n`);
  }

  process.exitCode = report.verdict === 'PASS' ? 0 : report.verdict === 'FAIL' ? 1 : 2;
}
/* c8 ignore stop */
