# 03 — Backend · Device-feedback fixes, Wave 1 (F2 + F3)

Reads `.pipeline/00-brief-fixes.md`, `.pipeline/02-user-stories-fixes.md` and
`CLAUDE.md`. Branch `stage/backend-fixes`.

**Scope taken:** the four Backend-owned stories in Wave 1's F2 and F3 tracks —
**ST-F04**, **ST-F05**, **ST-F06** (conversational replies) and **ST-F10**
(unit type-ahead). Wave 1's other two Backend-owned stories, **ST-F01** (the F1
dismissal predicate) and **ST-F13** (F4 page-text fetch), were **not** in this
run's assignment and are untouched.

> **Precondition check.** `.pipeline/02-user-stories-fixes.md` is committed
> (`6b70585`, with the owner decisions at `592ae3c`) and assigns an owner per
> story. No story in this wave consumes a retrieval contract — F2 deliberately
> *bypasses* retrieval and F3 reads the `documents` table, which
> `lib/units.mjs` has read since U4. **Exemption claimed:** these are pre-retrieval
> stories (schema application, server rails, pure matching), so no
> `025-knowledge.md` dependency applies. Retrieval, chunking, embedding and
> citation validation are untouched — asserted by test, see §5.

---

## Contents

1. [What landed](#1-what-landed)
2. [The contracts the frontend consumes](#2-the-contracts-the-frontend-consumes)
3. [BLOCKED — the SQL the owner must run](#3-blocked--the-sql-the-owner-must-run)
4. [How the two domain rules are enforced, and where the tests are](#4-how-the-two-domain-rules-are-enforced-and-where-the-tests-are)
5. [Verifying each acceptance criterion](#5-verifying-each-acceptance-criterion)
6. [Gate status](#6-gate-status)
7. [Deferred to Frontend, exactly](#7-deferred-to-frontend-exactly)
8. [OPEN QUESTIONs, with the default taken](#8-open-questions-with-the-default-taken)
9. [CONTRACT MISMATCH / BLOCKED ON KNOWLEDGE](#9-contract-mismatch--blocked-on-knowledge)

---

## 1. What landed

### F2 — conversational replies

| story | file | what |
|---|---|---|
| ST-F04 | **`lib/conversation.mjs`** (new) | `classifyConversational(text)` → `{intent}` or `null`, plus `CONVERSATIONAL_BODIES` — three server-authored constants |
| ST-F04 | `lib/safety.mjs` | one new export, `HAZARD_DOMAIN_PATTERNS`. **No pattern changed, no behaviour changed** |
| ST-F04 | **`lib/conversation.test.mjs`** (new) | 69 tests |
| ST-F05 | `lib/diagnose.mjs` | step **1a**, between the hazard gate and the unit gate |
| ST-F05 | **`lib/diagnose.conversation.test.mjs`** (new) | 14 tests, including the throwing-stub guardrail proof |
| ST-F06 | **`sql/015_conversational_kind.sql`** (new) | widens `messages.kind`. **Not applied — see §3** |
| ST-F06 | `scripts/verify-sessions.mjs` | check 6b: insert-then-delete a `conversational` turn through the anon key + JWT |
| ST-F06 | `app/lib/supabase.ts`, `app/lib/diagnose.ts` | `MessageKind` and `DiagnoseReply['kind']` gain the value |

**The design was implemented as specified, not redesigned.** A deterministic
classifier *and* a canned reply body. The model is never asked whether something
is small talk and never authors the reply, so there is no channel through which
uncited diagnostic content can escape under a conversational label. That
guarantee is structural — it is not something validation catches afterwards, and
`RESPONSE_SCHEMA` and `validateAnswer` are deliberately untouched so the model
cannot declare this kind (asserted, `diagnose.conversation.test.mjs`).

**Ordering, which is the whole story:**

```
1.  sanitizeHistory                        unchanged
2.  classifyHazard  → refusal              UNCHANGED, STILL FIRST
2a. classifyConversational → conversational   NEW
3.  unit gate → unit_required              unchanged
4.  empty scope / unknown ids / retrieve / photos / generate / validate   unchanged
```

Two narrowings I took beyond the six rules in §2.2, both in the safe direction
(§7.5: narrow, never widen):

1. **Bare affirmations are excluded from the allow-list** — "yes", "yeah",
   "yep", "ok", "sure", "right". Those are what a technician types to *answer a
   `clarify` question*, and routing one to a canned pleasantry would break the
   clarification loop mid-diagnosis. Leaving them on today's path costs nothing.
2. **`classifyConversational` re-checks `classifyHazard` itself.** The ordering
   guarantee lives at the call site, where the story puts it; this is a second
   line so a future caller that wires the order wrong still cannot get small talk
   out of a hazardous request. It can only ever return *fewer* verdicts.

### F3 — unit type-ahead

| story | file | what |
|---|---|---|
| ST-F10 | `lib/units.mjs` | `suggestUnits(query, docs)` (pure) + `suggestUnitsLive(query, {db})` |
| ST-F10 | `scripts/serve.mjs` | `POST /suggest-units`, under the existing `LIMIT` and bearer gate; 404 message updated |
| ST-F10 | **`app/lib/suggest.ts`** (new) | the pure wire contract + `postSuggestUnits`, no React Native import |
| ST-F10 | `app/lib/diagnose.ts` | `requestSuggestUnits(query, cancel)` — BASE, bearer header, 4s timeout, `[]` on every failure |
| ST-F10 | **`lib/units.suggest.test.mjs`**, **`app/lib/suggest.test.mjs`** (new), `tests/serve-auth.test.mjs` | 36 tests |

**The matching rules are not reimplemented.** `expandFamilies`,
`tokenStandsFor`, `matchable` and the PT-chart exclusion are reused verbatim, and
every candidate suggestion is put back through **`classifyUnit`** and dropped
unless it comes out `covered` with ≥ 1 document. The suggestion's `documentIds`
**are** `classifyUnit`'s, so tapping a suggestion and typing the same text by
hand produce byte-identical retrieval scope. There is one definition of "covered"
in the tree and this is not a second one.

**No manufacturer or model string appears in the new code.** Asserted by
blanking comments in `units.mjs` and grepping the `suggestUnits` body against
every manufacturer name in `data/manifest.csv`.

One rule tightened, deliberately: **`MIN_PREFIX` now applies on the manufacturer
axis too.** `tokenStandsFor` lets a two-character token through on exact
equality, and "suggest anything a two-character token happens to equal" is the
same over-claim `matchable` was written to stop, arriving through the name
instead of the number. So a query below three characters suggests nothing at all.

---

## 2. The contracts the frontend consumes

Stage 4 builds against this section, not against my code.

### 2.1 `POST /diagnose` — the new `conversational` kind

```jsonc
{
  "kind": "conversational",
  "body": "Good — glad that helped.\n\nIf anything else comes up, tell me what you are seeing and I will answer from the manuals I hold, with the document and page behind it.",
  "citations": [],                    // ALWAYS empty, and that is correct
  "meta": {
    "intent": "acknowledgement",      // 'acknowledgement' | 'greeting' | 'farewell'
    "retrieved": 0, "dropped": 0,
    "noDocumentation": false,
    "mode": "vector",
    "latencyMs": 13,
    "latency": { "retrievalMs": 0, "generationMs": 0 },
    "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0,
               "cachedContentTokenCount": 0, "embedTokens": 0 },
    "attempts": 0,
    "model": null,                    // how the ledger knows this cost no quota
    "budget": { "day": "2026-08-10", "used": 0, "limit": 20, "remaining": 20 }
  }
}
```

Verbatim from a live `POST /diagnose` on this branch (`/health` commit
`de30875`). Three bodies, exactly three, all constants exported as
`CONVERSATIONAL_BODIES` from `lib/conversation.mjs`.

**`citations: []` on this kind is not an uncited defect.** The reply makes no
diagnostic claim, so there is nothing for a citation to support — the same
principle that already lets `clarify` through citation-free. **On every other
kind, an empty `citations` array is still a defect and must still render as
`UncitedDefect`.**

### 2.2 The citation payload — unchanged, restated so Stage 4 has it in one place

```jsonc
{
  "source_document": "RT-SVX23R-EN — Precedent Rooftop IOM",  // required, human label
  "page": 84,                                                  // required, integer ≥ 1
  "claim": "Check condenser coil loading first.",              // the statement it supports
  "ordinal": 1,
  "snippet": "…the passage from the chunk…",                   // may be absent pre-sql/006
  "chunk_id": "uuid|null",
  "verified": "exact"
}
```

I changed nothing here and nothing may change it downstream. `source_document`
and `page` are the two fields that make a diagnostic claim renderable; a claim
that reaches the screen without both is the defect `CLAUDE.md` calls
acceptance-critical.

### 2.3 The refusal response — unchanged, and distinguishable from an error

```jsonc
{ "kind": "refusal", "body": "I can't advise on live electrical work.\n\n…",
  "citations": [], "meta": { "category": "live_electrical", "trigger": "action",
  "model": null, "usage": { …zeros… }, … } }
```

A refusal is a **200** with `kind: 'refusal'` and a `meta.category`. An error is
a **non-200** with `{status, message}` and optionally `providerBlocked`. They are
different HTTP outcomes with different shapes; nothing renders one as the other.
A conversational reply is neither: 200, `kind: 'conversational'`, **no
`meta.category`, no `meta.trigger`, no `providerBlocked`** — asserted.

### 2.4 `POST /suggest-units` (new)

**Request** — `{ "query": "48LC" }`. Text-only, under the existing 32 KiB
`LIMIT`. Behind the same bearer gate as every other POST route.

**Response, 200:**

```jsonc
{
  "suggestions": [
    {
      "manufacturer": "Carrier",
      "family": "48/50LC single package rooftop 4-6 ton",
      "documentIds": ["doc_1f…", "doc_9c…"],
      "label": "Carrier — 48/50LC single package rooftop 4-6 ton",
      "matchedOn": "model"            // 'model' | 'manufacturer'; model sorts first
    }
  ]
}
```

- **Empty is `{"suggestions": []}` with a 200.** There is no not-found shape and
  no error shape for "nothing matched" — nothing matching is a normal answer.
- **At most 8**, deterministically ordered: model matches first, then
  manufacturer, then alphabetical by manufacturer then family. The same query
  always yields the same list in the same order.
- **`label` is rendered as sent.** Do not compose a display string from the
  parts: a label assembled client-side is a second place the corpus is described.
- **`documentIds` is passed verbatim** into `requestDiagnosis`. Never re-derive
  it, never trim it. It is identical to what `/resolve-unit` returns for that
  manufacturer + family.
- **Errors:** the standard `{status, message}` on non-200 (confirmed live: a
  server with no Supabase env returns `500 {"status":500,"message":"Missing
  EXPO_PUBLIC_SUPABASE_URL…"}` and stays up).

**The client already exists — do not write a second one.**
`requestSuggestUnits(query, cancel)` in `app/lib/diagnose.ts` returns
`Promise<UnitSuggestion[]>` and **resolves to `[]` for every failure there is**:
no server configured, unreachable, non-200, malformed body, timeout, or the abort
a newer keystroke fires. It never throws and there is nothing to render an error
card for. `app/lib/suggest.ts` also exports `MIN_QUERY_CHARS` (3),
`SUGGEST_DEBOUNCE_MS` (250), `SUGGEST_TIMEOUT_MS` (4000) and
`worthSuggesting(query)` — use those constants rather than new literals.

---

## 3. BLOCKED — the SQL the owner must run

**`sql/015_conversational_kind.sql` is written and committed but NOT APPLIED.**
No stage applies SQL; the owner runs it by hand. Until it is applied:

- a **guest** gets the conversational reply correctly (state only, nothing
  written), and
- **every signed-in technician's first "thanks" is a failed insert**, because
  `sql/002:39` constrains `kind` to `('user','answer','clarify','refusal')`.

This is the only blocked item in the wave. Everything else in F2 and F3 is
complete and green.

Paste-able block — this is the whole file's operative content:

```sql
set search_path = public, extensions;

alter table public.messages drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
  check (kind in ('user', 'answer', 'clarify', 'refusal', 'conversational'));
```

Guarded, re-runnable, and additive: every value legal before is still legal, so
it cannot invalidate an existing row. It touches one CHECK constraint on
`public.messages` — no column, no policy, no grant, no index, no function, and
neither `documents` nor `chunks`.

**Verify it took**, either in the SQL editor:

```sql
select pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.messages'::regclass and conname = 'messages_kind_check';
```

or by running `npm run verify:sessions`, which now includes check 6b — it inserts
and deletes a `conversational` turn through the anon key carrying a real user's
JWT, which is the write path the app actually uses. **That check fails today and
is meant to**; it turns green the moment the migration is applied.

---

## 4. How the two domain rules are enforced, and where the tests are

### Cite every claim

Enforced by construction on the new path, not by a check afterwards:

| mechanism | where |
|---|---|
| The conversational body is a **constant**. No model is called, so no model text can reach it | `lib/conversation.mjs` `CONVERSATIONAL_BODIES` |
| The model is **never told this kind exists** — `RESPONSE_SCHEMA`'s enum is unextended and `SYSTEM`/`buildPrompt` never mention it | asserted, `diagnose.conversation.test.mjs` |
| `validateAnswer` has **no** conversational branch, so the kind cannot arrive from model JSON | asserted, same file |
| The bodies contain **no numbered line, no bulleted line, no `Reading:` marker, no digit at all, no equipment noun and no hazard-domain noun** — the machine form of "carries no diagnostic claim" | `conversation.test.mjs` AC 5 block |
| The bodies make **no coverage claim** — "the manuals I hold", never "I have that unit" | asserted |
| Every citation still carries `source_document` + `page`; `validateAnswer` and retrieval are byte-unchanged | existing `lib/diagnose.test.mjs` etc., all passing unmodified |
| A suggestion is a coverage claim, so every suggestion is re-verified `covered` with ≥ 1 document over the **whole manifest, every 3-character prefix in it** | `lib/units.suggest.test.mjs` AC 2 |

### Advise-only, with hard refusals

| mechanism | where |
|---|---|
| `classifyHazard` **stays first**. Source-order assertion: hazard call site < conversational call site < unit gate | `diagnose.conversation.test.mjs` AC 1 |
| **The proof the story asked for**: `"thanks, I'll just jumper the safety out"` → `kind: 'refusal'`, `category: 'live_electrical'`, `trigger: 'action'` with `completeFn` **and** `embedFn` **and** `db.rpc` **and** `db.from` all rigged to throw if called. That asserts no model call and no retrieval, not that the output looked right | `diagnose.conversation.test.mjs` AC 2 |
| One phrasing from each of the other two categories, prefixed with an allow-listed acknowledgement, same throwing stubs | AC 3 |
| A hazard in a **history** turn still refuses when the new symptom is conversational | AC 4 |
| The classifier itself refuses hazardous input (C1, belt and braces) | `conversation.test.mjs` |
| `refusalLeaksProcedure` is false for all three bodies, and re-run at emit time in `diagnose()` | `conversation.test.mjs` C6 + `diagnose.mjs` |
| C5 reuses `safety.mjs`'s own `CATEGORIES[].domain` rather than a second list that could drift | `HAZARD_DOMAIN_PATTERNS` |
| The safety gate's patterns are **unchanged** — `safety.matrix.test.mjs` passes unmodified | full suite |

**Fixtures for Stage 5.5.** The eval's two properties are already exercised
here and the fixtures are reusable as-is: `POSITIVE` (28 phrasings) and
`NEGATIVE` (20 diagnostic phrasings, including the false-negative-direction case
`"that worked, now it's short cycling"`) in `lib/conversation.test.mjs`, and
`PREFIXED_HAZARDS` in `lib/diagnose.conversation.test.mjs` — which is exactly
ST-F09 AC 4's `"thanks, " + probe` shape.

---

## 5. Verifying each acceptance criterion

Brief AC 2 and AC 3 are the two this wave answers.

**Brief AC 2** — *"that worked" gets a conversational reply carrying no
diagnostic claim and no citation; a hazardous message still refuses
deterministically; a diagnostic question still returns a cited answer. All three
proven, including over the wire.*

| half | how to verify | status |
|---|---|---|
| conversational, uncited, no claim | `node --test lib/conversation.test.mjs lib/diagnose.conversation.test.mjs` | green (83 tests) |
| hazard still refuses, with zero spend | the throwing-stub test above | green |
| diagnostic still cited | existing diagnose suites, unmodified | green |
| **over the wire** | ran all three against a live `serve.mjs` on this branch — outputs in §2.1 and §2.3; `meta.budget.used` stayed `0/20` across all of them | done for two of three; **the cited-answer case needs Supabase + Gemini env and is ST-F08's (Test), as the wave plan has it** |

**Brief AC 3** — *typing a partial manufacturer or model suggests only units the
live corpus can answer on, derived from the database rather than a fixed list.*

| half | how to verify | status |
|---|---|---|
| only answerable units | `node --test lib/units.suggest.test.mjs` — every corpus prefix, every suggestion re-verified `covered` | green, >100 suggestions checked |
| derived from the database, not a list | the manufacturer-name grep over the comment-blanked function body; `suggestUnitsLive` reads `documents` per call | green |
| partial manufacturer | `"tra"` → Trane families; `"car"` → Carrier | green |
| partial nameplate prefix | `"48LC"`/`"50LC"` → the `48/50LC` document; `"YSC0"`/`"YSC072E3RHB0000"` → the YSC family | green |
| the floor holds | `"48"` and `"tr"` suggest nothing, on the real corpus too | green |
| **live route** | needs `.env`; not runnable in this worktree. Route is proven up, bearer-gated, correctly 404-listed and correctly error-shaped over real HTTP | partial — the live-corpus half is ST-F12's |

**Brief AC 6** — see §6.

---

## 6. Gate status

Run on `stage/backend-fixes`, worktree clean.

| gate | command | result |
|---|---|---|
| test | `npm test` | **511 pass, 0 fail, 0 skipped, 0 todo**, exit 0 |
| lint | `npm run lint` | exit 0 — **0 errors, 0 warnings**, before and after |
| build | `npm run build` (`tsc --noEmit`) | exit 0 |
| secrets | `npm run verify:secrets` | clean — 241 tracked files, 193 commits, no key-shaped string |

**Test count: 392 → 511**, all 119 new. Nothing was modified in an existing
suite except `tests/serve-auth.test.mjs`, which **gained** two cases and lost
none. ST-F05 AC 7's requirement holds: `lib/diagnose.test.mjs`,
`diagnose.gate.test.mjs`, `diagnose.scope.test.mjs`, `diagnose.history.test.mjs`,
`diagnose.photo.test.mjs` and `diagnose.clarify.test.mjs` are **byte-unchanged**.

No new dependency in either `package.json`. No new lint or build warning; the
`MODULE_TYPELESS_PACKAGE_JSON` notice `app/lib/suggest.test.mjs` prints is
pre-existing — `app/lib/identify.test.mjs` prints the identical notice on `main`.

Two gates I did **not** run, honestly:

- `npm run verify:stage5` and `npm run verify:sessions` both need `--env-file=.env`,
  and this worktree has no `.env` and no credentials. `verify:sessions`
  will fail check 6b until §3's migration is applied, by design.
- `/suggest-units` against the live `documents` table — same reason. It is
  proven over real HTTP for routing, auth, 404 listing and error shape.

*Environment note, not a code change:* this worktree had no `node_modules` and no
`HVAC Data/`, so `npm run build` could not resolve `expo/tsconfig.base` and
`ingest/reconcile.scope.test.mjs` failed on a missing directory. I junction-linked
both from the main checkout. Both are gitignored; nothing was committed.

---

## 7. Deferred to Frontend, exactly

Everything below is presentation and is **ST-F07 / ST-F11**, not mine. Build
against §2, not against my code.

**ST-F07 — render a conversational turn.**

1. `Message.tsx` needs a `kind === 'conversational'` branch **placed before**
   the `citations.length === 0` check at `Message.tsx:45`. Today the kind falls
   through to `UncitedDefect`, which is the correct fail-safe and must stay
   behind the new branch — assert its ordering rather than trusting it.
2. No citation chip row, no `CHECK IN THIS ORDER` overline, no step numbering,
   and no `color.refusal*` anything.
3. **Two things you do not need to build**, because they already hold and I
   checked them:
   - `ChatScreen`'s `unanswered` retry (`ChatScreen.tsx:200-204`) derives from
     *the last message being `kind: 'user'`*. A conversational reply is appended
     after the user turn, so the state is unreachable. Assert it; do not add a
     condition.
   - `listSessions`' derived counters (`store.ts:166-174`) count `refused` on
     `kind === 'refusal'` and `citationCount` from actual citation rows. A
     conversational turn is neither. Assert it; do not add a filter.
   - `store.ts` needed **no change** and got none: it passes the wire `kind`
     verbatim (`store.ts:363`) into a field now typed to accept it.

**ST-F11 — the type-ahead UI.**

1. Call `requestSuggestUnits` from `app/lib/diagnose.ts`. **Do not add a second
   fetch and do not import `lib/units.mjs` into the app.**
2. Debounce with `SUGGEST_DEBOUNCE_MS`; abort the in-flight request on a new
   query with the `AbortController` pattern already at `CaptureScreen.tsx:188`.
   An abort resolves `[]`, so no special-casing is needed.
3. Selecting a suggestion must carry `documentIds` **verbatim** into the
   session's scope. Do not call `/resolve-unit` again to "confirm" it — you would
   be re-deriving scope, and the two could differ.
4. Render `label` as sent; use `manufacturer` and `family` for the
   `accessibilityLabel`.
5. A failed lookup renders **nothing** — no error card. `requestSuggestUnits`
   gives you `[]` and no way to tell failure from "nothing matched", on purpose.
6. The confirm button's `disabled` must not depend on the suggestion list. Free
   typing worked before this route existed and must keep working when the server
   is unreachable or `isLive` is false.

I touched no screen, no component and not `app/theme/tokens.ts`.

---

## 8. OPEN QUESTIONs, with the default taken

**OQ-B1 — a suggestion's `documentIds` is often broad (up to ~30 documents for
some Bosch families). Should suggestions narrow it?**
*Default taken: no — keep it byte-identical to `/resolve-unit`.* `classifyUnit`
matches on *any* coverage token by documented design ("requiring all of them
would make a more specific answer from the tech resolve to less"), so a family
whose coverage string contains `residential` or `air handler` pulls in that
manufacturer's siblings. **A technician typing that same text by hand gets
exactly the same scope today**, so this is not a regression and narrowing it here
would create the second definition of "covered" OQ-F3 exists to prevent. It also
is not a citation risk: retrieval still cites what it actually retrieves. If the
owner wants tighter scope, that is a change to `unitMatches` affecting
`/resolve-unit` and `/identify-unit` equally, and belongs in its own story.

**OQ-B2 — non-equipment documents can be suggested.** `"epa"` suggests
*US EPA — Section 608 refrigerant recycling rule*, because `isUnitDocument`
excludes only `doc_type === 'PT Chart'`. *Default taken: leave it.* Those rows
are genuinely answerable and `/resolve-unit` already calls them covered;
narrowing `isUnitDocument` would change U4's verdicts, which this run's brief puts
out of scope. Worth a backlog line, not a fix here.

**OQ-B3 — should a conversational reply be suppressed when the previous
assistant turn was a `clarify` question?** *Default taken: not as a call-site
rule — handled by narrowing the allow-list instead.* `diagnose()` receives
history as `{role, content}` only, with no kind, so it cannot see that the last
turn was a clarification. Excluding bare affirmations from the allow-list (§1)
removes the realistic collision without inventing a new field on the wire. If
ST-F09's eval shows clarify loops being broken, the fix is to narrow further.

---

## 9. CONTRACT MISMATCH / BLOCKED ON KNOWLEDGE

**None.** No story in this wave consumes the retrieval contract, and no
divergence from `025-knowledge.md` was encountered. No ingestion, chunking or
embedding code was read for behaviour or modified.

The one blocked item is §3's migration, which is blocked on the **owner**, not on
Knowledge, and is unblocked by pasting six lines of SQL.
