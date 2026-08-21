# 025 — Knowledge, round 4 addendum: D1 measured, and AC 4's metric corrected

**Scope of this artifact.** One thing: ST-R13 AC 4, which asked for the brief's
measured defect to be measured again and recorded here as a before/after. No
round-4 knowledge stage ran, so nothing recorded it; Stage 5 measured it on
17 Aug 2026 and found the criterion's own metric unsound. This closes both halves
— the measurement, and the metric.

Everything else about the retirement (the manifest cell, the two markers, the four
consumers, chunk counts) is in `03-backend-round4.md` and `05-test-report-round4.md`
and is not restated here.

---

## 1. Before — what the brief measured

`00-brief-round4.md` finding 2, verbatim on the cost:

> **Measured cost:** in a broad Bosch retrieval, two of the top eight slots were
> the same text twice.

The two documents:

| | |
|---|---|
| `07_Bosch_…Condensing-Unit-IOM.pdf` | 72 pages, 109 chunks |
| `B06_Bosch_IDS-Ultra-Series-Condenser-Installation-Manual.pdf` | 72 pages, 109 chunks |
| page 69 | byte-identical, 1,530 chars |

They arrived in two different ZIP sets under different names, and `documentId`
hashes the `local:///` URL built from the *filename* — so two names minted two
identities.

**A limit on this "before", stated rather than glossed:** the brief did not record
the query behind its finding. So the before is the brief's sentence, not a
reproducible run, and no later measurement can be a strict re-execution of it.
That gap is precisely why the after is pinned (§3).

---

## 2. After — measured 20 Aug 2026

`npm run verify:retrieval-distinct` · Bosch IDS Ultra → covered, 14 documents ·
query `"condenser unit refrigerant charge and installation clearances"` · top-8 ·
**zero Gemini quota** (one Voyage query embedding and one RPC).

```
 1. doc_3abebc9b45358504 p  4  sim=0.596  Bosch_IDS-Edge-Series-Install
 2. doc_efed7302f71dea64 p  4  sim=0.591  Bosch_IDS-Edge-Max-Performance-Install
 3. doc_b835940a1356c074 p 14  sim=0.590  Bosch_IDS-Ultra-Condenser-Install
 4. doc_6e7f61398133f2d9 p 10  sim=0.588  Bosch_IDS-Light-Air-Handler-Install
 5. doc_7495d65d10796a3c p 14  sim=0.579  Bosch_IDS-Premium-Connected-Condenser-Install
 6. doc_b835940a1356c074 p 14  sim=0.576  Bosch_IDS-Ultra-Condenser-Install
 7. doc_7495d65d10796a3c p 13  sim=0.573  Bosch_IDS-Premium-Connected-Condenser-Install
 8. doc_7495d65d10796a3c p 41  sim=0.573  Bosch_IDS-Premium-Connected-Condenser-Install
```

| | before | after |
|---|---|---|
| the same text twice in the top eight | **yes** (brief, finding 2) | **no — 8 of 8 distinct texts** |
| chunks from the retired duplicate | present | **none** (1 document retired) |
| distinct `(document_id, page)` slots | not recorded | **7 of 8** — printed, not asserted |
| similarity range | ~0.62 (finding 3) | **0.573–0.596** |

This reproduces Stage 5's 17 Aug run **exactly** — same eight rows, same order,
same similarities — three days apart, which is the corroboration that matters more
than either run alone.

**The defect is fixed.** A technician reading eight sources is reading eight
distinct texts, and the retired document is not among them.

---

## 3. The metric correction (T-4)

AC 4 originally asked for *"eight distinct `(document_id, page)` pairs"*. That
count is **7 of 8** and always was: slots 3 and 6 are two *different* chunks on
one page of one document.

**Chunking is sub-page.** `(document_id, page)` was therefore never a distinct key
for a chunk — the criterion conflated a page with a chunk. It is a defect in the
criterion, not in the corpus, and Stage 5 was right to report FAIL rather than
substitute the number that passes.

AC 4 now asserts two things and prints a third:

1. **every retrieved chunk carries distinct text** — the defect, in the terms the
   brief measured it in;
2. **no retrieved chunk belongs to a retired document** — the mechanism;
3. the `(document_id, page)` count, **printed and not asserted**.

**Both assertions, because either alone passes for the wrong reason.** Text
distinctness alone would pass if the retirement regressed but the two copies
happened not to co-occur for this query. The retirement check alone would pass on
a corpus that had grown a *third* copy under a new id.

Demonstrated rather than argued — each check was mutated and observed to fail
alone:

| mutation | text check | retired check |
|---|---|---|
| duplicate the top chunk into slot 8 | **FAIL** 7 of 8 | ok |
| slot 8 → a distinct-text chunk from `doc_d409dfbd55519a2e` | ok 8 of 8 | **FAIL** |

Both exit 1. A check that cannot fail is not a check.

### What was deliberately not adopted

Requiring eight distinct **pages** would be a retrieval-*diversity* requirement.
The brief never asked for one, nothing has measured whether this corpus can meet
it, and adopting it silently — because a hastily chosen key happened to imply it —
is how a requirement nobody agreed to becomes load-bearing. If diversity is
wanted it belongs in a brief, with a measurement. The number stays printed so the
question stays visible.

### Direction of the change

This loosens a criterion, so the direction is stated on the record: the metric it
replaces was `[M]` and **failed**, while the property it existed to protect
**held**. Nothing that was passing has been made easier, and the new assertions
are re-runnable and falsifiable where the old one was neither — no stage had ever
executed it.

---

## 4. Still open, and not closed by this artifact

- **ST-R13 AC 8 is human-only and blocking.** The owner ratifies which of the
  Bosch pair survives. OQ-R9's reproducible tiebreak keeps
  `doc_b835940a1356c074` (the B06 Installation Manual) and retires
  `doc_d409dfbd55519a2e` (the 07 IOM); both are `local:///`, so no OEM-domain
  tiebreak applies and the judgement is the owner's. The retirement is already
  applied in data — this ratifies it rather than triggers it.
- **Near-duplicates remain surfaced, not solved** (§7.2). `find-duplicates.mjs`
  reports exact-content groups; today it finds one, resolved, and zero candidates
  at Jaccard ≥ 0.9. A revision of a manual with a new cover page would be a
  candidate and would want a human.
- **Finding 3 is untouched.** 0.573–0.596 on this corpus reproduces the brief's
  ~0.62 observation. §7.8 says this round does not address it, and it did not.
