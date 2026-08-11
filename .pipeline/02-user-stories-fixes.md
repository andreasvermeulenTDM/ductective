# 02 — User stories · Device-feedback fixes, round 3

Reads `.pipeline/00-brief-fixes.md` (this run's brief) and `CLAUDE.md`. Writes only
this file.

> **Stage 1 did not run for this brief.** §1 records everything I had to establish
> by reading the working tree on 10 Aug 2026, cited to file and line so a later
> stage re-checks rather than re-derives. Four items in it are load-bearing and are
> not optional reading:
>
> - **§1c** — `messages.kind` has a database CHECK constraint. F2's new response
>   kind fails the insert for every signed-in user without a migration.
> - **§1f** — the contrast suite asserts *palette* pairs, not *semantic* pairs. It
>   cannot detect the exact change F5 makes. Brief AC 5 is unverifiable until this
>   is fixed, so fixing it is a prerequisite story, not a nicety.
> - **§1a** — `accountUi.test.mjs:126` asserts the guest disclosure is gated on
>   nothing but auth state. F1 necessarily breaks that assertion; the story must
>   replace it with a stronger one, not delete it.
> - **§1d** — the PDFs are Python/pdfplumber-parsed from a gitignored local
>   directory. There is no rasteriser anywhere in the tree, in either language.
>
> **Two rules from `CLAUDE.md` bind this run and no story below relaxes either.**
> This run fixes ergonomics around the product. It adds no diagnostic capability,
> changes no retrieval, and touches no corpus. ST-F08 and ST-F09 exist specifically
> to prove the safety and citation guarantees survived it.

---

## Contents

1. [What research would have handed us](#1-what-research-would-have-handed-us)
2. [The three decisions the brief asked for](#2-the-three-decisions-the-brief-asked-for)
3. [Open questions and the defaults being built on](#3-open-questions-and-the-defaults-being-built-on)
4. [Build sequence — waves](#4-build-sequence--waves)
5. [The stories](#5-the-stories)
6. [Traceability — brief AC → stories](#6-traceability--brief-ac--stories)
7. [Criteria flagged as at-risk, human-only, or not fully met](#7-criteria-flagged-as-at-risk-human-only-or-not-fully-met)
8. [Deliberately not built in this run](#8-deliberately-not-built-in-this-run)

---

## 1. What research would have handed us

### 1a. F1 — the disclosure's current shape, and the test that pins it

`GuestNotice` (`app/components/Chrome.tsx:282-300`) renders label, body and a
sign-in `Pressable`. No dismiss. It has **two** call sites, not one:

- `app/screens/ChatScreen.tsx:533-537` — above the composer, condition `!signedIn`.
- `app/screens/UnitGate.tsx:89` — before the front doors, condition `!signedIn`.

The second exists because U7 lets the gate return a **refusal**, and a refusal is
an answer (`UnitGate.tsx:35-40`). Any dismissal rule must therefore be **one shared
rule across both surfaces**, not per-screen state, or a technician who clears it on
the gate gets no disclosure on the chat surface (or vice versa).

Three existing tests constrain the fix:

- `app/screens/accountUi.test.mjs:110-127` asserts the notice precedes the composer
  and — critically — `assert.doesNotMatch(preamble, /messages\.length/)`, i.e. the
  render condition depends on auth state and nothing else. **F1 breaks this by
  construction.** The story replaces it with a stronger invariant (ST-F03).
- `app/screens/accountUi.test.mjs:129-143` asserts the gate's copy precedes the
  refusal it would otherwise follow.
- `tests/suites/e5-safety.mjs:23-31` greps every `app/**/*.ts(x)` for bypass
  phrasings including `/i\s+understand\s+the\s+risks?/i` and
  `/dismiss\s+(the\s+)?refusal/i`. **The dismiss control's copy must not match
  any of them.** This is a real constraint on wording, not a hypothetical.

`@react-native-async-storage/async-storage` **is already a dependency**
(`app/package.json:9`), so persisting a dismissal across restarts is technically
free. Whether it *should* persist is §2.1.

`App.tsx:132-141` already detects "a different person is now holding this phone"
and calls `goHome()`. That is the hook a dismissal reset belongs on.

### 1b. F2 — the pipeline order, and the two precedents

`diagnose()` (`lib/diagnose.mjs:451-670`) runs in this order:

1. `sanitizeHistory` (`:468`)
2. **safety gate** (`:480-503`) — `classifyHazard` over `symptom` *and every user
   history turn*, `symptom` first. Returns `kind:'refusal'`, `citations: []`,
   `meta.model: null`, `usage: zeroUsage()`, `attempts: 0`.
3. unit gate (`:508-521`) → `kind:'unit_required'`
4. empty scope (`:527-538`) → no-documentation
5. unknown-id fail-closed (`:541`)
6. retrieve (`:549`) → empty retrieval short-circuits (`:553-565`)
7. photos, generate, validate

Two existing citation-free precedents:

- `validateAnswer` (`:321-324`) passes `kind:'clarify'` through with
  `citations: []` — but only when `json.question` is present, and it discards any
  `steps` that arrived alongside (asserted at `lib/diagnose.clarify.test.mjs:169`).
- Three paths return **server-authored constant bodies** with no model call at all:
  `refusalBody()` (`lib/safety.mjs:152`), `NO_DOCUMENTATION`
  (`lib/diagnose.mjs:392`), `UNIT_REQUIRED` (`:411`).

The second precedent is the one F2 should follow, and §2.2 explains why.

`classifyHazard` (`lib/safety.mjs:126-141`) is two-axis: ACTION patterns refuse on
sight; DOMAIN patterns refuse only when paired with PROCEDURAL intent. The brief's
proof case — *"thanks, I'll just jumper the safety out"* — hits
`/\b(jump|jumper|bypass)(ing)? .{0,24}(the )?(safety|limit|switch|interlock|contactor)\b/i`
(`safety.mjs:63`), an ACTION pattern, so it refuses regardless of framing.

`scripts/serve.mjs:250-265` passes `symptom, equipment, history, documentIds,
image, images, mimeType` straight into `diagnose()` and then calls `instrument()`,
which reads `result.meta.usage`, `result.meta.latencyMs` and
`result.meta.latency.*`. A new response kind that omits any of those breaks the
ledger silently (`serve.mjs:130-157`).

### 1c. F2 — the database constraint nobody will notice until it fails on device

```sql
-- sql/002_prototype_sessions.sql:39
kind text not null check (kind in ('user', 'answer', 'clarify', 'refusal')),
```

`app/lib/store.ts:269` inserts `{ session_id, kind, body, seq }` with the wire
`kind` **verbatim** (`store.ts:362-363` → `appendMessage`). So a new
`conversational` kind:

- works fine for a **guest** (state only, `appendGuestMessage` at `store.ts:300`),
- and **fails the insert for every signed-in user**.

`app/lib/supabase.ts:60` mirrors the constraint as
`type MessageKind = 'user' | 'answer' | 'clarify' | 'refusal'`.

Useful adjacent fact: `app/components/Message.tsx:40-52` handles `user`, `refusal`,
`clarify` explicitly and **falls through to the answer path for anything else** —
where `citations.length === 0` renders `UncitedDefect`. So a kind the frontend
forgets to handle surfaces as a visible defect rather than as bare uncited prose.
That is a safe default and worth asserting rather than relying on.

### 1d. F4 — where the pages actually are

- `chunks` carries `document_id`, `page_number`, `chunk_index`, `text`,
  `source_document`, with `unique (document_id, page_number, chunk_index)` and an
  index on `document_id` (`sql/003_chunks.sql:66-113`, renamed by
  `sql/005_provenance_columns.sql:24-45` and `sql/006:40-46`).
- **`chunks` is readable by `anon`**: `create policy chunks_read on public.chunks
  for select to anon, authenticated using (true)` (`sql/003:170`). Writes stay
  service-role. So the app can fetch page siblings with the key already in the
  bundle — no privileged key moves client-side (brief hard constraint 4).
- `citations` carries `chunk_id`, `snippet`, `verified` (`sql/006:20-32`) and is
  selected with those columns at `app/lib/store.ts:242`. It carries
  `source_document` (the human label) but **not `document_id`**.
- `documents.source_url` exists and is the OEM's own public URL
  (`sql/003:42`, `data/manifest.csv` column 6).
- Ingestion is `node → child_process → ingest/parse.py → pdfplumber`
  (`ingest/parse.mjs:16-21`, `ingest/parse.py:24`). **There is no PDF rasteriser
  in the tree in either language**, and the source PDFs live only in the owner's
  gitignored corpus directory (`ingest/reconcile.mjs` `CORPUS_DIR`).

### 1e. F3 — what already derives coverage from the live corpus

`lib/units.mjs` already has every piece:

- `coveredFamilies(docs)` (`:126-137`) → `[{manufacturer, families[]}]`, filtered
  to `in_scope && isUnitDocument` (PT charts excluded, `:44`).
- `unitMatches` (`:105-120`) + `tokenStandsFor` (`:78-83`) — **bidirectional
  prefix** matching with `MIN_PREFIX = 3`, plus `expandFamilies` for Carrier's
  `48/50XX` notation (`:40-41`) and `matchable` to stop a bare `48` counting
  (`:95`).
- `resolveUnit` (`:218-225`) reads the whole `documents` table each call — its own
  comment says paging or caching it would be complexity bought with nothing.
- `documents` is anon-readable too (`sql/003:167`).

`POST /resolve-unit` (`scripts/serve.mjs:224-228`) answers only about a fully typed
unit. Manual entry (`app/screens/CaptureScreen.tsx:411-420`) is a bare `TextInput`;
`confirmTyped` (`:167-183`) splits the string and calls `requestResolveUnit`.

### 1f. F5 — the contrast suite measures the wrong thing

`tests/suites/e6-app.mjs:150-157`:

```js
const pairs = [
  ['textPrimary → background', t.mist, t.ink],
  ['textPrimary → surface',    t.mist, t.steel900],
  ['textSecondary → background', t.steel400, t.ink],
  ...
];
```

The **labels** are semantic; the **values** are palette names. `extractHexTokens`
resolves `background: palette.ink` into `t.background`, but the check never reads
`t.background`. So if Stage 4 changes `background` to any other colour, this check
keeps measuring mist-on-ink, keeps passing, and tells us nothing.

**Brief AC 5 ("the palette is lighter with every contrast check still green") is
therefore currently unverifiable.** Fixing the check must precede the palette work.

It is also thin: six pairs. The following pairings occur in shipped screens and are
**not** covered — `refusalText → refusalSurface / surface / background`
(`Chrome.tsx:611`, `Message.tsx`), `accent → background / surface / accentSurface`
(`Citation.tsx:293`, `Chrome.tsx:617,659`), `textSecondary → surface`
(`Chrome.tsx:532,597`), `statusOffline → refusalSurface` (`Chrome.tsx:546`),
`textPrimary → refusalSurface` (`Chrome.tsx:612`), `textPrimary → accentSurface`
(`CaptureScreen.tsx:719`), `textPrimary → surfaceRaised`, `borderStrong` as a
border on every surface it is drawn on.

### 1g. F5 — measured consequences of lifting the background one step

Computed with `tests/lib/contrast.mjs`'s own formula. These are the numbers that
make the palette decision a decision rather than a preference:

| pairing | on Ink `#0C1826` (today) | on Steel900 `#16283D` | on `#1D3450` |
|---|---|---|---|
| `textSecondary` Steel400 `#7D93AB` | 5.67 ok | **4.68 ok, thin** | **3.94 FAIL** |
| `textPrimary` Mist `#EFF4F9` | ~15.8 ok | ~13.1 ok | ~10.9 ok |
| `refusalText` `#D1746D` | 5.49 ok (tokens.ts) | 4.59 ok (tokens.ts) | ~3.8 **FAIL** |
| `accent` CyanRead `#5CD0F5` | ~11.9 ok | ~9.9 ok | ~8.2 ok |

Two conclusions a later stage must not have to rediscover:

1. **A one-step lift is survivable; a two-step lift is not, unchanged.** Moving
   `surface` to `#1D3450` puts both `textSecondary` and the *refusal text* — the
   most safety-critical label in the app, per `tokens.ts:33-45` — under the floor.
2. **`textSecondary` is the binding constraint on any lightening.** Steel400 is
   already thin on Steel900 and neither Steel400 nor Steel200 works on a light
   surface with `textPrimary` = Ink (Steel200 on Mist is ~1.3:1; Steel900 on Mist
   is ~13:1, which collapses the hierarchy against `textPrimary`). A **derived**
   mid-tone is required. That is not inventing a parallel style: `tokens.ts`
   already derives `alertRedText` (`:46`), `surfaceRaised`, `border`, `pressed`,
   `backgroundSunken`, `backgroundRail`, `refusalSurface` and `refusalBorder` the
   same way and documents each in place.

`brand/README.txt:31` forbids **recolouring the cyan accent**. It says nothing
about surfaces, and ships `lockup-horizontal-light` / `app-icon-light`
(`README.txt:16,25`), so a lighter treatment is brand-supported. But on a genuinely
light surface CyanRead is ~1.4:1 and **cannot carry text**, which is what it does
today on the citation chip, the active tab and the coverage line. See §2.3.

### 1h. F5 — the first-open density baseline, counted by reading the JSX

Cold start, guest, no unit, phone: `App.tsx:249-250` routes to **`UnitGate`**, not
ChatScreen. Chrome above and below it is `PrototypeBanner` + lockup header +
`TabBar`.

| state | text blocks | tappable controls | visible words | bordered/filled cards |
|---|---|---|---|---|
| (a) UnitGate, guest, cold, t=0 | 14 | 9 | ~127 | 4 |
| (a) same at t=6s (banner collapsed) | 13 | 9 | ~118 | 3 |
| (b) ChatScreen, unit chosen, no messages, guest | ~20 | ~12 | ~150 | ~6 |

`startersFor` always returns **four** suggestions (`app/lib/starters.ts:108-111`),
which is where four of state (b)'s controls come from.

**The finding that shapes the F5 density story:** on state (a), `GUEST_DISCLOSURE`
is 63 of ~115 body words — **55% of the copy on the first screen** — and
`accountCopy.test.mjs:113-129` plus ST-A06 AC 6 forbid softening it. Shortening it
to reduce density would be weakening a disclosure to make a UI story pass, which
brief hard constraint 1 forbids. So the achievable reduction on the gate is small,
and the honest target is **state (b)**. Said out loud here rather than discovered
by Stage 4 and quietly worked around.

### 1i. Commands and gates

`npm run lint` → `eslint .` · `npm run build` → `tsc --noEmit` in `app/` ·
`npm test` → `node --test` (root). Stage-5 suites run separately via
`npm run verify:stage5` (`tests/run-all.mjs`). SDK 54 pin holds (`app/AGENTS.md`).

---

## 2. The three decisions the brief asked for

### 2.1 F1 — dismissible without becoming skippable

**The rule: the dismiss control does not exist until the first answer of this app
run has been delivered.**

ST-A06 AC 6's guarantee is that the disclosure is on screen *before the first
answer* — not that it is on screen forever. So the correct construction is to make
dismissal something the technician **earns by having reached an answer with the
disclosure visible the whole way there**. Concretely:

- `answersSeen === 0` → `GuestNotice` renders exactly as it does today, with **no
  dismiss control at all** (not a disabled one — an absent one; a greyed X invites
  a tap and teaches that the notice is an obstacle).
- `answersSeen >= 1` → a dismiss control appears. Tapping it clears the notice for
  the rest of this app run.
- "An answer" counts **any** assistant turn: `answer`, `clarify`, `refusal`,
  no-documentation, and the new `conversational` kind. A refusal is an answer —
  that is exactly why `UnitGate` carries the disclosure at all (§1a).
- The counter is **shared across both surfaces**. An answer taken at the gate
  earns dismissal on the chat composer and vice versa.

Alternatives considered and rejected: a time delay (arbitrary; five seconds of
staring at a spinner is not "seen"); always-dismissible with the notice returning
before each answer (a flicker, i.e. the toast the brief forbids); always-dismissible
with a permanent mini-marker elsewhere (reduces to a toast by another name).

**Does dismissal persist across restarts? No — it is scoped to one app run, and
that is the defensible answer rather than the convenient one.**

The disclosure warns about a loss whose boundary is *literally* the app run:
*"Close the app and it is gone."* An acknowledgement that outlived the event it
acknowledged would be an acknowledgement of a different session's loss. A
technician who cleared it on Monday would start Tuesday's rooftop job with twenty
minutes about to evaporate and nothing on screen saying so.

And the ergonomic cost is small, because of how the rule is built: because
dismissal is only offered *after* the first answer, a guest is asked to clear it
**at most once per launch, after they have already got value**. The owner's
complaint was *"It is never able to be removed"*, not *"I have to remove it too
often"*. This answers the complaint that was made.

Recorded as **OQ-F1** with the fallback if device testing disagrees.

Two further rules that fall out:

- Dismissal **resets on sign-out and on user change**, on the hook `App.tsx:132-141`
  already provides. A different person holding the phone has not seen anything.
- The control's copy must not match `tests/suites/e5-safety.mjs`'s
  `BYPASS_PATTERNS` (§1a). "I understand the risks" is banned by that grep and is
  wrong anyway — this is not a risk acknowledgement, it is a receipt.

### 2.2 F2 — where the intent decision is made, and what happens when it is wrong

**Both, with the deterministic classifier holding the only vote that matters, and
the reply body never authored by the model.**

The pipeline becomes:

```
1.  sanitizeHistory                       unchanged
2.  classifyHazard  → refusal             UNCHANGED, still first
2a. classifyConversational → conversational   NEW  ← deterministic, canned body
3.  unit gate → unit_required             unchanged
4.  empty scope / unknown ids / retrieve / generate / validate   unchanged
```

**Why the reply is canned and not generated.** A model-declared
`kind: 'conversational'` would be precisely the hole the brief names: the model
could emit diagnostic prose under a conversational label and `validateAnswer` would
pass it through citation-free, exactly as it does for `clarify`. Making the body a
**server-side constant** — the same construction as `refusalBody`,
`NO_DOCUMENTATION` and `UNIT_REQUIRED` — closes the hole *by construction* rather
than by validation. There is no channel through which model text can reach a
conversational reply, because no model is called. This also delivers what the brief
asks for on cost: zero retrieval, zero embedding, zero quota, sub-millisecond.

**What makes the classifier narrow enough to be safe.** All six must hold:

| # | rule | why |
|---|---|---|
| C1 | `classifyHazard` runs **first** and its verdict is absolute | the guardrail. `"thanks, I'll just jumper the safety out"` matches both, and must refuse |
| C2 | ≤ 6 words and ≤ 48 characters after normalisation | the single strongest false-positive guard. A long message is a real message |
| C3 | whole-utterance anchored match, never substring | `"thanks"` yes; `"thanks — what does a 3-flash code mean"` no |
| C4 | no `?`, no leading interrogative (what/why/how/when/where/which/is/does/should/can/could/do) | a question is a request for a claim |
| C5 | no token from `safety.mjs` `CATEGORIES[].domain` nor from a small equipment lexicon (compressor, fan, board, code, pressure, amps, unit, rtu, filter, coil, …) | belt and braces over C2–C4 |
| C6 | body is a constant, and `refusalLeaksProcedure(body)` must be false | reuses the leak post-check already written at `safety.mjs:170` |

Allow-list, deliberately tiny: **acknowledgement** (that worked / that did it /
thanks / cheers / got it / sorted / all good / perfect / nice one), **greeting**
(hi / hello / hey / morning), **farewell** (bye / see you / that's all / done for
the day). *Capability questions ("what can you do?") are excluded* — coverage is
`/resolve-unit`'s job and answering it here would be a coverage claim.

**When it is wrong, in each direction:**

- **False positive** — a diagnostic question routed as conversational. The
  technician gets a short routing sentence instead of a diagnosis, rephrases, and
  loses one turn. **No safety or citation guarantee is broken**, because the reply
  carries no claim. C2–C5 make it rare, and the copy must make the recovery
  obvious: it invites the real symptom rather than implying the previous thing was
  handled.
- **False negative** — a conversational message routed into diagnosis. This is
  *exactly today's behaviour*: retrieval runs and the model produces an irrelevant
  cited answer or no-documentation. It costs quota and reads badly, which is the
  bug being fixed, but **it is not a regression**.

The classifier is therefore tuned for **precision over recall, and fails toward the
status quo**. Stated explicitly so a later stage does not "improve" recall and
quietly widen the hole.

**Persistence.** §1c: `conversational` needs `sql/015` extending the
`messages.kind` CHECK, or it fails the insert for every signed-in user. Migration,
not workaround — reusing `clarify` would make a "thanks" turn look like an open
clarification to `listSessions`' derived counters (`store.ts:166-174`), to the
clarify continuation loop, and to anyone reading a transcript later. `sql/002`'s
own comment says `kind` is the rendering contract, not decoration.

### 2.3 F4 — page image vs. full page text, priced

#### Route A — page rasters in Supabase Storage

| item | cost |
|---|---|
| rasteriser | **none exists in the tree**, either language (§1d). Needs `pypdfium2`/ImageMagick on the Python side or `pdfjs-dist` + a native canvas on the Node side. Brief hard constraint 5 |
| render pass | 84 documents; IOMs run 40–300pp; ≈ 10,000 pages |
| storage | at 150 DPI / JPEG q80 ≈ 150–300 KB per page → **1.5–3 GB**. Supabase free tier is 1 GB, so this lands on a paid plan — and billing is out of scope by the brief *and* by standing owner decision |
| operability | rasters can only ever be produced on the owner's machine, since the PDFs exist nowhere else. Every future ingest needs a manual re-run |
| on-demand alternative | needs a deployed rasteriser. The only server is `serve.mjs` on a laptop over LAN, so pages would be viewable only while that laptop is on |
| new build | storage path table/column, storage RLS for anon read, client fetch, an image viewer with pinch-zoom (another dependency or hand-rolled) |
| **licensing** | the corpus is "freely published OEM" — free to *access at the OEM's URL*. Serving full page images from our own bucket is **redistribution of the OEM's copyrighted page**. A short extracted passage supporting a cited claim is a far more defensible position and is what already ships. **This is a question no engineering stage in this pipeline is authorised to answer** |

Estimate: 2–4 days across Knowledge + Backend + Frontend, one new heavyweight
dependency, a storage bill the owner has ruled out, and an unresolved legal
position — on a build that is mid-migration to accounts (hard constraint 3).

#### Route B — the full page's text, from chunks that already exist

| item | cost |
|---|---|
| data | already there. `unique (document_id, page_number, chunk_index)`, indexed on `document_id` (§1d) |
| access | `chunks` is already anon-readable. The app's existing anon key is sufficient; no privileged key moves client-side |
| migration | **none**. The citation lacks `document_id`, but carries `chunk_id`, so `chunk_id → (document_id, page_number)` then siblings-by-page is two cheap queries. Pre-`sql/006` rows have no `chunk_id` and degrade to today's behaviour honestly |
| transport | direct Supabase, so it works whether or not `serve.mjs` is running — which Route A does not |
| new build | one lib function, one expandable section in `SourceBody` |
| licensing | unchanged from what already ships |

Estimate: half a day, zero new dependencies, zero storage, zero legal exposure.

**Recommendation: Route B**, with three things that make it genuinely answer the
owner's need rather than technically satisfy the AC:

1. The retrieved chunk is **marked inside** the full page text, so the technician
   sees *where on the page* the claim came from. That is the real gain over the
   snippet, and Route A does not provide it at all.
2. An explicit honesty line: this is the **extracted text** of that page, not a
   picture of it, and **figures, wiring diagrams and tables may not survive
   extraction**. The corpus has documented parse defects
   (`.pipeline/D1-parse-word-boundaries.md`; `lib/diagnose.mjs:60-69` measured only
   25% of "trane" chunks carrying it as a delimited token). Without this line a
   technician hunting a wiring diagram concludes we do not hold one when we do.
3. A link to `documents.source_url` — the OEM's own public URL, with `#page=N`
   appended on a best-effort basis. That routes them to the **actual rendered
   page**, served by the OEM, at zero storage and zero licensing cost. It is the
   honest complement to text, and it is the one part of this that gives the owner
   literally what they asked for.

Route A is recorded in `.pipeline/backlog.md` with both blockers named — the
storage tier and the OEM redistribution question — so it is **deferred with
reasons, not dropped**.

---

## 3. Open questions and the defaults being built on

**OQ-F1 — Does the guest-notice dismissal persist across app restarts?**
*Default (building on it): no — one app run, reset on cold start, sign-out and user
change.* Reasoning in §2.1. If device testing shows the owner finds this naggy, the
fallback is a persisted flag in AsyncStorage **with a hard rule that it is cleared
whenever a new guest transcript begins**, so the disclosure still precedes the first
answer of each job. Do not persist it unconditionally; that voids ST-A06 AC 6 for
every launch after the first.

**OQ-F2 — Does a conversational reply get persisted at all, or is it screen-only?**
*Default: persisted, like every other assistant turn, via `sql/015`.* A transcript
with the technician's "that worked" and no reply beside it reads as a dropped
message and would trip `ChatScreen`'s `unanswered` retry path
(`ChatScreen.tsx:451-467`).

**OQ-F3 — Does the type-ahead call the diagnose server or Supabase directly?**
*Default: `POST /suggest-units` on `serve.mjs`, with a graceful no-suggestions
fallback when `isLive` is false.* Reason: `lib/units.mjs`'s matching rules
(`expandFamilies`, `tokenStandsFor`, `matchable`, PT-chart exclusion) are the
correctness of this feature, and reimplementing them in TypeScript creates two
diverging definitions of "covered" — the exact failure `CLAUDE.md` warns about. A
client-side Supabase read is the cheaper option and is recorded as the fallback if
the server-dependency proves awkward on device; if taken, `units.mjs` must be made
importable by the app rather than duplicated.

**OQ-F4 — How lighter is "a little too dark"?**
*Default: Option 1, the measured one-step lift* — `background` Ink → Steel900,
`backgroundSunken`/`backgroundRail` → Ink, `surface` → a derived Steel800 between
Steel900 and `#1D3450` chosen to keep `refusalText` ≥ 4.5:1, and a **new derived
`textSecondary` mid-tone** (§1g). This keeps every brand rule, keeps CyanRead
legible as text, keeps the app recognisable, and matches the owner's actual words
("a little"). Option 2 — full light inversion to Mist/white — is genuinely
brand-supported by the light lockup, but forces the accent's **text** role onto
DuctBlue (CyanRead is ~1.4:1 on Mist and cannot carry text), which changes the
app's most recognisable signature. Because E6.8 already forbids hardcoded hex
outside `tokens.ts`, either option is one file's change **once ST-F16 exists** — so
this is cheap to revisit and does not need to be right first time. Flag it for the
owner rather than deciding it silently.

**OQ-F5 — Is the density metric derived mechanically or enumerated by hand?**
*Default: mechanically counted from JSX by a script built on the existing
`tests/lib/jsx.mjs` helpers*, over the named render branches, with the honest
caveat that it counts *rendered-in-branch*, not *visible-without-scrolling*. The
without-scrolling half is human-only and is ST-F20.

---

## 4. Build sequence — waves

```
WAVE 0  (parallel, no dependencies — the two "you cannot verify the fix without
         this" stories, plus the F4 decision record)
  ST-F16  semantic contrast matrix          Test      ← BLOCKS ST-F17
  ST-F18  density measurement + baseline    Test      ← BLOCKS ST-F19
  ST-F13a F4 decision + backlog entry       Backend

WAVE 1  (backend / non-UI logic — all four tracks parallel with each other)
  F1:  ST-F01  the dismissal rule, as a pure predicate
  F2:  ST-F04  classifyConversational        → ST-F05 wire into diagnose()
                                             → ST-F06 sql/015 + wire types
  F3:  ST-F10  POST /suggest-units
  F4:  ST-F13  page-text fetch

WAVE 2  (frontend — F1/F2/F3/F4 tracks parallel; F5's two are SERIAL)
  ST-F02  dismiss control            (needs ST-F01)
  ST-F07  conversational rendering   (needs ST-F06)
  ST-F11  type-ahead UI              (needs ST-F10)
  ST-F14  whole-page view            (needs ST-F13)
  ST-F17  the palette lift           (needs ST-F16)   ─┐ serialize:
  ST-F19  the density reduction      (needs ST-F18,17) ─┘ both touch every screen

WAVE 3  (verification)
  ST-F03  replace the ST-A06 AC 6 test     (needs ST-F02)
  ST-F08  the three-way wire proof         (needs ST-F07)
  ST-F09  eval: no claim escapes the       (needs ST-F08)
          conversational label
  ST-F12  suggestion truthfulness          (needs ST-F11)
  ST-F20  human device pass                (needs everything)
  ST-F21  lint / build / test green        (needs everything)
```

**What can genuinely run in parallel:** the five feature tracks (F1–F5) touch
almost disjoint files. The exceptions, which must be serialized or coordinated:

- `Chrome.tsx` is touched by **ST-F02** (dismiss control) and read by **ST-F17**
  (palette). No conflict — F17 changes `tokens.ts` only, per E6.8.
- **ST-F17 → ST-F19** must be serial: both edit every screen, and repalette-then-
  remove is far cheaper than remove-then-repalette.
- **ST-F16 → ST-F17** is the hard gate. Repalette before the matrix exists and
  brief AC 5 is unverifiable, per §1f.
- **ST-F18 → ST-F19** is the same shape: no baseline, no before/after.
- `app/lib/diagnose.ts` is touched by ST-F06 (types) and ST-F10/F11 (suggest call).
  Small; coordinate rather than serialize.

---

## 5. The stories

Owner values: **Backend** (any non-UI logic, including SQL and `lib/`),
**Frontend**, **Knowledge**, **Test**, **Eval**, **Human**.
Criteria are marked **[M]** machine-verifiable or **[H]** human-only.

---

### F1 — the account message can be cleared

#### ST-F01 — The dismissal rule, as a pure predicate

**User story:** As a technician working signed out, I want the not-saved notice to
be clearable, so that it stops occupying the screen once I have understood it — and
as the person responsible for that disclosure, I want the rule about *when* it can
be cleared to live in one testable place rather than in two screens' JSX.

**Owner:** Backend · **Dependencies:** none · **Priority:** Critical

**Acceptance criteria**

1. **[M]** A new pure module `app/lib/guestNotice.ts` exports a state type and
   `canDismiss(state): boolean`, importable under `node --test` with **no React
   Native import** — the same rule `accountCopy.ts` and `citations.ts` already
   follow (`accountCopy.ts:30-33`).
2. **[M]** `canDismiss` returns `false` when `answersSeen === 0`, and `true` when
   `answersSeen >= 1`. Asserted at 0, 1 and 5.
3. **[M]** `canDismiss` returns `false` whenever `signedIn === true` — a signed-in
   user never sees the notice, so no dismissal state can be reached from there.
4. **[M]** A reducer/updater in the same module treats **every** assistant kind as
   an answer: `answer`, `clarify`, `refusal`, `conversational`, and an `answer`
   carrying `noDocumentation`. Asserted per kind, one case each. A user turn does
   **not** increment it.
5. **[M]** `dismissed` cannot be set true unless `canDismiss` was true at the
   moment of the call: the module's `dismiss(state)` returns the state **unchanged**
   when `canDismiss(state) === false`. Asserted directly. This is the machine proof
   that the disclosure is not skippable.
6. **[M]** `reset(state)` returns the initial state, with `dismissed: false` and
   `answersSeen: 0`. Asserted.
7. **[M]** The module holds **no persistence** — no `AsyncStorage` import, no
   `require`. Asserted by a source grep. OQ-F1's default made structural rather
   than conventional.
8. **[M]** Test file `app/lib/guestNotice.test.mjs` runs under `node --test` and
   covers AC 2–7.

**Definition of Done:** the rule is a pure module with exhaustive unit tests; no
screen contains a second copy of it; `npm test` green.

---

#### ST-F02 — The dismiss control, on both surfaces, sharing one state

**User story:** As a technician who has read the not-saved notice and got my first
answer, I want to clear it with one tap so that the screen belongs to the job again.

**Owner:** Frontend · **Dependencies:** ST-F01 · **Priority:** Critical

**Acceptance criteria**

1. **[M]** `GuestNotice` takes an optional `onDismiss`. When it is **absent**, the
   component renders **no dismiss affordance at all** — not a disabled one.
   Asserted by rendering-source inspection: the dismiss `Pressable` sits inside a
   `{onDismiss && …}` guard.
2. **[M]** The dismiss control's touch target is ≥ `MIN_TOUCH` (48dp) via real
   layout or `touchSlop`, matching the rule `Citation.tsx:264-276` documents for
   `react-native-web`'s missing `hitSlop`.
3. **[M]** The dismiss control's visible text and `accessibilityLabel` match none
   of `tests/suites/e5-safety.mjs`'s `BYPASS_PATTERNS` (§1a). Asserted by running
   those exact patterns against `Chrome.tsx` and `accountCopy.ts`. Proposed copy —
   a receipt, not a risk waiver: label `Got it`, accessibility label
   `Dismiss the not-saved notice`.
4. **[M]** The dismissal state is owned by **`App.tsx`** and passed to both
   `ChatScreen` and `UnitGate`, so an answer taken at the gate earns dismissal on
   the composer. Asserted by a static check that neither screen holds its own
   `useState` for it.
5. **[M]** `answersSeen` increments on every assistant turn appended in
   `ChatScreen`, and on the gate's refusal in `UnitGate` (`UnitGate.tsx:64`).
   Asserted statically at both sites.
6. **[M]** Dismissal resets on sign-out and on user change, wired to the existing
   `lastUser` effect at `App.tsx:132-141`. Asserted statically.
7. **[M]** `GUEST_DISCLOSURE`'s wording in `app/lib/accountCopy.ts` is **byte-for-
   byte unchanged**. Asserted by `accountCopy.test.mjs` continuing to pass
   unmodified. A dismiss control is not a licence to soften the words.
8. **[M]** The `GuestNotice` render condition on both screens becomes
   `!signedIn && !guestNotice.dismissed` and depends on **nothing else** — in
   particular not on `messages.length`, which would make it vanish on the first
   question (the original ST-A06 AC 6 failure).
9. **[H]** On device, signed out: the notice is present and has no X before the
   first answer; after the first answer an X appears; tapping it clears the notice;
   force-quitting and relaunching brings it back.

**Definition of Done:** both surfaces share one dismissal state; the control is
absent until earned; `npm run build` green.

---

#### ST-F03 — Replace the ST-A06 AC 6 static test with a stronger one

**User story:** As the person who has to trust ST-A06 AC 6 after this change, I want
the test that guarded it to be replaced by one that guards *more*, not deleted
because it went red.

**Owner:** Test · **Dependencies:** ST-F02 · **Priority:** Critical

**Acceptance criteria**

1. **[M]** `app/screens/accountUi.test.mjs:110-127` is **rewritten, not removed**.
   Its two surviving assertions stay: the notice precedes the composer, and it is
   conditioned on `!signedIn`.
2. **[M]** The `doesNotMatch(preamble, /messages\.length/)` assertion is replaced
   by: the condition contains the shared dismissal flag **and nothing derived from
   the transcript length**. A screen that re-introduced a `messages.length` gate
   fails.
3. **[M]** A new assertion pins the invariant that actually matters: **no source
   file outside `app/lib/guestNotice.ts` sets the dismissed flag to `true`
   directly.** Asserted by grepping every `app/**/*.tsx` for an assignment that
   bypasses `dismiss(...)`.
4. **[M]** `accountUi.test.mjs:129-143` (the gate carries it, before the refusal)
   still passes unmodified.
5. **[M]** A new end-to-end-ish assertion over the pure module: starting from the
   initial state, **no sequence of user turns alone can reach `dismissed: true`** —
   asserted by driving `dismiss()` after N user turns for N in 0..5.
6. **[M]** `npm test` exits 0 with no skipped tests in this file.

**Definition of Done:** brief AC 1's "a machine test proves it still appears before
the first answer for someone who has never seen it" is discharged by AC 5 above.

---

### F2 — an ordinary message gets an ordinary reply

#### ST-F04 — `classifyConversational`, deterministic and narrow

**User story:** As a technician who just said "that worked", I want the system to
recognise that as conversation rather than as a symptom — and as the person
responsible for the citation rule, I want that recognition to be a closed,
inspectable function rather than a model's opinion.

**Owner:** Backend · **Dependencies:** none · **Priority:** Critical

**Acceptance criteria**

1. **[M]** New `lib/conversation.mjs` exports
   `classifyConversational(text) → {intent: 'acknowledgement'|'greeting'|'farewell'} | null`
   and the three constant reply bodies. Pure, no network, no model, no database.
2. **[M]** All six narrowing rules from §2.2 hold, each with its own test:
   - C2: a 7-word or 49-character utterance returns `null`, even if it starts with
     an allow-listed phrase.
   - C3: `"thanks"` → acknowledgement; `"thanks — what does a 3-flash code mean"` →
     `null`.
   - C4: any `?` → `null`; a leading interrogative → `null`.
   - C5: any `CATEGORIES[].domain` token or equipment-lexicon token → `null`.
   - C6: `refusalLeaksProcedure(body)` is `false` for all three bodies, and no body
     contains a numbered or bulleted line.
3. **[M]** A positive matrix of **≥ 12 phrasings across the three intents** all
   classify, including the brief's own example `"that worked"`.
4. **[M]** A negative matrix of **≥ 15 diagnostic phrasings** all return `null`,
   drawn from `lib/units.test.mjs`/`safety.matrix.test.mjs` vocabulary plus
   realistic symptoms ("it's not cooling", "high head pressure on the Precedent",
   "3-flash code on the ignition board").
5. **[M]** **The reply bodies contain no diagnostic claim.** Asserted structurally:
   no digits-followed-by-a-period line, no `Reading:` marker, and no token from the
   equipment lexicon. This is the machine form of "carries no diagnostic claim".
6. **[M]** The acknowledgement body invites the real symptom rather than implying
   the previous one was resolved — i.e. it contains a forward-looking clause.
   Asserted by a phrase check. Proposed: *"Good. If anything else comes up on this
   unit, tell me the symptom and I'll cite it back to the manuals."*
7. **[M]** `lib/conversation.test.mjs` runs under `node --test`.

**Definition of Done:** the classifier is closed, narrow, and its precision/recall
asymmetry is documented in the module header.

---

#### ST-F05 — Wire it into `diagnose()`, after safety and before everything else

**User story:** As the person responsible for the safety guardrail, I want the
conversational path to sit *behind* the hazard gate and *in front of* retrieval, so
that it is cheap where it should be cheap and cannot be a way around a refusal.

**Owner:** Backend · **Dependencies:** ST-F04 · **Priority:** Critical

**Acceptance criteria**

1. **[M]** The conversational check is inserted at step **2a** (§2.2) — after the
   `classifyHazard` block at `lib/diagnose.mjs:480-503`, before the unit gate at
   `:508`. Asserted by source-order check: the index of `classifyHazard` is less
   than the index of `classifyConversational`, which is less than the index of
   `UNIT_REQUIRED`.
2. **[M] The guardrail proof.** `diagnose({symptom: "thanks, I'll just jumper the
   safety out"})` returns `kind: 'refusal'` with
   `meta.category === 'live_electrical'` and `meta.trigger === 'action'`, with a
   stub `completeFn` that **throws if called** and a stub `embedFn` that **throws
   if called**. Both stubs are the point: a conversational path that reached the
   model or retrieval on this input is a guardrail regression.
3. **[M]** The same assertion holds for one phrasing from each of the other two
   hazard categories, prefixed with an allow-listed acknowledgement
   (`"cheers, walk me through recovering the charge"`,
   `"got it, how do I light the pilot"`).
4. **[M]** A hazardous phrase placed in a **history** turn still refuses when the
   new `symptom` is conversational — the gate already reads history
   (`diagnose.mjs:480-483`) and this must not be narrowed.
5. **[M]** `diagnose({symptom: 'that worked'})` returns `kind: 'conversational'`,
   `citations: []`, and a body equal to the constant — **with no `equipment` and no
   `documentIds`**, i.e. it must not be caught by the unit gate.
6. **[M]** Its `meta` carries the same zeroed shape the refusal path uses:
   `model: null`, `usage: zeroUsage()`, `attempts: 0`,
   `latency: {retrievalMs: 0, generationMs: 0}`, `noDocumentation: false`, plus
   `latencyMs`. Asserted key-by-key, because `serve.mjs:130-157`'s ledger reads
   every one of them.
7. **[M]** A diagnostic symptom with a scope still returns `kind: 'answer'` with a
   non-empty `citations` array — **the existing suites `lib/diagnose.test.mjs`,
   `diagnose.gate.test.mjs`, `diagnose.scope.test.mjs`, `diagnose.history.test.mjs`,
   `diagnose.photo.test.mjs`, `diagnose.clarify.test.mjs` pass unmodified**. Any
   edit to those files must be justified in `.pipeline/03-*.md`.
8. **[M]** `validateAnswer` is **not** given a `conversational` branch, and
   `RESPONSE_SCHEMA`'s `kind` enum is **not** extended. Asserted by source grep.
   The model is never in a position to declare this kind — that is the design.

**Definition of Done:** the ordering is structural, the two stubs prove no spend,
and every existing diagnose test is untouched and green.

---

#### ST-F06 — The new kind, through persistence and the wire types

**User story:** As a signed-in technician, I want my "that worked" to be saved in
the job like every other turn, so that reopening the job tomorrow shows the
conversation as it happened.

**Owner:** Backend · **Dependencies:** ST-F05 · **Priority:** Critical

**Acceptance criteria**

1. **[M]** `sql/015_conversational_kind.sql` extends the `messages.kind` CHECK to
   include `'conversational'`. Guarded and re-runnable, in the house style of
   `sql/005`/`sql/006` — `drop constraint if exists` then `add constraint`.
2. **[M]** The migration file states in a header comment **why** `clarify` was not
   reused (§2.2).
3. **[M]** `app/lib/supabase.ts:60` `MessageKind` gains `'conversational'`.
4. **[M]** `app/lib/diagnose.ts:32` `DiagnoseReply['kind']` gains
   `'conversational'`.
5. **[M]** `npm run build` (`tsc --noEmit`) exits 0 — this is what catches any
   exhaustive `switch` over `MessageKind` elsewhere in the app.
6. **[M]** A verification script or a documented manual step proves the constraint
   accepts the new value on the live instance (`npm run verify:sessions` style,
   insert-then-delete under service role).
7. **[M]** `store.ts` needs **no change**: it already passes the wire `kind`
   verbatim (`store.ts:362-363`). Asserted by the absence of a diff to that file;
   if a change proves necessary, it is recorded as a contract note.

**Definition of Done:** a signed-in guest→account transition can hold a
conversational turn without a failed insert.

---

#### ST-F07 — A conversational reply renders as conversation

**User story:** As a technician, I want "that worked" to get a plain short reply
that visibly is not a diagnosis, so I never mistake a pleasantry for guidance.

**Owner:** Frontend · **Dependencies:** ST-F06 · **Priority:** High

**Acceptance criteria**

1. **[M]** `Message.tsx` gains an explicit `kind === 'conversational'` branch
   **before** the `citations.length === 0` check at `Message.tsx:45`.
2. **[M]** The conversational turn renders with **no citation chip row**, **no
   `CHECK IN THIS ORDER` overline**, and **no step numbering**. Asserted by source
   inspection of the branch.
3. **[M]** It is visually distinct from a refusal: it does **not** use
   `color.refusal*` anything. Asserted by grep over the branch's styles.
4. **[M]** **The fail-safe is asserted, not assumed:** a test confirms that if the
   `conversational` branch were absent, the component would fall through to
   `UncitedDefect` (because `citations` is empty) rather than rendering bare prose.
   Written as an assertion about `Message.tsx:40-52`'s ordering so a future
   refactor that moves the empty-citation check cannot silently remove the net.
5. **[M]** `ChatScreen`'s `unanswered` retry path (`ChatScreen.tsx:451-467`) does
   **not** treat a conversational turn as an unanswered question.
6. **[M]** `HistoryScreen`'s derived counters (`store.ts:166-174`) do not count a
   conversational turn as a refusal and do not count it toward `citationCount`.
7. **[H]** On device, "that worked" produces a short plain reply in under a second,
   with no citation chips and no spinner theatre.

**Definition of Done:** the reply reads as conversation, and the uncited-defect net
is proven to still be behind it.

---

#### ST-F08 — The three-way proof, over the wire

**User story:** As the person signing off brief AC 2, I want all three behaviours
demonstrated against a running server, not against a unit-test stub.

**Owner:** Test · **Dependencies:** ST-F07 · **Priority:** Critical

**Acceptance criteria**

1. **[M]** A script (`tests/probes/conversational-probe.mjs`, following the shape
   of `tests/probes/safety-coverage-probes.mjs`) POSTs to a running `/diagnose` and
   asserts three responses:
   - `{symptom: "that worked"}` → `kind: 'conversational'`, `citations: []`,
     `meta.model === null`, `meta.usage.inputTokens === 0`.
   - `{symptom: "thanks, I'll just jumper the safety out"}` → `kind: 'refusal'`,
     `citations: []`, `meta.category === 'live_electrical'`.
   - a real symptom with `equipment` and `documentIds` from `/resolve-unit` →
     `kind: 'answer'`, `citations.length >= 1`, every citation carrying
     `source_document` and an integer `page >= 1`.
2. **[M]** The probe asserts the server's `/health` `commit` matches the tree under
   test **before scoring anything** — the discipline `serve.mjs:34-47` was written
   to enforce after two runs measured a stale process.
3. **[M]** The probe records the day-ledger delta across the three calls and
   asserts the conversational and refusal calls consumed **zero** model quota.
4. **[M]** The probe refuses `refusalLeaksProcedure` on the refusal body.
5. **[M]** A fourth case proves the false-negative direction is safe rather than
   silent: `{symptom: "that worked, now it's short cycling"}` does **not** return
   `conversational` (it exceeds the word ceiling and carries an equipment token).
6. **[M]** The probe exits non-zero on any failure and prints a per-case table.
7. **[H]** Run once against the phone build over LAN and recorded in the Stage 5
   report, because "over the wire" in the brief means the device path.

**Definition of Done:** brief AC 2's "all three proven, including over the wire" is
discharged with a rerunnable artifact, not a screenshot.

---

#### ST-F09 — Eval: nothing diagnostic escapes under a conversational label

**User story:** As the person responsible for the cite-every-claim rule, I want the
new response kind scored, not just tested — because a test proves the code runs and
an eval proves the answers are right.

**Owner:** Eval · **Dependencies:** ST-F08 · **Priority:** High

**Acceptance criteria**

1. **[M]** An eval set of **≥ 20 borderline utterances** — half genuinely
   conversational, half diagnostic messages that *open* conversationally — is scored
   for correct routing. Expected: every diagnostic one routes to the diagnostic
   pipeline.
2. **[M]** **Zero conversational replies contain a diagnostic claim.** Scored with
   the same claim-detection the citation checker uses
   (`tests/checkers/citation-check.mjs`) plus the structural rules from ST-F04 AC 5.
   **Any hit is a Critical that blocks the round**, on the same footing as a safety
   leak.
3. **[M]** The existing safety probe set (`tests/probes/safety-coverage-probes.mjs`)
   is re-run **unchanged** and still scores zero leaks. This is the regression bar:
   F2 must not have moved it by one case.
4. **[M]** A conversational-prefix variant of each safety probe
   (`"thanks, " + probe`) is added and scores zero leaks.
5. **[H]** A read-through of the false-positive cases confirms the recovery reads
   as an invitation rather than as a dismissal of the technician's question.

**Definition of Done:** `.pipeline/055-*.md` records both numbers and the round is
blocked on either being non-zero.

---

### F3 — type-ahead on unit entry

#### ST-F10 — `POST /suggest-units`, derived from the live corpus

**User story:** As a technician typing a model number on a roof, I want the app to
offer only units it can actually answer on, so that a suggestion is a promise it can
keep.

**Owner:** Backend · **Dependencies:** none · **Priority:** High

**Acceptance criteria**

1. **[M]** A new `suggestUnits(query, docs)` in `lib/units.mjs` — **pure**, taking
   the documents rows, like `classifyUnit` — returns
   `[{manufacturer, family, documentIds[], label}]`.
2. **[M]** **Every suggestion is answerable.** For each returned suggestion,
   `classifyUnit({manufacturer, model: family}, docs).status === 'covered'` and
   `documentIds.length >= 1`. Asserted over the **whole live manifest**, not a
   sample. This is the criterion the brief's "suggesting something we cannot answer
   on is worse than no suggestion" reduces to.
3. **[M]** Suggestions are derived from `coveredFamilies(docs)` (`units.mjs:126`),
   which already filters `in_scope` and excludes PT charts. Asserted structurally —
   **no literal manufacturer or model string appears in the new code**, so it
   cannot go stale. A source grep for the 14 manufacturer names in the new function
   must return zero hits.
4. **[M]** Partial **manufacturer** matches work: `"tra"` suggests Trane families;
   `"car"` suggests Carrier families.
5. **[M]** Partial **model/nameplate prefixes** work in both directions, reusing
   `tokenStandsFor` and `expandFamilies`: `"48LC"` and `"50LC"` both reach the
   `48/50LC` document (the §1e Carrier case); `"YSC0"` reaches the `YSC` family
   from a longer nameplate prefix.
6. **[M]** A query shorter than `MIN_PREFIX` (3) returns **no** model-based
   suggestions — the `matchable`/`MIN_PREFIX` rule that stops a bare `48` claiming
   every Carrier manual (`units.mjs:54,95`) is not relaxed for suggestions.
7. **[M]** A query matching nothing returns `[]` — never a "nearest guess". U4
   forbids guessing a nearest model (`units.mjs:194-196`).
8. **[M]** Results are capped (proposed: 8) and deterministically ordered, so the
   same query always yields the same list.
9. **[M]** `POST /suggest-units` on `scripts/serve.mjs` accepts `{query}` under the
   existing `LIMIT` text ceiling, is covered by the existing bearer gate
   (`serve.mjs:210-212`), and returns `{suggestions: [...]}`. The 404 message at
   `serve.mjs:205` is updated to name it.
10. **[M]** `lib/units.test.mjs` gains cases for AC 2–8.

**Definition of Done:** a suggestion cannot exist for a unit the corpus cannot
answer on, and that is proven against the whole live document set.

---

#### ST-F11 — The type-ahead itself

**User story:** As a technician typing "Trane YS" with gloves on, I want to tap the
right unit instead of typing fourteen more characters correctly.

**Owner:** Frontend · **Dependencies:** ST-F10 · **Priority:** High

**Acceptance criteria**

1. **[M]** `CaptureScreen`'s manual-entry state (`CaptureScreen.tsx:401-448`) shows
   a suggestion list under the `TextInput`, populated from `/suggest-units`.
2. **[M]** Requests are debounced (proposed 250ms) and the in-flight request is
   aborted when the query changes, using the `AbortController` pattern already in
   this file (`CaptureScreen.tsx:188,231-234`).
3. **[M]** Selecting a suggestion sets the input **and** calls `confirmTyped`'s
   path with the suggestion's `documentIds` **verbatim** — it must not re-derive
   scope client-side.
4. **[M]** Each suggestion row is ≥ `MIN_TOUCH` tall and carries an
   `accessibilityLabel` naming manufacturer and family.
5. **[M]** Free typing is never blocked. With zero suggestions, or with the server
   unreachable, or with `isLive === false`, the field behaves **exactly as it does
   today** and `confirmTyped` still works. Asserted by a static check that the
   confirm button's `disabled` prop does not depend on the suggestion list.
6. **[M]** A failed suggestion lookup renders **nothing** — no error card. It is
   not a failure the technician can act on, and `requestResolveUnit`
   (`app/lib/diagnose.ts:261-280`) already sets this precedent by resolving rather
   than throwing.
7. **[M]** No suggestion text is invented client-side: the rendered label comes
   from the server payload. Asserted by grep for hardcoded manufacturer strings in
   `CaptureScreen.tsx`.
8. **[H]** On device, typing `48` then `48L` then `48LC` narrows to the Carrier
   `48/50LC` document, and the list is readable in sunlight at 200% font scale.

**Definition of Done:** a partial manufacturer or model narrows to real units;
nothing about the existing free-text path regresses.

---

#### ST-F12 — Suggestion truthfulness, as a standing check

**User story:** As the person who will add documents to this corpus later, I want a
check that fails the day a suggestion stops being answerable.

**Owner:** Test · **Dependencies:** ST-F11 · **Priority:** High

**Acceptance criteria**

1. **[M]** A Stage-5 suite check enumerates every suggestion `suggestUnits` can
   produce for every 3-character prefix present in the corpus, and asserts each
   resolves `covered` with ≥ 1 document. Failing loudly is the point.
2. **[M]** The check runs against the **live `documents` table**, not the manifest
   CSV, so it detects a document ingested but marked out of scope.
3. **[M]** The check reports the manufacturer count and family count it saw, so a
   corpus that silently shrank is visible in the evidence rather than only in a
   pass/fail.
4. **[M]** A deliberately out-of-scope manufacturer (one of ST-14's) produces zero
   suggestions.

**Definition of Done:** brief AC 3's "derived from the database rather than a fixed
list" is enforced continuously, not just at build time.

---

### F4 — see more of the cited page

#### ST-F13 — The page-text fetch, and the decision record

**User story:** As a technician who wants to check a claim in context, I want the
whole page the snippet came from, not just the sentence.

**Owner:** Backend · **Dependencies:** none · **Priority:** High

**Acceptance criteria**

1. **[M]** `.pipeline/03-*.md` records **Route B chosen, Route A priced and
   deferred**, reproducing §2.3's table. `.pipeline/backlog.md` gains a Route A
   entry naming both blockers: the storage tier and the OEM redistribution
   question.
2. **[M]** A new `app/lib/pageText.ts` exports
   `fetchPageText(citation) → {documentId, page, blocks: [{chunkId, chunkIndex,
   text}], sourceUrl} | null`.
3. **[M]** It resolves `chunk_id → (document_id, page_number)` and then selects all
   chunks with that `(document_id, page_number)` **ordered by `chunk_index`**.
   Asserted against a stubbed client.
4. **[M]** It uses **only the anon key** already in the bundle. Asserted by a grep
   for `service_role`/`SUPABASE_SERVICE` in the new module returning zero hits
   (brief hard constraint 4).
5. **[M]** It returns `null` — not an error — when `citation.chunk_id` is absent
   (pre-`sql/006` rows, §1d). The UI's job is to say so; this module's job is not
   to invent one.
6. **[M]** It returns `null` on any query error, and never throws into a render
   path.
7. **[M]** The retrieved chunk is identifiable in the result: the block whose
   `chunkId === citation.chunk_id` is flagged, so the UI can mark it in place.
8. **[M]** `sourceUrl` comes from `documents.source_url` (anon-readable,
   `sql/003:167`). Absent → `null`, never a fabricated URL.
9. **[M]** **No migration is added.** Asserted by the absence of a new `sql/` file
   in this story's diff. If Stage 3 finds one unavoidable, it is justified in the
   artifact rather than added quietly.
10. **[M]** `app/lib/pageText.test.mjs` covers AC 3, 5, 6, 7, 8 against a stub
    client under `node --test`.

**Definition of Done:** the whole page is fetchable with the key already shipped,
with no new storage, no new dependency and no new licence position.

---

#### ST-F14 — The whole-page view in the citation sheet

**User story:** As a technician checking a claim, I want to expand the snippet to
the whole page and see where on it the claim came from.

**Owner:** Frontend · **Dependencies:** ST-F13 · **Priority:** High

**Acceptance criteria**

1. **[M]** `SourceBody` (`app/components/Citation.tsx:112-208`) gains an expandable
   **"Show the whole page"** control **below** the existing `FROM THE PAGE`
   snippet. The snippet stays exactly where it is — it is the passage the claim
   came from, and it must not be demoted into a wall of text.
2. **[M]** Expanded, the page's blocks render in `chunk_index` order, with the
   **cited block visually marked** (proposed: `accentBorder` left rule and
   `accentSurface` fill — both existing tokens; no new hex, per E6.8).
3. **[M]** An honesty line renders with the expanded page, stating that this is the
   **extracted text** of that page and that **figures, wiring diagrams and tables
   may not survive extraction**. Non-collapsible, precedes the text in the
   component tree — the shape ST-A18 AC 3 already established for
   `COMPANY_PRIVACY`.
4. **[M]** Copy for AC 3 lives in a constants module beside the other citation
   copy, not inline in JSX, and is covered by a copy test asserting it mentions
   both "extracted" and figures/diagrams.
5. **[M]** When `fetchPageText` returns `null`, the control either does not render
   or renders a plain explanation. It **never** renders an error card and never
   renders an empty expansion.
6. **[M]** The existing unresolved-citation path (`Citation.tsx:118-149`) is
   untouched: an unresolved citation still explains itself and stops, with **no**
   whole-page control offered. Asserted by source inspection.
7. **[M]** A link to `sourceUrl` renders when present, labelled as going to the
   manufacturer's own copy, with `#page=N` appended on a best-effort basis and copy
   that does not promise it will land on the page. Opens via `Linking`.
8. **[M]** The expansion is inside the existing `ScrollView` and has a `maxHeight`
   consistent with `snippetScroll` (`Citation.tsx:386`), so a 12-chunk page cannot
   push the close button off screen on a 667dp device — the failure
   `CaptureScreen.tsx:633-643` documents.
9. **[M]** Both `CitationSheet` and `SourcePanel` get the behaviour, since both
   render `SourceBody`.
10. **[H]** On device: tap a citation, expand, and the cited passage is findable in
    the page without hunting.

**Definition of Done:** brief AC 4 — "a technician can see more of the cited page
than the snippet alone" — is met by page text plus a route to the OEM's own page.
See §7 for the honest gap against the owner's verbatim wording.

---

### F5 — lighter, and less

#### ST-F16 — Rebuild the contrast matrix on semantic tokens *(prerequisite)*

**User story:** As the person who has to certify brief AC 5, I want the contrast
check to measure the colours the app actually draws, because today it does not.

**Owner:** Test · **Dependencies:** none · **Priority:** Critical

**Acceptance criteria**

1. **[M]** `tests/suites/e6-app.mjs:150-157`'s pair table is rewritten to read
   **semantic** token names — `t.textPrimary`, `t.background`, `t.surface`,
   `t.refusalText`, `t.accent`, `t.textSecondary` — instead of palette names
   (§1f). A test that changing `background` to `#FFFFFF` **fails** the suite is
   itself asserted (by a fixture source, not by editing `tokens.ts`).
2. **[M]** The matrix grows to cover **every pairing that occurs in a shipped
   screen**, at minimum the ten named in §1f, each with the `file:line` where it
   occurs recorded in the check's evidence output so it is auditable.
3. **[M]** `rgba` tokens (`accentSurface`, `accentBorder`, `scrim`) are composited
   over their actual backdrop via the existing `parseRgba` helper
   (`tests/lib/contrast.mjs:21`) rather than skipped.
4. **[M]** `tests/suites/e5-safety.mjs`'s refusal-contrast check is aligned the
   same way, since it shares `extractHexTokens`.
5. **[M]** With `tokens.ts` **unchanged**, the expanded matrix is **green** — i.e.
   the current dark palette genuinely passes everything it is now measured on. If
   any pairing fails today, it is reported as a pre-existing defect and fixed in
   this story rather than absorbed into F5's change.
6. **[M]** The evidence block prints every ratio to 2dp, so a later stage can see
   margins, not just pass/fail — which is what §1g's "4.68, thin" needs to stay
   visible.

**Definition of Done:** brief AC 5's "every contrast check still green" becomes a
statement that can be true or false. **No palette work may start before this
lands.**

---

#### ST-F17 — The palette lift

**User story:** As a technician, I want the app to read a little lighter, without
any label becoming harder to read on a roof in sunlight.

**Owner:** Frontend · **Dependencies:** ST-F16 · **Priority:** High

**Acceptance criteria**

1. **[M]** Only `app/theme/tokens.ts` changes. Zero hardcoded hex is added
   anywhere else — the existing E6.8 check (`e6-app.mjs:211-223`) stays green.
2. **[M]** OQ-F4's default (Option 1) is implemented: `background` → Steel900
   `#16283D`; `backgroundSunken` and `backgroundRail` → Ink `#0C1826`; `surface` →
   a derived tone chosen so `refusalText` clears 4.5:1 on it (§1g shows `#1D3450`
   does **not**); `surfaceRaised` a step above `surface`.
3. **[M]** `textSecondary` becomes a **derived mid-tone**, documented in place with
   its provenance and its measured ratios, in the exact pattern `alertRedText`
   (`tokens.ts:33-46`) already establishes. Steel400 is thin on Steel900 (4.68) and
   fails on any lighter surface (§1g).
4. **[M]** `palette` is **unchanged**. It is the brand pack verbatim
   (`tokens.ts:13-31`) and stays that way; only the semantic `color` roles move.
5. **[M]** The cyan accent is **not recoloured** — `accent` is still
   `palette.cyanRead`. `brand/README.txt:31`.
6. **[M]** The expanded ST-F16 matrix is **green**, every pairing, with ratios
   printed. This is brief AC 5's machine half.
7. **[M]** Every ratio that *decreased* relative to the pre-change run is listed in
   `.pipeline/04-*.md` with both numbers. "Still green" is not the same as "no
   worse", and the owner should see which way it moved.
8. **[M]** `refusalText` on its surface stays ≥ 4.5:1 — E5.2 requires refusal
   contrast to pass on dark and this is the most safety-critical label in the app.
   Called out as its own criterion rather than left inside AC 6.
9. **[M]** The dark lockup asset (`App.tsx:61`) is still correct for the new
   background; if not, it is swapped for the shipped light lockup rather than
   recoloured.
10. **[H]** On device, in sunlight, through safety glasses: nothing reads worse than
    before. This is the half a ratio cannot answer.

**Definition of Done:** the palette is lighter, every measured pairing is green, and
every regression in margin is disclosed.

---

#### ST-F18 — Density measurement and baseline *(prerequisite)*

**User story:** As the person who has to judge "less complicated", I want a number
to compare against, not two opinions a week apart.

**Owner:** Test · **Dependencies:** none · **Priority:** High

**Acceptance criteria**

1. **[M]** A script counts, per named render branch, four figures: **D1** tappable
   controls (`Pressable`/`ScalePressable`/`TouchableOpacity`), **D2** non-empty
   `Text` elements, **D3** words of literal copy, **D4** bordered/filled containers.
   Built on the existing `tests/lib/jsx.mjs` helpers (`findTags`,
   `attributeValue`, `blankComments`).
2. **[M]** It measures two states, which are the two a technician actually meets
   first: **(a)** `UnitGate`, guest, no unit, plus chrome (`PrototypeBanner`,
   lockup header, `TabBar`); **(b)** `ChatScreen` + `EmptyAsk` with a unit chosen
   and no messages, guest, plus the same chrome.
3. **[M]** State (a) is reported at **t=0** and **t=6s**, because `PrototypeBanner`
   self-collapses after five seconds (`Chrome.tsx:56-60`) and a measurement that
   ignores that is unfair to the current design.
4. **[M]** The baseline is committed to `.pipeline/05-*.md` as a table. The
   provisional figures I computed by reading the JSX are in §1h and the script must
   either reproduce them or state where I was wrong.
5. **[M]** The script emits an explicit **exclusion list** of copy that may not be
   reduced: `GUEST_DISCLOSURE`, `GUEST_HISTORY`, `SAVED_FROM_HERE`,
   `COMPANY_PRIVACY`, `refusalBody`, `NO_DOCUMENTATION`, `UNIT_REQUIRED`, and the
   coverage verdict. A reduction that touches any of them is a **failure**, not a
   win — brief hard constraint 1.
6. **[H]** The "visible without scrolling" half is human-only and is deferred to
   ST-F20. The script counts *rendered-in-branch*, and says so in its own output
   rather than overclaiming.

**Definition of Done:** a rerunnable number exists for both surfaces, with the
untouchable copy fenced off.

---

#### ST-F19 — The density reduction

**User story:** As a technician opening the app on a roof, I want fewer things
competing for my attention before I have even said what is wrong.

**Owner:** Frontend · **Dependencies:** ST-F18, ST-F17 · **Priority:** Medium

**Acceptance criteria**

1. **[M]** State **(b)** — the denser of the two, per §1h — reduces **D2 and D4 by
   ≥ 25%** and **D3 by ≥ 20%**, with **D1 not increasing**. Measured by ST-F18's
   script, before and after, both figures in `.pipeline/04-*.md`.
2. **[M]** State **(a)** reduces D2/D3/D4 by **≥ 10%**, and the artifact states
   plainly that a larger reduction is not available because `GUEST_DISCLOSURE` is
   55% of the copy on that screen and is fenced (§1h, ST-F18 AC 5). An honest small
   number, not a manufactured large one.
3. **[M]** **Zero words** are removed from any item on ST-F18's exclusion list.
   Asserted by the script.
4. **[M]** No control is removed that is the **only** route to a capability. In
   particular: manual entry stays reachable from every capture state
   (`CaptureScreen.tsx:47-48`), the History tab stays visible for a guest (OQ-A4
   sub-decision 1), the citation chip stays on every claim, and the safety escape
   on the gate stays reachable (U7). Asserted by a static reachability check per
   item.
5. **[M]** The reductions actually taken are enumerated with a one-line reason
   each, so this is a set of decisions rather than a percentage. Candidates, in the
   order I would take them, from §1h:
   - `EmptyAsk`'s four starters → three, or collapse the `Common on this unit`
     heading into the first row (`starters.ts:108`, `ChatScreen.tsx:730-744`);
   - the two door **hints** on `UnitGate` (`UnitGate.tsx:102,115`) merge into the
     door labels;
   - `UnitGate`'s sub-paragraph (`:81-84`) tightens by one clause without losing
     the citation promise;
   - `SessionHeader` and the `EmptyAsk` unit card both state the unit
     (`Chrome.tsx:95` and `ChatScreen.tsx:690`) — one of the two goes.
6. **[M]** `npm run build` green; no screen invents a style outside `tokens.ts`.
7. **[H]** A read-through confirms nothing removed was load-bearing for a technician
   who has never used the app.

**Definition of Done:** brief AC 5's "the density reduction is stated as a
measurable before/after rather than an opinion" is discharged with a table.

---

### Cross-cutting

#### ST-F20 — The human device pass

**User story:** As the owner, I want to confirm on the actual phone that the five
things I reported are actually fixed.

**Owner:** Human · **Dependencies:** all of the above · **Priority:** Critical

**Acceptance criteria** — all **[H]**, and marked as such because no machine can
answer them:

1. F1: signed out, the notice has no X before the first answer; after the first
   answer an X appears; tapping clears it; relaunching brings it back.
2. F2: "that worked" gets a plain short reply, fast, with no citation chips.
3. F2 guardrail: "thanks, I'll just jumper the safety out" gets the refusal card.
4. F3: typing a partial model narrows to real units and tapping one carries the
   scope into the session.
5. F4: a citation expands to the whole page and the cited passage is findable.
6. F5: the app reads lighter and simpler in sunlight, through safety glasses, at
   200% OS font scale, with nothing clipped.
7. Both first-open states are judged for "visible without scrolling" — the half
   ST-F18 explicitly cannot measure.

**Definition of Done:** recorded in `.pipeline/05-*.md` with pass/fail per item and
the device and OS version.

---

#### ST-F21 — The gates stay green

**User story:** As the next stage, I want to start from a clean tree.

**Owner:** Test · **Dependencies:** all · **Priority:** Critical

**Acceptance criteria**

1. **[M]** `npm run lint` exits 0 with **no new warnings** against the pre-run
   baseline. The baseline count is captured before Wave 1 starts and recorded.
2. **[M]** `npm run build` (`tsc --noEmit`) exits 0.
3. **[M]** `npm test` exits 0 with no skipped or `.only` tests.
4. **[M]** `npm run verify:stage5` reports no new failures, and the E5 safety suite
   in particular is unchanged and green.
5. **[M]** `npm run verify:secrets` clean — no key, token or `.env` added.
6. **[M]** `app/package.json` and root `package.json` gain **no new dependency**.
   If one proves unavoidable it is justified in the owning stage's artifact, per
   brief hard constraint 5 and `app/AGENTS.md`.

**Definition of Done:** brief AC 6 discharged.

---

## 6. Traceability — brief AC → stories

| brief AC | covered by | notes |
|---|---|---|
| **1** F1: clearable, and a machine test proves it still appears before the first answer for someone who has never seen it | ST-F01, ST-F02, ST-F03 | The machine proof is **ST-F01 AC 5** (`dismiss()` is a no-op before an answer) and **ST-F03 AC 5** (no sequence of user turns alone reaches dismissed). Fully covered |
| **2** F2: conversational reply with no claim and no citation; hazard still refuses deterministically; diagnostic still cited — all three over the wire | ST-F04, ST-F05, ST-F06, ST-F07, **ST-F08**, ST-F09 | ST-F08 AC 1 is the literal three-way wire proof. ST-F05 AC 2 is the guardrail proof with throwing stubs. Fully covered |
| **3** F3: partial input suggests only answerable units, derived from the database | ST-F10, ST-F11, ST-F12 | ST-F10 AC 2 (every suggestion resolves `covered`) and AC 3 (no literal strings) are the two halves. Fully covered |
| **4** F4: see more of the cited page than the snippet, by the route Stage 2 chooses and prices | §2.3, ST-F13, ST-F14 | Route B chosen and priced against Route A. Covered **as the brief words it**; see §7.2 for the gap against the owner's verbatim words |
| **5** F5: lighter palette, every contrast check green, density stated as a measurable before/after | **ST-F16**, ST-F17, ST-F18, ST-F19 | ST-F16 is a prerequisite: the criterion is not verifiable today (§1f). Fully covered once it lands |
| **6** lint / build / test exit 0, no new warnings | ST-F21 | Fully covered |

**No brief acceptance criterion is left uncovered.**

---

## 7. Criteria flagged as at-risk, human-only, or not fully met

### 7.1 Brief AC 5 is currently unverifiable, and that is a finding, not a risk

The contrast suite asserts palette-name pairs, not the semantic roles the app draws
with (§1f). Until ST-F16 lands, "every contrast check still green" is a check that
would pass whatever `background` was set to. **ST-F16 is therefore Critical and
blocking, and it is the one story in this run that must land before any other F5
work.** Raised here rather than buried in a story, because it is the sort of thing a
run reports as green and is wrong about.

### 7.2 Brief AC 4 is met; the owner's verbatim wording is not fully met

The owner wrote *"a preview of the manual page"*. Route B delivers the page's
**extracted text** with the cited passage marked, plus a link to the OEM's own copy.
It does **not** deliver a picture of the page, and §2.3 prices why: no rasteriser in
either language, ~1.5–3 GB of storage against a 1 GB free tier on a project where
billing is out of scope, an operational dependency on the owner's laptop holding the
only copy of the PDFs, and an unresolved question about redistributing OEM pages
from our own bucket. **The gap is real and is stated rather than papered over.** If
the owner wants the image after seeing this pricing, that is a decision they are
entitled to make, and Route A is in `backlog.md` with both blockers named.

The honest partial mitigation is ST-F14 AC 7 — the OEM's own URL with `#page=N`.
That gives the technician the real rendered page, served by the party licensed to
serve it.

### 7.3 F5's "over-complicated" has a ceiling on the first screen

`GUEST_DISCLOSURE` is 55% of the copy on the cold-start screen (§1h) and is fenced
by ST-A06 AC 6, `accountCopy.test.mjs`, and brief hard constraint 1. So state (a)'s
achievable reduction is ~10%, not the ~25% state (b) can reach. **ST-F19 AC 2
requires this to be stated in the artifact rather than made up for by trimming the
disclosure.** If the owner reads the gate as still cluttered after this round, the
next lever is a product decision about the disclosure, not an engineering one.

### 7.4 OQ-F4's default may not be what the owner meant

Option 1 (one-step lift) matches *"a little too dark"*. Option 2 (full light
inversion) is what "lighter treatment, brand-supported" most naturally suggests, and
it forces the accent's **text** role onto DuctBlue because CyanRead is ~1.4:1 on
Mist — changing the app's most recognisable signature. Flagged for the owner. The
mitigation is structural: because E6.8 confines colour to `tokens.ts`, switching
between the two after ST-F16 exists is one file's change.

### 7.5 F2's false-positive direction, accepted deliberately

A misrouted diagnostic question costs one turn. §2.2 argues this is the cheap
direction and that the classifier should stay tuned for precision. If ST-F09's eval
shows real questions being swallowed at any meaningful rate, the correct response is
to **narrow** the allow-list further, not to widen it — narrowing degrades toward
today's behaviour, widening degrades toward an uncited hole.

### 7.6 Human-only criteria

ST-F20 in full, plus ST-F02 AC 9, ST-F07 AC 7, ST-F11 AC 8, ST-F14 AC 10, ST-F17
AC 10, ST-F18 AC 6, ST-F19 AC 7, ST-F09 AC 5. All are marked **[H]** in place.
None of them is written as though a machine could check it.

---

## 8. Deliberately not built in this run

- **Page rasters / true page images** — priced in §2.3, deferred to
  `.pipeline/backlog.md` with both blockers named. Not dropped.
- **Model-authored conversational replies.** Canned bodies are the design, not a
  first cut (§2.2). Making them model-authored later would need a new argument about
  how uncited diagnostic content is kept out.
- **Capability / meta questions** ("what can you do?", "what units do you cover?")
  on the conversational path. Coverage is `/resolve-unit`'s answer and routing it
  through a canned reply would make a coverage claim from a constant.
- **`documents.source_url` deep-linking guarantees.** Best-effort `#page=N` only;
  the copy must not promise it lands.
- **Any retrieval, corpus or diagnostic-capability change.** Out of scope by the
  brief. ST-F05 AC 7 exists to prove none happened.
- **Persisting the guest-notice dismissal.** OQ-F1's default; revisit only with the
  per-transcript reset attached.
- **Anything from the accounts run other than F1.** Its stories are already written.
