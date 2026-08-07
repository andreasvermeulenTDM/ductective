# Backlog

Open items that are not blocking the current round's acceptance criteria. Per
`CLAUDE.md`, Critical/High issues do **not** belong here — they block "done".

**One item is open** — a candidate claim/citation mismatch awaiting Eval's judgment,
at the bottom of this file. Everything else filed on 7 Aug 2026 is closed, and kept
below with its resolution rather than deleted: the reasoning is why the fixes look
the way they do, and two of them were found by a tool that had been reporting noise
for long enough that nobody read it.

---

## ✅ H — `resolveUnit` missed full nameplate model numbers · FIXED 7 Aug 2026

A technician types — or a camera reads — the model printed on the plate.
`lib/units.mjs` matched query tokens against the manifest coverage string with
`coverage.includes(token)`, and a full nameplate is one long token no coverage
string contains, so a **covered** unit resolved as `unrecognised`.

| Typed | Before | Now |
|---|---|---|
| `Carrier 48TCA06` | unrecognised | covered → 48TC manual |
| `Carrier 50HC024` | unrecognised | covered → 50HC manual |
| `Carrier 48PM028` | unrecognised | covered → 48/50PGPM manual |
| `Trane YSC072E3RHB0000` | unrecognised | covered → `RT-SVX21AD` |
| `Trane WSJ150` | unrecognised | covered → Precedent heat pump IOM |

**Fix.** Prefix containment in both directions, minimum three characters: the tech
may type more than the manual names (plate → family) or less (family → a manual
listing sizes), and both land on the same document. Deliberately *prefix*, not
substring — the old behaviour matched anywhere in the string, so a Daikin `VRV IV`
contributed the token `iv` and any coverage containing "drive" or "five" would have
claimed it. Bare numbers under four digits are excluded on both sides, because
`48/50LC` normalises to a stray `48` token and typing `48` alone resolved covered.

Trane needed more than an algorithm: its coverage strings named families with no
model prefix, so no plate could ever match them. The prefixes added to the manifest
— `YSC`/`YHC`, `WSC`/`DHC`/`WHC`, `YZC`, `WSJ`, `YHJ` — were **read out of each
document's own text**, not invented, and the Goodman coverage was corrected to the
families its manual actually names (`ACEC`/`AMEC`/`GMEC`/`GCEC` — notably *not*
`GMVC`, which is why ST-14's Goodman edge is still honestly uncovered).

**Guarded by:** ten new cases in `lib/units.test.mjs`, including the left-anchoring
case and the "manufacturer prefix alone must not claim a unit" case. The old
fixtures all used family names, which is exactly why none of them caught this.

## ✅ H — the answer scope was limited to two manufacturers · CHANGED 7 Aug 2026

Owner decision. `isInScope` was an allowlist of Trane and Carrier plus a growing
pattern of excluded equipment classes. With fifteen manufacturers in the corpus
that meant holding the correct manual for a technician's unit and declining to
open it. Every document the corpus holds is now answerable.

Verified not to weaken anything: retrieval is still unit-scoped by document id, a
model matching nothing still resolves to zero documents, and the safety gate still
refuses combustion/refrigerant/live-electrical procedure whoever built the
equipment. ST-12/ST-14 re-run at **117 assertions, all green, ledger 0 → 0** with
Lennox, York and Goodman documents present in the corpus.

Reversible in data, not code: a manifest row whose Legal Status begins
`OUT-OF-SCOPE` is ingested, tagged, and withheld from answering. Nothing uses it.

## ✅ L — `parseDocumentAsync` ignored `parser_version` · FIXED

`npm run ingest` honoured a `PARSER_VERSION` bump and `npm run ingest:parse`
silently did not — the "a parser fix that a warm cache hides" failure the version
check exists to prevent, still open on one of the two paths that write the cache.

## ✅ L — wire probes could not prove which tree the server ran · FIXED

`/health` now returns the server's own commit and start time, and
`safety-coverage-probes.mjs` asserts it equals the prober's HEAD **before any
probe runs**. It earned its keep immediately: the first run after the fix caught a
server still listening on 8787 from an earlier process, which is the third
occurrence of the trap and the first one caught automatically rather than by
noticing a process start time by hand.

## ✅ L — ESLint was permanently red, and was hiding a real defect · FIXED

ESLint walked into `.claude/worktrees/` — gitignored checkouts of this repo — where
a second `app/tsconfig.json` made the TSConfig root ambiguous and every app file
failed to parse. **58 errors on a clean tree with nothing wrong in it.**

The cost was not noise. Every stage of this pipeline reports lint status before
handing off, and a gate that is always red stops being read. Ignoring `.claude/**`
dropped it to one real error it had been burying:

> `app/components/Message.tsx:86` — a literal `0x08` byte inside a regular
> expression where `\b` was meant. `splitReading` searched for a **backspace
> character** followed by `Reading:`, matched nothing, ever, and the "Reading:"
> de-emphasis in answers silently never worked.

Swept the other 88 source files for the same defect. The only other control
character in the tree is the deliberate NUL field separator in `contentHash`,
which is correct and was left alone.

---

## OPEN · Candidate claim/citation mismatch — for Eval's sampled review (filed 7 Aug 2026)

Found by ST-13's reachability probe on the first real cited answer this project has
produced. Carrier 48LC, low suction / short cycling:

| | |
|---|---|
| **Claim** | "Inspect the evaporator fan belt tension, belt condition, and fan rotation direction." |
| **Cited** | `48-50LC-04-06_Single-Package-Rooftop-Service` p31 — a Loss-of-Charge alert table listing refrigerant faults and a suction pressure transducer |
| **Mechanically** | clean: resolves, `verified:'exact'`, correct page, snippet is the stored chunk |

The passage says nothing about fan belts. If it holds up it is the defect `CLAUDE.md`
names as the worse of the two — a citation that does not support the claim attached
to it — and it is **invisible to mechanical checking**, which is why criterion 2 has
a sampled human half at all.

**Not a verdict.** One observation from one answer, and support is Eval's call, not
Test's. Routed to ST-16's sampled review with a specific instruction: **sample the
full claim pool, not a triage-filtered subset.** `triageOverlap` scored this exact
citation `band: 'high'` — its most confident bucket — because generic words carry
the overlap, so the heuristic would have hidden it.

Likely owner if confirmed: Backend (source-index anchoring picking a chunk that
retrieved well for the symptom but does not support the specific step) or Knowledge
(chunk boundaries merging an alert table with adjacent remedy prose). Route on
inspection of the retrieval, not on assumption.
