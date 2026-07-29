# HVAC AI App — Resolved Plan (v2, Lean Solo Edition)

*Prepared for Andreas · July 2026 · Supersedes the v1 blueprint for near-term execution*

This version resolves every open decision from the interview and rebuilds the plan around your real constraints: **solo, building with Claude Code + AI tooling, ~$1,000 budget, <10h/week, no trade contacts yet, general HVAC, iOS + Android + tablet, first goal = a working prototype for yourself.**

---

## 1. Every open issue — resolved

| # | Open issue | Resolution | Why |
|---|---|---|---|
| 1 | Knowledge-base data (build vs buy) | **Build your own**, license-cleared — but start narrow | Your call; it's the ownable asset. Narrow start makes accuracy achievable solo. |
| 2 | Platform (native vs cross) | **Expo + React Native** (iOS + Android + tablet, one codebase) | You want all platforms solo; Expo's cloud builds (EAS) even ship iOS **without a Mac**. |
| 3 | Backend + auth + vector store | **Supabase** (Postgres + pgvector + auth + storage, one service) | Free tier, one system to run, great with AI tooling — ideal for a $1k solo bootstrap. |
| 4 | AI model | **Claude API** (reasoning + vision) via a serverless function | No fine-tuning; nameplate photo → model via vision. |
| 5 | Embeddings | **Voyage AI** (or OpenAI) | Anthropic has no embeddings API; Voyage is its recommended partner. |
| 6 | Segment for v1 | Vision = general HVAC; **prototype starts narrow: residential split systems + gas furnaces** | Largest install base, most free data, easiest testers — proves accuracy before you widen. |
| 7 | First milestone | **Self-testable working prototype** — no billing, no store, no company features | Fastest path to something real on your budget/time. |
| 8 | Individual price | **$29/mo** | Middle of your $20–40 range; priced as a real pro tool. |
| 9 | Company price | **$39/seat/mo**, plus a **$199/mo "shop" tier up to 6 techs** | Middle of your range; the flat tier lowers friction for small shops. |
| 10 | Trial model | **7-day free trial, then paywall** (not hard paywall, not freemium) | Techs must feel it work before paying; free trial converts far better than a cold paywall, and avoids freemium's cost/abuse problems. |
| 11 | In-app purchases (later) | **RevenueCat** across App Store + Google Play; **Stripe** for company/web B2B | One SDK handles cross-platform subscriptions + entitlements cleanly. |
| 12 | Product name | **Working name: "Superheat"** (alternatives below — easily swapped) | Real HVAC term (superheat is a core diagnostic measurement), short, brandable, memorable to techs. |
| 13 | Trade access / accuracy validation | **Parallel "recruit 2 techs" track** starting now (r/HVAC, HVAC-Talk forum, local shops) | Your #1 risk isn't code — it's verifying the AI is *correct*. Must run alongside the build. |
| 14 | Budget allocation | Broken out in §6 | $1k is enough for a prototype if spent on API + minimal infra. |

### Name options (pick your favorite; I'll swap it everywhere)
- **Superheat** *(recommended)* — core HVAC diagnostic term; sounds sharp and technical.
- **Subcool** — the companion measurement to superheat; same insider credibility.
- **Delta-T** — the temperature-difference every tech lives by; clean and techy.
- **Manifold** — the gauge manifold is a tech's primary tool; evokes "many manuals in one."
- **Ducto** — short, friendly, obviously HVAC, easy domain/app name.
- **Journeyman** — the experienced tech the AI stands in for; mentor connotation.

*(Trademark/domain check is a later step — don't over-invest before the prototype proves out.)*

---

## 2. Resolved architecture (lean)

```
   ┌─────────────────────────────────────────────┐
   │   Superheat App  (Expo / React Native)        │
   │   iOS · Android · tablet — one codebase       │
   │   - Chat: type a symptom or snap a nameplate  │
   │   - Cited, step-by-step guidance              │
   └───────────────────────┬───────────────────────┘
                           │ HTTPS
                           ▼
   ┌─────────────────────────────────────────────┐
   │   AI function (serverless)                    │
   │   - retrieve from KB → Claude (reason+vision) │
   │   - advise-only, cite-every-claim guardrails  │
   └───────────┬─────────────────────┬─────────────┘
               ▼                     ▼
      ┌──────────────────┐   ┌────────────────────┐
      │ Supabase          │   │ Claude API +        │
      │ Postgres+pgvector │   │ Voyage embeddings   │
      │ KB chunks+provenance│ └────────────────────┘
      │ (auth/storage: later)│
      └──────────────────┘
   Offline ingestion (your laptop): license-cleared PDFs
   → parse → chunk → tag(brand/model/provenance) → embed → Supabase
```

For the *self-prototype*, you can skip auth entirely and run it as your own app. Auth, billing (RevenueCat/Stripe), and company seats get added in later phases — the v1 blueprint already details them; they're deferred, not discarded.

---

## 3. Phase 1 — the prototype (your actual near-term plan)

Goal: **you can open the app, describe a problem or photograph a nameplate, and get correct, cited, step-by-step guidance** for common residential furnace / split-system / heat-pump issues. Nothing else.

**P1.1 — Set up the rails (1 weekend).** Create Expo app, Supabase project (enable pgvector), Anthropic + Voyage API keys. Get a "hello world" round trip: app → function → Claude → response on screen. *Done when:* you can chat with Claude from the app on your phone.

**P1.2 — Build the narrow knowledge base (2–3 weekends).** Gather license-cleared docs for your narrow start (you already have the sourcing method + the downloader). Build the ingestion script (parse → chunk → tag with brand/model/provenance/`license_status` → embed → store). Ingest ~15–30 documents covering the most common residential equipment. *Done when:* a retrieval query returns the right manual sections with sources.

**P1.3 — Build the AI diagnostic core (2 weekends).** The function that: takes a symptom (+ optional nameplate photo → model via Claude vision), retrieves from the KB, asks a clarifying question if needed, and returns ranked diagnostic steps **with citations** and the readings to take. Guardrails: advise-only, cite every claim, and a **hard-refusal list** for anything unsafe (gas/combustion, live electrical, refrigerant handling) — it tells you to follow standard safety procedure instead of guessing. *Done when:* it correctly walks through your top ~15 common faults.

**P1.4 — Build the chat + camera screen (1–2 weekends).** One clean screen: text input, camera capture for nameplates, streaming response with tappable citations, basic history. Use a design skill for a sleek, field-readable look (big targets, high contrast). *Done when:* the full loop works on your phone and a tablet.

**P1.5 — Validate accuracy with a real tech (parallel, starts week 1).** Recruit 1–2 techs (r/HVAC, HVAC-Talk, a local shop — offer free access / a small thank-you). Have them run real scenarios and mark each answer right/wrong. Feed corrections back into the KB. *Done when:* a tech says "yeah, that's what I'd actually do" on most of your test cases.

**Phase 1 exit:** a working, self-testable app on iOS + Android + tablet that gives correct, cited HVAC guidance for a narrow-but-real set of problems — validated by an actual tech.

---

## 4. Later phases (deferred — full detail in v1 blueprint)

- **Phase 2 — Private beta:** add Supabase auth, ship via TestFlight + Google Play internal testing to a handful of techs; instrument usage + feedback; widen the KB toward general HVAC.
- **Phase 3 — Monetize (individuals):** RevenueCat subscriptions, 7-day trial → $29/mo, paywall gating, public store launch, marketing site (Next.js), account deletion + Sign in with Apple compliance.
- **Phase 4 — Company plans:** Stripe B2B seats ($39/seat or $199/shop tier), org membership + entitlement sync, company admin dashboard, App Review compliance for the B2B billing model.
- **Ongoing:** the feedback → KB-improvement loop (your moat), E&O insurance + disclaimer review before public paid launch, cost caps/monitoring.

Everything in Phases 2–4 is already specced step-by-step in the v1 blueprint; this v2 just re-sequences it behind the prototype.

---

## 5. Timeline (nights & weekends, <10h/week)

Phase 1 is roughly **8–10 weekends (~2–3 months)** at your pace — the KB and getting accuracy right take the most time, not the app shell. That's a realistic, encouraging target for a self-testable prototype. Phases 2–4 add several more months each; don't schedule them yet — let the prototype tell you whether to keep going.

---

## 6. Budget: making $1,000 work

| Item | Est. cost | Notes |
|---|---|---|
| Claude API (dev + testing) | ~$50–150/mo | Prompt-cache the KB context; cap your own test volume. Biggest variable. |
| Voyage embeddings | ~$0–20 | Cheap; one-time to embed the KB, small ongoing. |
| Supabase | $0 | Free tier is plenty for a prototype. |
| Expo / EAS builds | $0 | Free tier covers early builds. |
| Apple Developer | $99/yr | Only needed when you ship to TestFlight (Phase 2). Defer if pure self-prototype. |
| Google Play | $25 one-time | Same — defer to Phase 2. |
| Tester thank-you | ~$50–100 | Gift card for the tech(s) who validate accuracy. Worth every cent. |

**Prototype is well within $1k** — the spend is almost entirely Claude API. Keep the paid store accounts for when you actually distribute.

---

## 7. Do these three things next

1. **Start recruiting one tech today** — post in r/HVAC or HVAC-Talk that you're building an AI helper and want a tech to test/critique it. This is the long pole; start it before any code.
2. **Confirm the name** (or pick from the list) so I can brand everything consistently.
3. **Kick off P1.1** — I can scaffold the Expo app + Supabase + the first Claude round-trip with you right now.

---

*Open decisions remaining: essentially just your name pick and which narrow equipment type to start with (my default: residential gas furnaces + split-system AC/heat pumps). Everything else is resolved above.*
