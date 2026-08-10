# Backlog

Open items that are not blocking the current round's acceptance criteria. Per
`CLAUDE.md`, Critical/High issues do **not** belong here — they block "done".

**Eight items are open**: a candidate claim/citation mismatch awaiting Eval's
judgment (Run B, mid-file), and six filed by the accounts run on 10 Aug 2026 (at
the bottom). Everything else filed on 7 Aug 2026 is closed, and kept below with
its resolution rather than deleted: the reasoning is why the fixes look the way
they do, and two of them were found by a tool that had been reporting noise for
long enough that nobody read it.

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

---

# Accounts run (ST-A**) — filed 10 Aug 2026 by Stage 3

Six items, each with the risk of not doing it stated. Two are tagged
`launch-blocker`: they do not block this round's acceptance criteria, and they
**do** block shipping to the App Store or to the public, which is a different bar.

## OPEN · `launch-blocker` · Native Sign in with Apple in a development build

This run ships Apple and Google through the **OAuth web flow**
(`expo-auth-session` + `expo-web-browser`), because Expo Go runs under *Expo's*
bundle identifier, not Ductective's, so a native SIWA sheet cannot be configured
against our Apple Services ID — and the SDK 54 pin exists precisely because the
test iPhone cannot run a newer Expo Go (`app/AGENTS.md`).

Guideline 4.8 asks that Sign in with Apple be **offered**, and it is. But App
Review expects the native experience on iOS.

**Risk of leaving it:** review friction, not a missing feature. Honest framing:
this run is compliant in substance and not yet in polish. Closes with E10's
development build, where `expo-apple-authentication` replaces the web sheet on
iOS and the SDK pin disappears entirely.

## OPEN · `launch-blocker` · Re-enable email confirmation before public release

OQ-A7b turns "Confirm email" **off** for the beta so brief AC 1's on-device proof
does not depend on a shared, hard rate-limited free-tier mailer. Measured 10 Aug
2026: it is currently **on**, and it is what makes `signUp` return
`email rate limit exceeded` after a handful of attempts.

**Risk of leaving it off:** a user can sign up with an address that is not theirs
and squat on someone else's. Tolerable for a closed beta with a handful of known
testers; not tolerable at public launch. It also interacts with OQ-A9 — an
unverified address must never be a basis for linking identities.

## OPEN · `launch-blocker` · Password reset

Not built. Needs deliverable transactional mail and a deep-link scheme — the same
infrastructure OQ-A3 declined for join codes.

**Risk:** a beta tester who forgets their password is locked out with no
self-service path and no support path. Softened but not removed by OQ-A7: a user
who signed up with Apple or Google has no password to forget.

## OPEN · Manual provider linking for Apple Private Relay users

Apple returns an `@privaterelay.appleid.com` alias rather than the real address,
so a user's Apple identity and their `dave@shop.com` password account **cannot**
be matched by email — by design, and no client logic changes that.

Measured 10 Aug 2026 (`npm run measure:linking`): this project refuses two
`auth.users` rows with the same email (`email_exists`), so a *same-address*
collision can only link or error — never silently duplicate. Private Relay is the
one case that escapes that, because the two addresses genuinely differ.

**Risk:** some users end up with two accounts and their history appears to have
vanished. Mitigated by disclosure in the sign-in copy plus a manual "link another
sign-in method" action on the profile screen (ST-A11 AC 4).

## OPEN · A chunked SecureStore adapter for the session token

ST-A02 chose `@react-native-async-storage/async-storage` over
`expo-secure-store`: SecureStore encrypts at rest, which is better, but its
~2048-byte per-item limit can be exceeded by a Supabase session, producing a
failure that appears for some users and not others.

**Risk, stated rather than hidden:** the session token is stored **unencrypted**
on the device and is readable on a rooted or jailbroken phone. A chunked adapter
that splits the session across SecureStore items would close it.

## OPEN · Join-code brute force is bounded, not rate-limited

`sql/013` gives codes 50 bits of entropy, a 14-day expiry, a use limit, and a
table no non-owner can read — a code can only be obtained by being told it. What
it does **not** have is a request-rate limit at the database, so an attacker can
guess as fast as PostgREST will answer.

**Risk:** impractical rather than impossible. At 50 bits with expiry and use
limits the expected number of guesses is far beyond any realistic rate, but
"impractical" is not "prevented" and the distinction belongs on record. Closing it
needs either pg_cron-based throttling or an Edge Function in front of
`redeem_join_code`.

## OPEN · `L` · Remove `app/lib/accountsAdapter.ts` (filed 10 Aug 2026)

Stage 4 raised three CONTRACT MISMATCHes against Stage 3 and, correctly, worked
around them in one named module rather than reaching into Backend's files. All
three were then verified and **fixed at source**:

| | Defect | Fix |
|---|---|---|
| CM-1 | `getMyProfile()` selected `profiles` unfiltered with `.maybeSingle()`; `profiles_select_co_member` is OR'd with `profiles_select_own`, so a second person in the company made it return N rows and throw | `.eq('id', uid)` in `accounts.ts` |
| CM-2 | `listMyMemberships()` returned co-members' rows, so a three-person shop listed the same company three times | `.eq('user_id', uid)` in `accounts.ts` |
| CM-3 | `company_roster` had no `membership_id`, but `setMemberRole`/`removeMembership` are keyed by one | `m.id as membership_id` added to the view **in `sql/012` itself**, since it has never been applied |

CM-1 deserves a note: solo users worked and every real shop broke — the worst
shape of bug, invisible to any single-user fixture. It was found by reading, not
by a failing test.

The adapter now filters rows `accounts.ts` has already filtered. Harmless, still
correct, no longer load-bearing. **The work:** delete the module, point
`CompanyScreen` and `AccountScreen` at `lib/accounts.ts`, drop
`accountsAdapter.test.mjs`. Not done in the same change as the source fix because
it means rewiring two screens with no component test runner and no headless
browser — do it with the app running so the screens can be seen working.

**Risk of leaving it:** none functionally. The cost is a reader believing there
are three open contract defects when there are none; the header now says
otherwise, which is what makes deferring it safe rather than merely convenient.
