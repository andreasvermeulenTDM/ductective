# 00 — Brief · Run C: chat + camera UI

Project: **Ductective** — AI diagnostic assistant for HVAC technicians.
Plan of record: `Ductective-Plan-v3.md` (root). This brief covers **P1.4 only**.

> **Sequencing.** Run C is the third and last Phase 1 pipeline run. It may not start
> until Run A (rails + KB) and Run B (diagnostic core) are both complete and merged.
> At kickoff, this file must be moved to `.pipeline/00-brief.md` — every agent reads
> that path, and Run A's brief currently occupies it. Archive Run A's to
> `.pipeline/runs/A-00-brief.md` rather than deleting it.

## Objective

Put a real interface on the diagnostic core Run B built. At the end of Run C a
technician can open Ductective on a phone or tablet, type a symptom **or**
photograph a rooftop unit's nameplate, watch a cited diagnostic answer stream in,
tap any citation to see the source document and page, and come back later to a
history of past diagnostics.

This is the run that produces the Phase 1 exit artifact: a self-testable build a
real commercial tech can hold on a roof.

## In scope

- **Chat screen.** Text input, message list, streaming assistant response, and the
  clarifying-question turns Run B's core emits (render the question, capture the
  answer, continue the same session).
- **Nameplate capture.** Camera + photo-library input, upload to the Run B vision
  endpoint, render the identified manufacturer/model back for confirmation, with a
  correction path when it's wrong.
- **Citations as first-class UI.** Every diagnostic claim renders with a visible,
  tappable citation resolving to source document name + page number.
- **Safety refusals as first-class UI.** Gas/combustion, live electrical, and
  refrigerant-handling refusals render distinctly in alert red with the pointer to
  standard safety procedure. Not dismissible, not collapsible, not styled as an
  error the user should retry past.
- **Session history.** List past diagnostics, open and resume one, persist across
  app restart.
- **Full state coverage.** Loading, empty, error, and offline/no-signal states for
  chat, camera, and history.
- **Design system.** Tokens, typography, and components built from `brand/`, reusable
  by Phase 2 screens rather than one-off styling per screen.
- **Backend, thin.** Streaming transport and session/message persistence. The
  reasoning core itself is Run B's and is not reopened here.

## Out of scope

- Auth, accounts, billing, paywall, onboarding — Phases 2–4.
- Changes to diagnostic reasoning, retrieval, ranking, or guardrail *logic*. Run C
  renders the core's output; it does not tune it. A wrong answer is a Run B defect,
  logged, not patched in the UI.
- Push notifications, offline answer caching, multi-tech sharing, job/work-order
  features, KB editing.
- Equipment outside the Phase 1 answer scope (Trane Precedent, Carrier 48/50).
- Marketing site, app-store listing assets.

## Hard constraints

- **Field conditions drive the design, not aesthetics.** This is read on a rooftop,
  in direct sunlight, with gloves on, often one-handed while the other hand holds a
  meter. Dark-first, high contrast, large touch targets. When a visual choice
  trades elegance against legibility at arm's length in sun, legibility wins.
- **Brand assets are source of truth.** `brand/README.txt` is the authoritative
  spec — palette, lockup selection, minimum sizes, clear space. Use the pack's own
  token names verbatim in code:
  `Ink #0C1826` · `Steel900 #16283D` · `DuctBlue #1354BE` · `SignalBlue #2F93F2` ·
  `CyanRead #5CD0F5` · `Steel400 #7D93AB` · `Steel200 #C6D3E0` · `Mist #EFF4F9` ·
  alert red `#C0453C`. Typeface is **Outfit** (SIL OFL) and the app must load it —
  the wordmark ships outlined, the UI does not. Do not recolour the cyan accent.
  Pick lockups by `README.txt`'s rules, not by eye.
- **Cite every claim — enforced in the UI.** A diagnostic statement with no citation
  must not render as a claim. This is a rendering contract, not a nicety.
- **Advise-only.** No stage of Run C may soften a refusal, or add a "show me anyway"
  affordance, to make a story or a demo flow better.
- **Stack is decided** — Expo + React Native, one codebase for iOS + Android +
  tablet. New dependencies need justification in the stage artifact; prefer what
  Expo ships. No native-module ejection.
- **No secrets in the client.** Model and Voyage keys stay server-side; the app
  talks only to the serverless function.
- **Solo builder, <10h/week.** Boring and working beats clever and unfinished.

## Acceptance criteria

1. The app runs from one codebase on a physical iOS device, a physical Android
   device, and a tablet. Layout is correct on all three — phone layout is not merely
   stretched to tablet width.
2. Typing a symptom returns a response that **streams** into the message list rather
   than appearing all at once. Time-to-first-token is measured on a real device over
   normal cellular and the actual number is reported; target ≤ 3s.
3. Photographing a nameplate returns an identified manufacturer + model rendered for
   confirmation. Across **10 real nameplate photos** (Trane Precedent and Carrier
   48/50, mixed lighting and angles), ≥ 8 identify correctly, and every one of the 10
   can be corrected by the user in ≤ 2 taps. Per-photo results are tabulated.
4. Walking the **top-15 fault list** (`Ductective-Plan-v3.md` §3) through the UI
   produces **zero uncited diagnostic claims**. Every citation tapped resolves to a
   source document name and page number.
5. All three refusal categories — gas/combustion, live electrical, refrigerant
   handling — are triggered through the UI. Each renders in alert red with a
   safety-procedure pointer, contains no step-by-step procedure, and offers no path
   to bypass it. 3 of 3, with screenshots.
6. Loading, empty, error, and offline states exist and are reachable for chat,
   camera, and history. The artifact enumerates each with a screenshot. Killing the
   network mid-stream produces a recoverable error state, not a blank screen or a
   half-rendered answer presented as complete.
7. Accessibility floor, all met and evidenced: every interactive element has a
   VoiceOver/TalkBack label; touch targets ≥ 48dp; body text contrast ≥ 4.5:1
   against its token background; focus/pressed states visible; text respects OS
   font-size settings up to 200% without clipping.
8. History lists past sessions, opens and resumes one with its full message and
   citation state intact, and survives a full app restart.
9. Colour and type come from a single token module sourced from `brand/README.txt`.
   No hardcoded hex values outside it — greppable and reported.
10. Component tests cover message rendering, citation rendering and tap-through, and
    refusal rendering. Lint, build, and test commands run with their exact status
    reported and **no new warnings** introduced (before/after counts if a baseline
    exists).

## Verification

- **Machine-checkable** — 9, 10, and the component-test half of 4 and 5. Stage 5
  runs these and captures evidence.
- **Device-manual** — 1, 2, 3, 6, 8, and the physical-device half of 7. Stage 5 lists
  these as human-only steps with instructions; it must not claim them. Criterion 3
  needs 10 real nameplate photos, which is a human collection task — start it early,
  it gates the criterion.
- **Stage 5.5 (eval)** runs the top-15 scenario set as a **regression** against Run
  B's scores, plus a guardrail-leak check driven **through the UI** rather than
  against the core directly — the question Run C uniquely answers is whether the
  interface can be made to leak something the core correctly refused. Any leak is a
  Critical and blocks Phase 1 exit.

## Notes for downstream stages

- **Knowledge (2.5):** nothing to do. The KB is frozen for Run C; if retrieval is
  wrong, log it, don't re-ingest.
- **Backend (3):** thin and bounded — streaming transport, session and message
  persistence, and the image-upload path to Run B's vision endpoint. Do not
  reopen reasoning, retrieval, or guardrail logic. Publish the streaming and session
  contracts in `03-backend.md` precisely enough that Frontend never has to guess a
  field name; Frontend is forbidden from editing backend code and will file a
  `CONTRACT MISMATCH` against you instead.
- **Frontend (4):** owns the weight of this run.
- **Eval (5.5):** the UI-driven guardrail-leak check above is the new work; the
  top-15 rerun is regression.
- Record any `OPEN QUESTION` with a proposed default and proceed on the default.

## Prerequisites

- Runs A and B complete and merged.
- `SETUP-BLOCKERS.md` H1–H3 (Supabase, Google AI Studio, Voyage) and **H7** (physical
  device + Expo Go) cleared. H7 gates criteria 1, 2, 3, 6, and 8 — nearly half this
  brief is unverifiable without a phone in hand.
- 10 real nameplate photos collected for criterion 3.
- Ideally: the commercial RTU tech from plan §7 item 1 recruited, since P1.5
  validation runs against this build.

---

## Amendment 1 — unit first: capture becomes a precondition, not an input

*Dated 5 August 2026. Stage 0 amendment. Drafted by the Frontend agent at the
owner's request; **signed off by the owner 6 August 2026 and now in force.**
Appended, not edited in place, so the artifact stays an audit trail.*

**What changes.** The app establishes *which unit the technician is standing in
front of* — by photographing the data plate or by typing it — and only then takes
questions. Capture moves from an optional composer action to a gate.

This contradicts the **In scope** list above, which names nameplate capture as an
input *alongside* text. Downstream agents should treat that line as amended, not
contradicted: the two entry paths are now **camera or manual entry**, and free-text
symptom entry follows unit selection rather than standing beside it.

**Why this is an amendment and not an `OPEN QUESTION`.** The rule above reserves
`OPEN QUESTION` for a decision an agent could reasonably default. This one changes
the product's shape and its acceptance criteria, and it is justified by the domain
rule rather than by usability: `CLAUDE.md` names a citation that does not support
its claim as worse than an uncited one, and an answer citing the wrong unit's
manual is exactly that. The gate exists to make that failure unreachable.

**The cost is real and is recorded, not minimised.** It adds friction to a quick
question. `docs/phase1-story-map.md` Addendum C §"This is a flow change" states the
trade plainly, and open question 4 there resolves it as "no just-ask escape in
Phase 1". That is the expensive half of this decision and it should be revisited
against E7.4's technician validation, not treated as settled forever.

**What it buys, beyond safety.** Retrieval narrows before the first query.
`documents.in_scope` and the E1.7/E2.3 scope tags can filter to one unit's manuals
from the outset, which should *raise* precision against Run A brief AC 7's 10-of-12
bar and reduce the `48-50FC` / `48-50FE` sibling-manual confusion Stage 1 flagged.

### Criteria affected

| Criterion | Change |
|---|---|
| **3** | Nameplate identification is now the entry path, not an alternative input. Manual entry is a **co-equal front door** and must be completable with the camera permanently denied. |
| **6** | Nine states become **twelve**: unit selection joins chat, camera, and history as a surface needing loading / empty / error / offline coverage. |
| **8** | A resumed session must not re-ask for its unit — the unit is carried on the session. |
| *new* | No route reaches the diagnostic core with `equipment` unset. Verified by attempting each bypass, not by inspection. |

### Two contradictions this amendment must settle before U1 is built

Recorded here rather than left for a stage agent to resolve silently.

**1. U1 and U7 conflict as written.** U1 disables the composer until a unit is
confirmed; U7 requires safety refusals to stay reachable "at any point, with or
without a unit". If the composer is the only way to say anything, a technician
cannot reach a refusal at the front door — which is the guardrail regression U7
exists to prevent.

*Proposed default:* the unit-selection screen accepts free text, and anything
matching a refusal category is refused there, before a unit exists. A refusal
needs no equipment context to be correct.

**RESOLVED — owner accepted the default, 6 August 2026.** Built in `cfb8536`. The
gate renders a reply only when it is a refusal; anything else is discarded and the
question carried into the session once a unit exists. Refusal classification is the
server's deterministic `classifyHazard`, not a second frontend guardrail — a
duplicate hazard list that could diverge from the core's is the failure mode this
avoids.

**2. U2 assigns Frontend a criterion it cannot own.** "Partial and near-miss model
numbers resolve" is listed **Owner: Frontend**, but matching a partial model
against the corpus is retrieval work — the same resolution U4 assigns to Backend.
As written, Frontend would have to invent a coverage matcher, which is the
mis-citation risk this amendment exists to remove.

*Proposed default:* that criterion moves to **Backend**, delivered with a
documented resolution contract; Frontend renders its result and its
unrecognised-unit state.

**RESOLVED — owner accepted the default, 6 August 2026.** `docs/phase1-story-map.md`
U2's "partial and near-miss model numbers resolve" is reassigned to Backend. U4's
unrecognised and out-of-scope states are therefore not built in `cfb8536`: the
frontend renders a coverage verdict, it does not compute one.

### Already built against this, before sign-off

`U2`'s first criterion and the frontend half of `U5`'s header shipped in
`93e0cab`: manual entry is reachable without opening the camera, and the chosen
unit is visible from selection onward. Both are improvements under the *current*
brief too — neither imposes the gate — so they were not held behind this
amendment. **No gate has been built.** U1 and U7 remain blocked on sign-off.

### Sign-off

- [x] Owner accepts the flow change — *6 August 2026*
- [x] Owner resolves contradiction 1 (refusals at the front door) — *default accepted*
- [x] Owner resolves contradiction 2 (who owns model resolution) — *default accepted*

**In force.** Stage agents should treat this amendment as operative and the
**In scope** list above as amended by it.

### Landed against this amendment

| Story | State |
|---|---|
| U1 — app opens on unit selection | ✅ `cfb8536` |
| U2 — manual entry is a front door | ✅ `93e0cab` (first criterion; matching is Backend's per contradiction 2) |
| U3 — capture resolves to a candidate | Confirmation UI exists against a mocked read; needs Backend's vision endpoint |
| U4 — coverage stated at selection | **Backend** — resolution contract not yet delivered |
| U5 — session carries its unit | Frontend half ✅ (`93e0cab`, `cfb8536`); retrieval scoping is Backend's |
| U6 — changing unit starts a new session | Not built |
| U7 — gate cannot be bypassed | ✅ `cfb8536`, with a CONTRACT MISMATCH filed against Backend |
| U8 — states for the first screen | ✅ `cfb8536` except U4's two coverage states |
