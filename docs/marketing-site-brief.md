# Ductective — design brief for the marketing site

*For handing to Lovable (or any site builder). Written 6 August 2026.*

Everything here is taken from the shipped brand pack and the running app, not
invented for the website. Where a claim about the product would be premature, this
document says so rather than letting the site say it.

---

## 1. What the product is

**Ductective is a diagnostic assistant for commercial HVAC technicians.** A tech
standing on a rooftop tells it which unit they are at, describes the symptom, and
gets ordered troubleshooting steps — where every claim carries the manufacturer
manual and page number it came from.

**Phase 1 covers light-commercial packaged rooftop units** — Trane Precedent and
Carrier 48/50 families — from 24 OEM service manuals. That narrowness is
deliberate and should be stated on the site, not hidden. It is the reason the
answers can be cited at all.

### Who it is for

Commercial service technicians, not homeowners and not residential HVAC. They
carry company tool budgets, work on equipment with real manuals, and are already
used to looking things up in an IOM — the product replaces the twenty minutes of
searching a PDF on a phone in the sun, not the technician's judgement.

### The two things that make it different

These are the whole pitch. A site that leads with "AI for HVAC" is selling the
commodity; these are the product.

1. **Every claim is cited.** Not "trained on manuals" — each statement in an
   answer carries the specific document and page, and tapping it shows the passage
   it came from. An answer that arrives without a source is withheld rather than
   shown.
2. **It refuses dangerous work, and cannot be talked past.** Gas and combustion,
   live electrical, and refrigerant handling are hard refusals that point to
   standard procedure instead. There is no "show me anyway" anywhere in the app.

### What it is not

- Not a replacement for a technician's training, certification, or judgement.
- Not step-by-step guidance through hazardous work.
- Not a general-purpose chatbot — it answers from a fixed library or says it can't.

---

## 2. Positioning and voice

The app's own copy is the tone guide. It is plain, direct, and slightly blunt —
written for someone with gloves on who is mildly annoyed. It never sounds excited.

Real lines from the product, all usable as site copy:

> **"Which unit are you at?"**
> *"Everything I say is cited to that unit's manuals, so I need the machine first."*

> **"I'd rather tell you I don't know than guess at equipment I can't cite."**

> *"Advice only. Verify against the pages above before you act, and follow your own
> procedure for anything on the refrigerant side."*

> *"Off the data plate — manufacturer and model number. Partial is fine."*

**Voice rules:**
- Short sentences. No exclamation marks. No emoji.
- Say the limitation in the same breath as the capability. The honesty *is* the
  marketing — this audience has been sold confident-and-wrong software before.
- Never "revolutionary", "powered by AI", "10x faster". Never a percentage the
  product hasn't measured.
- Second person, present tense. "You tell it the unit" not "users can specify".

---

## 3. Brand

`brand/README.txt` in the repo is the authoritative spec. Do not recolour the cyan
accent; do not rotate, skew, or shadow the mark.

### Palette

| Token | Hex | Use |
|---|---|---|
| `Ink` | `#0C1826` | Page background (dark-first) |
| `Steel900` | `#16283D` | Cards, raised surfaces |
| `DuctBlue` | `#1354BE` | Filled buttons — white text is 6.91:1 here |
| `SignalBlue` | `#2F93F2` | Links and inline interactive text |
| `CyanRead` | `#5CD0F5` | Accent, active state, the brand mark |
| `Steel400` | `#7D93AB` | Secondary text |
| `Steel200` | `#C6D3E0` | Body text on dark |
| `Mist` | `#EFF4F9` | Headings on dark; light surfaces |
| Alert red | `#C0453C` | Safety refusals only — fills and borders |
| Alert red (text) | `#D1746D` | Refusal *text* on dark, so it clears 4.5:1 |

**Two contrast traps carried over from the app, worth repeating:**

- `#2F93F2` (SignalBlue) as a button fill with white text is **3.19:1** and fails.
  Filled buttons use `#1354BE`. SignalBlue is for links.
- `#C0453C` as *text* on dark is **3.23:1** and fails. The app uses `#D1746D` for
  refusal words and glyphs, keeping `#C0453C` for the fill and ring.

### Typography

**Outfit** (SIL Open Font License, on Google Fonts). Weights in use: 400, 500,
600, 700. The wordmark ships as outlines so it needs no font load, but body text
does.

The app holds a **13px floor** — nothing smaller exists — because it is read at
arm's length in sunlight. A marketing site can go lighter, but the product
screenshots will look denser than a typical SaaS site and that is correct.

### Design bias

Dark-first, high contrast, large touch targets. The visual language is a field
instrument, not a consumer app: flat fills, no gradients, no drop shadows, generous
tap areas. If elegance and legibility conflict, legibility wins — that rule is
written into the product and the site should look like it came from the same place.

### Assets

In `brand/`:
- `svg/` — vector masters. `lockup-horizontal-dark.svg` for dark backgrounds,
  `lockup-horizontal-light.svg` for light, `mark-primary.svg` for the mark alone.
- `png/` — raster, lockups at 4x.
- `favicon/` — 16 through 512px.
- Use `lockup-horizontal-notag-*` below ~160px wide; full lockup has a 120px
  minimum. Clear space equals the width of the mark's vertical stem.

---

## 4. Screenshots

In `docs/screenshots/`, captured from the running app at 390×844 @2x (iPhone 14
Pro dimensions). Regenerate with `node scripts/capture-screens.mjs` — the script is
in the repo so this set does not go stale.

| File | What it shows | Why it earns a place on the site |
|---|---|---|
| `01-unit-gate.png` | Cold start: "Which unit are you at?" with both front doors | The whole thesis in one screen — it asks what machine before it will talk |
| `02-manual-entry.png` | Typing the model in | Proves the camera is not required; a painted-over plate is the normal case |
| `03-unit-typed.png` | A model entered, ready to confirm | "Partial is fine" — real field conditions |
| `04-composer.png` | Composer unlocked, scoped to the unit, with starting points | What using it actually looks like |
| `07-urgent-before-unit.png` | The gate with the urgent-question path open | Safety questions are answerable before any unit is chosen |
| `08-history.png` | History, signed out | Honest about what an account is for |
| `09-account.png` | Sign-in | — |

### Missing, deliberately

**There is no screenshot of a cited answer, the citation source sheet, or a
refusal card.** I could not capture honest ones today: the unit-scoped retrieval
path is currently returning answers with zero citations (a live bug, diagnosed
below), so every capture attempt produced the app's "withheld — no source" state
rather than the product working.

Rather than ship a screenshot of a defect or mock one up, those three are left
out. **They are the most important images on the site**, so:

- Re-run `node scripts/capture-hero.mjs` once the citation bug is fixed, or
- Take them on a real phone, which will look better anyway.

Until then, describe those screens in words on the site rather than illustrating
them with something that isn't real.

---

## 5. Suggested site structure

A single page is right for this stage. There is no product to sign up for yet.

1. **Hero.** The unit-gate screenshot, and one sentence. Suggested:
   *"Cited troubleshooting for commercial rooftop units. It tells you the manual
   and the page — or it tells you it doesn't know."*
2. **The citation section.** This is the differentiator; give it the most room.
   Show a claim and its source chip. Explain that an uncited answer is withheld.
3. **The refusal section.** Gas, live electrical, refrigerant. Frame as a product
   principle, not a limitation: *"It won't walk you through work that can hurt
   you."* Alert red is appropriate here and nowhere else.
4. **Coverage, stated plainly.** Trane Precedent and Carrier 48/50 rooftops, 24
   OEM manuals. Naming the boundary builds more trust with this audience than
   hiding it.
5. **How it works.** Three steps: identify the unit → describe the symptom →
   cited steps with the readings to take.
6. **Waitlist / contact.** Single email field. No pricing — it isn't decided.

### Hard rules for the site

- **No performance or accuracy numbers.** None have been measured. No "95%
  accurate", no "saves 2 hours a day".
- **No named customers, logos, or testimonials.** There are none yet.
- **Never imply it performs or supervises hazardous work.**
- **Do not imply general HVAC coverage.** Phase 1 is light-commercial RTUs.
- Say "advises" and "cites", never "diagnoses for you" or "tells you what's wrong".

---

## 6. Two live bugs, for context

Not the site builder's problem, but they explain the missing screenshots and
should not be described on the site as working.

**Scoped retrieval returns uncited answers.** With a unit confirmed, the server
retrieves 8 chunks and the model returns **0 citations** — reproducibly, five
attempts. The same question with no unit scope returns 3–5 citations. Scoping to
the unit, which was supposed to *raise* precision, is currently destroying it.
Server log:

```
answer  12110ms  retrieved=8 cites=0 scope=5     ← unit-scoped
answer  15744ms  retrieved=8 cites=3             ← unscoped
answer  15222ms  retrieved=8 cites=5             ← unscoped
```

**A no-coverage reply renders as a defect.** When the core honestly says "I don't
have documentation covering that", the app shows it under **"WITHHELD — NO SOURCE
— a defect to report"**. The rendering rule is correct in isolation (an uncited
answer must not render as guidance), but the core is sending an honest coverage
response with `kind: "answer"`, so honesty reads as breakage. Needs a distinct
kind on the contract.

Also worth knowing: **`Carrier 50HC` — an in-scope unit — returns "I don't have
documentation covering that."** Unit resolution is matching more narrowly than the
corpus actually covers.
