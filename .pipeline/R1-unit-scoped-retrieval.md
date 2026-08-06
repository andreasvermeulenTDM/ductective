# R1 — Unit-scoped retrieval: one optional parameter on the match functions

**Type:** change request (not a defect) · **Owner:** Knowledge (Stage 2.5)
**Requested by:** Backend (Stage 3), 5 Aug 2026 · **Blocks:** U5, and therefore U4/U6/U7
**Severity:** Critical — U5's DoD cannot be met without it

## What Backend needs

Addendum C makes the unit a first-class part of a session. U5's acceptance is:

> Every retrieval in the session filters to that unit's documents.
> **DoD:** No answer in a session cites a document outside its unit's coverage.

Backend cannot satisfy that against the current `match_chunks` /
`match_chunks_hybrid`, because neither takes a document filter.

## What does *not* need a change — checked first

**U4's unit resolution needs nothing from you.** `public.documents` already carries
`manufacturer`, `coverage`, `in_scope`, `doc_type` and `disposition`, and PostgREST
exposes it. Backend resolves a confirmed unit to its covering documents with an
ordinary select and reads the coverage verdict (in scope / ingested-but-out-of-scope
/ unrecognised) straight off those columns. No RPC, no new view.

That leaves exactly one thing to ask for.

## The ask

An optional document filter on both match functions:

```sql
filter_document_ids text[] default null
```

applied as `and (filter_document_ids is null or c.document_id = any(filter_document_ids))`
in the `where` clause — in `match_chunks`, and in **both** the `vec` and `lex` CTEs
of `match_chunks_hybrid`.

`null` means "no filter", so every existing caller — the smoke set, Stage 5, the
current diagnose path — is unaffected.

### Why an id array rather than manufacturer/model parameters

Keeps the matching semantics in one place. `coverage` is free text, so deciding
whether "48LC" is covered by a document whose coverage reads "48/50 LC 04-06" is
fuzzy matching, and it belongs next to U4's resolution logic in Backend rather than
duplicated in SQL. The function stays dumb: it filters on primary keys it was given.

## Why Backend can't just filter the results client-side

This is the part worth being explicit about, because it looks like it should work.

Filtering after the fact happens **after `limit match_count`**. If the top 8 for a
symptom are all Carrier documents — which is exactly what happens today on a Trane
query — then a Trane-scoped session gets **zero** results, not the best available
Trane ones. Raising `match_count` and over-fetching turns one bad guess into a
tuning parameter and still has no guarantee.

The filter has to be inside the query, before the limit. That is the whole request.

Measured evidence that this is the live failure mode: the Trane Precedent query
currently returns an answer whose **3 of 4 citations are Carrier manuals**. Every
one resolves to a real page and supports its claim generically, so no citation
check catches it — it is the wrong manufacturer's manual for the unit in hand, and
only unit scoping fixes it.

## One implementation gotcha

Adding a parameter with a default via `create or replace function` leaves the old
signature in place as a **separate overload**, and PostgREST then refuses to choose
between them:

```
PGRST203  Could not choose the best candidate function
```

So the migration should `drop function` the prior signature explicitly before
recreating it, and re-issue the `grant execute` on the new one. (Backend hit
`PGRST202` on `match_chunks_hybrid` before `sql/004` was applied, so function
resolution here is already known to be brittle.)

## Suggested acceptance for the change

1. `match_chunks(..., filter_document_ids => null)` returns exactly what it returns
   today — the smoke set score does not move.
2. With an array of one document's id, every returned row has that `document_id`.
3. With an array covering only Trane Precedent documents, the Trane Precedent query
   returns Trane rows only, and more than zero of them.
4. Same three checks against `match_chunks_hybrid`, filter applied in both arms.
5. `grant execute` re-issued; no `PGRST203` from PostgREST.

## Relationship to D2

R1 substantially reduces D2's urgency. D2 (lexical ranking has no term weighting)
matters because cross-manufacturer contamination is currently fought through
ranking. Once retrieval is scoped to the confirmed unit, the contaminating
documents are not candidates at all, and hybrid-vs-vector becomes a question about
ranking *within* a unit's documents rather than about telling manufacturers apart.

D2 is still worth fixing. It stops being the thing standing between the system and
correct citations.

## Not requested, deliberately

- No new view, no materialised set, no `unit` table. `documents` already answers
  the question.
- No change to `scope_only`. Phase-1 scope and unit scope are different filters and
  should stay separable — U4 needs to distinguish "out of Phase 1 scope" from
  "unrecognised", and collapsing them would erase that distinction.
