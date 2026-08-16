# 00 — Brief · Device feedback round 4

Project: **Ductective** — AI diagnostic assistant for HVAC technicians.

> **A separate run.** `00-brief.md` (Run B), `00-brief-accounts.md` and
> `00-brief-fixes.md` are all open. Stage 2 writes
> `.pipeline/02-user-stories-round4.md`.
>
> Owner notes taken during a live device session on 16 Aug 2026, with the server
> log watched in parallel. Everything in §"What the session proved" below was
> **measured during that session**, not inferred afterwards.

## What the session proved

The owner tapped a suggested starter on a Bosch unit and got nothing usable, four
times. The server log shows the same shape every turn:

```
answer   6243ms  retrieved=8 cites=0 scope=33
clarify  9458ms  retrieved=8 cites=0 scope=33
answer   4355ms  retrieved=8 cites=0 scope=33
answer   7678ms  retrieved=8 cites=0 scope=33
```

**Not one cited answer in the whole session.** Three findings came out of it, all
verified against the code and the live database:

1. **The starters are a taxonomy, not the corpus.** `app/lib/starters.ts:109`
   returns `BY_CLASS[classifyEquipment(...)]` — four hardcoded strings per
   equipment class. It never reads a manual. Its own comment claims *"Always four,
   always answerable"*; the second half is asserted and false. For a Bosch IDS it
   offers generic heat-pump faults while that corpus is mostly *installation*
   manuals and a gateway troubleshooting guide, so every tap returns
   no-documentation. **This is the direct cause of the four dead turns.**

2. **A duplicate document is in the corpus.**
   `07_Bosch_…Condensing-Unit-IOM.pdf` and
   `B06_Bosch_IDS-Ultra-Series-Condenser-Installation-Manual.pdf` are the same
   manual: 72 pages and 109 chunks each, and page 69's text is byte-identical
   (1,530 chars). They arrived in the two different ZIP sets under different
   names; `documentId` hashes the `local:///` URL built from the *filename*, so
   two names minted two identities. **Measured cost:** in a broad Bosch retrieval,
   two of the top eight slots were the same text twice. Others may exist — the two
   sets overlapped on Bosch equipment.

3. **Retrieval is weak on that corpus regardless of scope.** Broad (15 docs) and
   narrow (1 doc) both returned similarities of only ~0.62. Scope width spreads
   results across documents but is not the whole story; the content genuinely may
   not answer diagnostic questions, because it is installation literature.

## The four notes

### N1 — the guest notice needs a real dismiss affordance
> *"The sign in message can be removed but I think it should be easier and maybe
> have an X to dismiss it."*

It ships today as a **text label** inside the notice header
(`app/components/Chrome.tsx:315-325`), beside a red offline icon and a heading —
so it reads as another word rather than a control. The dismissal *rule* is right
and must not change: the control appears only once an answer has been delivered,
so the disclosure can be cleared but never skipped. Only the affordance changes.

### N2 — the app should help with new unit installation
> *"It is not allowing for new unit installation. The app should help with new
> unit installation as well."*

The corpus supports this well — most of the 84 documents are Installation/IOM
manuals, which is also why diagnosis-only starters fail on them.

**This collides with the safety guardrail and the collision is the story.**
Installing a rooftop unit *is* gas piping, line-voltage termination and
refrigerant connection — all three refusal categories. Asked "how do I install
this", the system refuses today, correctly, by its own rules.

The owner has **not yet drawn the boundary**. Stage 2 must record it as an
`OPEN QUESTION` with a proposed default and must not resolve it by weakening
`lib/safety.mjs`. The distinction to work from:

- **Reference and interpretation** — clearances, curb and weight data, electrical
  and airflow requirements, sequence of operation, commissioning *checks*,
  torque and setting *values*. Citable, and not walking anyone through hazard.
- **Procedure through hazardous work** — brazing a line set, landing gas piping,
  terminating live conductors. This is what the guardrail exists to refuse and it
  stays refused.

The genuinely hard cases sit between them and must be named, not glossed: is
*"torque the electrical lugs to 35 in-lb"* a reference value or an instruction to
work in a panel?

### N3 — conversational help, without weakening citation
> *"There should be some conversational help not always a citation is needed — for
> example if you need to ask more questions to give a better answer. Dont give
> guidance if there isnt rooted in a manual, but if the user is not asking for
> guidance dont just give the withheld - no source error."*

The owner's framing is the rule, and it weakens nothing: **withhold guidance that
is not in a manual; do not answer a non-guidance turn with a no-source error.**

What exists covers far less than this. `lib/conversation.mjs` matches a narrow
anchored allow-list of short acknowledgements ("that worked", ≤6 words) and returns
a canned body. It does not cover the real case the session exposed: a
mid-conversation turn, including one directly after a `clarify`, answered with the
withheld message when the honest reply was a question or a plain statement of what
the corpus does and does not hold.

Note the third turn of the session was exactly this — the model asked a clarifying
question, the owner answered it, and the continuation returned no-documentation.

### N4 — suggestions must come from the manuals, and be askable
> *"if a unit is selected, you should up front give users a sample of what you can
> help with… the suggestions should always work and be created from the manual. I
> should also be able to ask at any time what you can help diagnose and solve. You
> should give pre done responses where possible."*

Three parts: suggestions **derived from the resolved unit's documents**; the same
thing **askable at any time** ("what can you help with?"); and shown **up front on
unit selection** rather than discovered by failing.

**The rule already exists elsewhere in this codebase and was simply not applied
here.** The type-ahead (ST-F11) was built to the principle *a suggestion is a
coverage claim — never suggest a unit the corpus cannot answer on*. Starters
predate that and were never held to it. A suggestion that returns no-documentation
is worse than no suggestion: the technician concludes the app is broken rather
than that the question was off-corpus.

## In scope

N1–N4, plus the two defects the session surfaced:

- **D1** — de-duplicate the corpus. Detect duplicates by **parsed content**, not
  filename or URL, and decide what happens to the pair already stored.
- **D2** — the request log records `kind` and `scopedTo` but **not**
  `noDocumentation`, so an honest no-documentation reply and an uncited answer are
  indistinguishable in the log. In a system whose first rule is "cite every claim",
  those are the two outcomes that most need telling apart. I had to infer it from
  an output-token count during the session.

## Out of scope

- Billing, the web console, the marketing site.
- Re-opening any decision marked RESOLVED BY OWNER in the accounts run.
- Widening the corpus (no new documents in this run).

## Hard constraints

1. **Never weaken a safety or citation guarantee to make a note easier.** The
   safety gate runs first; every diagnostic claim carries a citation that
   resolves; a refusal renders as a refusal. N2 and N3 both press on this and
   neither may buy its outcome that way.
2. A suggestion, a starter, or a "what can I help with" answer is a **coverage
   claim**. It must be derived from documents actually in scope for that unit.
3. `brand/` and `app/theme/tokens.ts` remain the visual source of truth; the
   contrast matrix must stay green.
4. Do not break the device build; do not regress the merged rounds.
5. SDK 54 pin holds (`app/AGENTS.md`). No new dependency without justification.

## Acceptance criteria

1. N1: the notice carries a conventional dismiss glyph with a ≥48dp target, and a
   test still proves it is absent before the first answer.
2. N2: the boundary is written down, and the two sides are proven — a reference
   question about installation is answered with citations, and a procedural one
   through hazardous work is still refused deterministically. Proven over the wire.
3. N3: a non-guidance turn mid-conversation gets a conversational or interrogative
   reply rather than the withheld message; a guidance turn with no supporting
   source still withholds. Both proven, including the clarify-continuation shape
   the session broke on.
4. N4: for a unit whose documents are in scope, every suggestion offered returns a
   **cited** answer — asserted mechanically over a sample of real units, not
   asserted in a comment. "What can you help with?" is answerable at any time.
5. D1: duplicates detected by content; the known Bosch pair resolved; a re-run
   proves no duplicate pair remains.
6. D2: the request log distinguishes no-documentation from a cited answer.
7. `npm run lint`, `npm run build`, `npm test` exit 0 with no new warnings.
