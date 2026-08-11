# 00 — Brief · Device-feedback fixes, round 3

Project: **Ductective** — AI diagnostic assistant for HVAC technicians.

> **A separate run.** `.pipeline/00-brief.md` is Run B's and `00-brief-accounts.md`
> is the accounts run's; both are open. Stage 2 writes
> `.pipeline/02-user-stories-fixes.md`.
>
> **Owner report, 10 Aug 2026, from device testing.** Five items, verbatim below,
> with what I established about each by reading the code.

## The five

### F1 — The account message cannot be dismissed
> *"The account message should be removable with an X or acknowledgement from the
> user. It is never able to be removed currently."*

`GuestNotice` (`app/components/Chrome.tsx:282`) renders the not-saved disclosure
with a sign-in action and **no dismiss control**, so it sits above the composer
permanently for anyone using the app signed out — which is every first-time user.

**The constraint that makes this non-trivial.** ST-A06 AC 6 requires that
disclosure to appear **before the first answer**, and the owner chose
guest-mode-nothing-saved knowingly on the understanding the app would be honest
about the cost. A dismiss control that lets someone skip it before they have seen
it would quietly undo that decision. The fix must let a technician acknowledge and
clear it **without** making the disclosure skippable, and without reducing it to a
toast nobody reads. Whether "dismissed" persists across app restarts is a real
question — record it.

### F2 — An ordinary conversational message gets a manual-shaped reply
> *"I sent a normal message to the chatbot, unrelated to the manuals. Saying
> something like 'That worked' and it did not understand to just give a normal
> response back vs a manual specific response."*

Every `/diagnose` call runs retrieval and prompts the model with `SOURCES`, so
"that worked" is answered as though it were a diagnostic question — the model
either forces an irrelevant cited answer or falls to no-documentation. Both read
as the app not listening.

**What must not be weakened.** A conversational reply makes **no diagnostic
claim**, so it needs no citation — the same principle that already lets `clarify`
through citation-free (`validateAnswer`, `lib/diagnose.mjs`). That is not a licence
to emit uncited *diagnostic* content under a conversational label, and the
distinction is the whole story. The safety gate must still run **first**: "that
worked" is harmless, but "thanks, I'll just jumper the safety out" is not, and a
conversational path that bypasses `classifyHazard` is a guardrail regression. Retrieval
and quota should be skipped where they are not needed, which also makes this cheaper.

### F3 — Unit entry has no type-ahead
> *"The type the unit in feature should allow for type ahead suggestions. If I
> start typing a unit it should suggest units we have data on based on what has
> been typed."*

Manual entry is a free-text field. The corpus is now **84 documents across 14
manufacturers**, and `coveredFamilies()` (`lib/units.mjs`) already derives exactly
the covered manufacturer/coverage list this needs. `/resolve-unit` exists but only
answers about a unit already typed in full.

**Constraint.** A suggestion is a coverage claim. Suggesting something we cannot
answer on is worse than no suggestion, because the technician has been told we have
it. Suggestions must come from the live corpus, never a hardcoded list that can go
stale. Note that `resolveUnit` matches nameplate prefixes now, so suggestions
should work from partial model numbers too.

### F4 — A citation cannot be opened to see the page
> *"When a response comes back tied back to a manual the user should be able to see
> a preview of the manual page that had the result so they can look in more detail
> if needed."*

Tapping a citation opens `CitationSheet` → `SourceBody`
(`app/components/Citation.tsx`), which shows document, page and the **stored
chunk snippet** — the passage the claim came from and nothing around it.

**The hard constraint, and the reason this needs a decision rather than a
build.** The source PDFs are **not in Supabase**. They live in the gitignored
`HVAC Data/` on the owner's machine only. The database stores extracted text, not
pages. So a true rendered page image requires new infrastructure — page rasters
uploaded to storage, with a licensing question attached, since these are OEM
manuals. A cheaper option is to show the **full page's text** by fetching every
chunk with that `document_id` + `page_number`, which needs no new storage and no
new licence position. Stage 2 must choose, price both, and record the choice; do
not assume the expensive one is wanted.

### F5 — The interface is over-complicated and too dark
> *"Revisit the UI - right now it seems a little over complicated and not minimal.
> The color scheme is showing a little too dark."*

Two separate complaints; treat them separately.

`app/theme/tokens.ts` sets `background: #0C1826` (Ink) with `backgroundSunken:
#050B12`. Ink/Steel900/DuctBlue **is** the brand palette — but the brand pack also
ships `lockup-horizontal-light` and `app-icon-light`, so a lighter treatment is
**brand-supported, not an invention**. `brand/README.txt` forbids recolouring the
cyan accent; it does not mandate a dark surface.

**Constraints.** `brand/` and `tokens.ts` remain the source of truth — no screen
may invent a parallel style. The contrast checks in `tests/lib/contrast.mjs` must
stay green; a lighter background changes every foreground pairing, and that is the
real work. On "over-complicated": the owner has already had one cleanup pass, so
Stage 2 should identify *what specifically* is dense — count what a technician
sees on first open — rather than restyling on instinct.

## Out of scope

- Anything in the accounts run that is not F1 (its stories are already written).
- New diagnostic capability, retrieval changes, or corpus changes.
- Billing, the web console, the marketing site.

## Hard constraints

1. **Never weaken a safety or citation guarantee to make a fix simpler.** The
   safety gate runs before anything, every diagnostic claim carries a citation that
   resolves, and a refusal renders as a refusal.
2. `brand/` and `app/theme/tokens.ts` are the visual source of truth.
3. Do not break the device build. It works today and is mid-migration to accounts.
4. The anon key is the only key in the bundle; no story moves a privileged key
   client-side.
5. SDK 54 pin holds (`app/AGENTS.md`); no dependency without justification.

## Acceptance criteria

1. F1: the disclosure can be cleared by the technician, and a machine test proves
   it still appears before the first answer for someone who has never seen it.
2. F2: "that worked" gets a conversational reply carrying no diagnostic claim and
   no citation; a hazardous message still refuses deterministically; a diagnostic
   question still returns a cited answer. All three proven, including over the wire.
3. F3: typing a partial manufacturer or model suggests only units the live corpus
   can answer on, derived from the database rather than a fixed list.
4. F4: a technician can see more of the cited page than the snippet alone, by
   whichever route Stage 2 chooses and prices.
5. F5: the palette is lighter with every contrast check still green, and the
   density reduction is stated as a measurable before/after rather than an opinion.
6. `npm run lint`, `npm run build`, `npm test` exit 0 with no new warnings.
