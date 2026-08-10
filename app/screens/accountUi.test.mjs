/**
 * The static half of ST-A04, ST-A06, ST-A10, ST-A12, ST-A13 and ST-A18.
 *
 *   npm test
 *
 * This repo has **no component test runner** — no React Testing Library, no
 * react-test-renderer, no jest — and this run does not add one (that would be a
 * dependency and a test-infrastructure decision this story has no mandate for).
 * So screens are checked the way `tests/suites/e6-app.mjs` already checks them:
 * by reading the source and asserting the structure the criteria name. It lives
 * here as a `*.test.mjs` rather than in `tests/suites/` so `npm test` picks it up
 * — ST-A16 AC 3 wants the new tests inside the command the pipeline actually
 * runs. Stage 5 owns `tests/suites/e9-accounts.mjs` and the harness attribution.
 *
 * **What this cannot do, said plainly:** it does not render anything. It cannot
 * prove a control is reachable, that focus is visible, or that the disclosure is
 * legible on a phone in sunlight. Those are ST-A17's [H] criteria and they are
 * left there rather than dressed up as passing here.
 *
 * The comment stripping matters: several of these files argue about hex values,
 * refusals and "sign in to save" **in prose**, and prose is not code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { blankComments, findTags, attributeValue } from '../../tests/lib/jsx.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');

const read = (rel) => readFileSync(join(APP, rel), 'utf8');
const code = (rel) => blankComments(read(rel));

/** Everything this run added or reworked on the identity path. */
const NEW_SCREENS = [
  'screens/SignInScreen.tsx',
  'screens/AccountScreen.tsx',
  'screens/CompanyScreen.tsx',
  'components/Form.tsx',
];

// ---------------------------------------------------------------------------
// ST-A04 — the sign-in screen
// ---------------------------------------------------------------------------

test('ST-A04 AC 1: all four ways in are on the sign-in screen', () => {
  const src = code('screens/SignInScreen.tsx');
  // Apple and Google are rendered by mapping the shared constant rather than
  // being written out, so the check is that the map exists and that the labels
  // it draws from are both there.
  assert.match(src, /SIGN_IN_PROVIDERS\.map/, 'providers are not rendered from the shared constant');
  assert.match(src, /Continue with Apple/);
  assert.match(src, /Continue with Google/);
  assert.match(src, /signInWithEmail|signUpWithEmail/, 'no email and password path');
  assert.match(src, /Continue without an account/, 'ST-A06\'s fourth action is missing');
});

test('ST-A04 AC 2 COMPLIANCE: Google cannot ship without Apple', () => {
  // This test exists to fail a build rather than fail an App Review. Guideline
  // 4.8 makes offering Google without Sign in with Apple a rejection, and brief
  // hard constraint 4 forbids descoping Apple to unblock a wave.
  const auth = code('lib/auth.ts');
  const providers = /SIGN_IN_PROVIDERS[^=]*=\s*\[([^\]]*)\]/.exec(auth);
  assert.ok(providers, 'SIGN_IN_PROVIDERS is not a literal array any more');

  const list = providers[1];
  const hasGoogle = /'google'/.test(list);
  const hasApple = /'apple'/.test(list);
  if (hasGoogle) assert.ok(hasApple, 'Google is offered without Apple — guideline 4.8 rejection');

  // And Apple is first, which is the prominence half of the same guideline.
  if (hasApple && hasGoogle) {
    assert.ok(list.indexOf("'apple'") < list.indexOf("'google'"), 'Apple must be offered first');
  }

  // The screen must not hand-write a provider button beside the map, which is
  // how the constant gets bypassed without anyone noticing.
  const screen = code('screens/SignInScreen.tsx');
  assert.doesNotMatch(screen, /signInWithProvider\(\s*'google'\s*\)/, 'a hardcoded Google call bypasses the pairing');
});

test('ST-A04 AC 5: a cancelled OAuth sheet is never rendered as a failure', () => {
  const src = code('screens/SignInScreen.tsx');
  assert.match(src, /isSilentOutcome/, 'the cancel path is not checked');
  assert.match(src, /status === 'cancelled'/, 'a cancelled outcome is not short-circuited');
});

test('ST-A04 AC 8 / OQ-A9: an in-use address routes instead of stranding history', () => {
  const src = code('screens/SignInScreen.tsx');
  assert.match(src, /'address-in-use'/);
  // The whole point is that it must not read as a failed sign-up. It flips to
  // sign-in mode so the technician reaches the account their history is on.
  assert.match(src, /setMode\('sign-in'\)/);
});

test('ST-A04 AC 9: no password, email or token can reach a log line', () => {
  for (const f of NEW_SCREENS.concat(['lib/accountCopy.ts', 'lib/accountsAdapter.ts'])) {
    assert.doesNotMatch(code(f), /console\.(log|warn|error|info|debug)/, `${f} logs`);
  }
});

// ---------------------------------------------------------------------------
// ST-A06 — the guest disclosures
// ---------------------------------------------------------------------------

test('ST-A06 AC 6: the disclosure is on the answer surface and precedes the composer', () => {
  const src = code('screens/ChatScreen.tsx');
  assert.match(src, /<GuestNotice/, 'the composer surface carries no guest disclosure');

  // "Before the first answer, not after" — so it must not be inside the empty
  // state (which disappears on the first send) and must not be gated on there
  // being messages.
  const notice = src.indexOf('<GuestNotice');
  const composer = src.indexOf('style={s.composer}');
  assert.ok(notice > 0 && composer > 0);
  assert.ok(notice < composer, 'the disclosure is rendered after the composer');
  // It is conditioned on auth state and on nothing else — in particular not on
  // the transcript being empty, which is what "before the first answer, not
  // after" rules out.
  const preamble = src.slice(Math.max(0, notice - 160), notice);
  assert.match(preamble, /!signedIn &&/, 'the disclosure is not gated on auth state');
  assert.doesNotMatch(preamble, /messages\.length/, 'the disclosure disappears once a question is asked');
});

test('ST-A06 AC 6: the unit gate carries it too, because the gate answers', () => {
  // U7's carve-out returns a **refusal** before any unit exists, and a refusal is
  // an answer. Without the disclosure here, a guest whose first question is a
  // hazard gets a reply having never been told nothing is being kept — which is
  // the precise failure "before the first answer, not after" names.
  const gate = code('screens/UnitGate.tsx');
  assert.match(gate, /<GuestNotice/, 'the unit gate can answer but carries no disclosure');
  assert.match(gate, /refusalCheck/, 'assumption check: the gate no longer answers');
  assert.ok(
    gate.indexOf('<GuestNotice') < gate.indexOf('refusal &&'),
    'the disclosure must precede the refusal it would otherwise follow'
  );
  // And the shell has to actually pass the props, or the notice never renders.
  assert.match(code('App.tsx'), /<UnitGate[\s\S]{0,300}signedIn=\{signedIn\}/);
});

test('ST-A06 AC 7: the guest History tab explains itself and carries an action', () => {
  const src = code('screens/HistoryScreen.tsx');
  assert.match(src, /if \(!signedIn\)/, 'no dedicated guest state');
  assert.match(src, /GUEST_HISTORY\.title/);
  assert.match(src, /action=\{\{[^}]*GUEST_HISTORY\.action/, 'the empty state has no way forward');

  // It must come before the offline and error branches: for a guest nothing was
  // requested, so nothing failed, and "can't reach your history" would be a
  // fault the app invented.
  assert.ok(src.indexOf('if (!signedIn)') < src.indexOf('if (offline)'));
});

test('ST-A06 AC 9: the boundary marker is drawn from the shell\'s auth transition', () => {
  const src = code('screens/ChatScreen.tsx');
  assert.match(src, /<SavedFromHere/);
  assert.match(src, /justSignedIn/);
  assert.match(src, /onBoundaryDrawn/, 'the shell is never told the marker was drawn');
});

test('ST-A06 AC 8: the next question after signing in starts a real session', () => {
  const src = code('screens/ChatScreen.tsx');
  // The guest session id is not a row and never becomes one — no back-fill.
  assert.match(src, /detached\.current \? null : sessionId/, 'the guest session id is reused for writes');
  assert.match(src, /seqBase/, 'seq is not rebased, so the new session collides on (session_id, seq)');
});

// ---------------------------------------------------------------------------
// ST-A10 / ST-A18 — company screens and the privacy promise
// ---------------------------------------------------------------------------

test('ST-A10 AC 1: create, join, roster and the owner actions all exist', () => {
  const src = code('screens/CompanyScreen.tsx');
  for (const fn of ['createCompany', 'redeemJoinCode', 'listRoster', 'createJoinCode', 'revokeJoinCode', 'removeMembership', 'setMemberRole']) {
    assert.match(src, new RegExp(`\\b${fn}\\b`), `${fn} is not wired into the company screens`);
  }
});

test('ST-A18 AC 1 and 2: the privacy statement is on all three surfaces', () => {
  const src = code('screens/CompanyScreen.tsx');
  const uses = [...src.matchAll(/<CompanyPrivacyNotice\s*\/>/g)];
  assert.equal(uses.length, 3, 'the privacy statement must be on create, join and the company screen');
});

test('ST-A18 AC 3: it is not collapsible and precedes the primary action', () => {
  const src = code('screens/CompanyScreen.tsx');

  // Not behind a toggle, an accordion or a "show more".
  assert.doesNotMatch(src, /collaps|accordion|show more/i);

  // In each of the three screens the notice appears before that screen's
  // primary button. Checked pairwise so a reordering fails here rather than in
  // a review nobody schedules.
  for (const action of ['Create company', 'Join company']) {
    const button = src.indexOf(`label="${action}"`);
    assert.ok(button > 0, `${action} button not found`);
    const noticeBefore = src.lastIndexOf('<CompanyPrivacyNotice />', button);
    assert.ok(noticeBefore > 0 && noticeBefore < button, `the privacy notice does not precede "${action}"`);
  }
});

test('ST-A10 AC 2: owner-only rendering is documented as cosmetic, not as security', () => {
  const src = read('screens/CompanyScreen.tsx');
  assert.match(src, /COSMETIC|cosmetic/, 'the file does not state that hidden UI is not enforcement');
  assert.match(src, /ST-A08/, 'it does not point at what the actual enforcement is');
});

// ---------------------------------------------------------------------------
// ST-A12 — deletion
// ---------------------------------------------------------------------------

test('ST-A12 AC 9: deletion is gated on a typed word and offers the sole-owner exits', () => {
  const src = code('screens/AccountScreen.tsx');
  assert.match(src, /DELETE_ACCOUNT\.confirmWord/);
  assert.match(src, /armed/, 'the destructive action is not gated');
  assert.match(src, /disabled=\{!armed\}/, 'the delete button is live before the word is typed');
  assert.match(src, /sole_owner_of_company/);
  assert.match(src, /e\.detail/, 'the company id on the error is not used to offer a way out');
});

test('ST-A12 AC 10: a guest has no deletion surface, because the screen is not mounted', () => {
  const shell = code('App.tsx');
  // The account tab renders one or the other. A guest gets SignInScreen, so
  // AccountScreen — and every company and deletion control inside it — never
  // exists rather than being hidden.
  assert.match(shell, /signedIn \?\s*\(?\s*<AccountScreen/);
  assert.match(shell, /<SignInScreen/);
});

test('ST-A12: the service-role key appears nowhere under app/', () => {
  for (const f of NEW_SCREENS.concat(['App.tsx', 'lib/accountCopy.ts', 'lib/accountsAdapter.ts'])) {
    assert.doesNotMatch(read(f), /SUPABASE_SERVICE_ROLE_KEY/);
  }
});

// ---------------------------------------------------------------------------
// ST-A13 — a solo technician is a first-class user
// ---------------------------------------------------------------------------

test('ST-A13 AC 3: nothing outside the company screens is gated on a company', () => {
  // The company screens are allowed to care about a company. Nothing else is.
  const elsewhere = ['screens/ChatScreen.tsx', 'screens/HistoryScreen.tsx', 'App.tsx', 'components/Chrome.tsx'];
  for (const f of elsewhere) {
    assert.doesNotMatch(code(f), /active_company_id/, `${f} conditions on a company`);
  }
  // And the account hub reads it only to mark which company stamps new sessions
  // — never to decide whether to render.
  const hub = code('screens/AccountScreen.tsx');
  assert.doesNotMatch(hub, /if \([^)]*active_company_id[^)]*\)\s*return/, 'an early return is gated on a company');
});

test('ST-A13: the app never routes into the company screens by force', () => {
  const shell = code('App.tsx');
  assert.doesNotMatch(shell, /CompanyScreen|CreateCompanyScreen|JoinCompanyScreen/,
    'the shell can navigate straight into a company screen');
});

// ---------------------------------------------------------------------------
// The two domain rules, and the design system
// ---------------------------------------------------------------------------

test('a refusal is rendered by the refusal component and by nothing else', () => {
  // CLAUDE.md's second domain rule. None of the new screens may draw a refusal,
  // and none of them may borrow the refusal card's language for an error: red
  // all over with no action is what tells a technician to stop.
  for (const f of NEW_SCREENS.concat(['screens/AccountScreen.tsx'])) {
    assert.doesNotMatch(code(f), /kind === 'refusal'|RefusalCard/, `${f} renders a refusal itself`);
    assert.doesNotMatch(code(f), /color\.refusal\b(?!Text|Border|Surface)/, `${f} uses the refusal fill colour`);
  }
});

test('ST-A04 AC 6 / ST-A10 AC 4: no hex literal outside the token module', () => {
  for (const f of NEW_SCREENS.concat(['screens/AccountScreen.tsx', 'lib/accountCopy.ts'])) {
    const offenders = [...code(f).matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((m) => m[1]);
    assert.deepEqual(offenders, [], `${f} hardcodes ${offenders.join(', ')}`);
  }
});

test('ST-A04 AC 6 / ST-A10 AC 4: touch targets are sized from MIN_TOUCH, not by hand', () => {
  // Two halves, because the first on its own would pass vacuously: there are
  // currently no numeric heights in these files at all, which is the point.
  //
  // (a) every file that draws a control sizes it from the token, and
  // (b) no numeric literal has crept in under the 48dp floor — the shape a
  //     regression would actually take.
  for (const f of NEW_SCREENS.concat(['screens/AccountScreen.tsx'])) {
    const src = code(f);
    const drawsControls = /ScalePressable|Pressable|TextInput/.test(src);
    if (drawsControls) {
      assert.match(src, /MIN_TOUCH/, `${f} draws controls without referencing the 48dp token`);
      assert.match(src, /minHeight:\s*MIN_TOUCH/, `${f} never applies MIN_TOUCH as a height`);
    }
    // `minHeight`/`minWidth` only. A bare `height` is legitimately tiny — the
    // 1dp rules between the provider buttons and the email form are `height: 1`
    // and are not targets.
    for (const m of src.matchAll(/(?:minHeight|minWidth):\s*(\d+)\b/g)) {
      // Under 48 is only legal where a hitSlop grows the target back — the
      // `touchSlop` helper the citation chip already uses. None of these files
      // do that today, so any literal under the floor is a real finding.
      assert.ok(
        Number(m[1]) >= 48 || /touchSlop|hitSlop/.test(src),
        `${f} declares ${m[0]} with no hitSlop compensation — under the 48dp floor`
      );
    }
  }
});

test('every interactive element in the new screens is labelled', () => {
  // The same rule `tests/suites/e6-app.mjs` applies app-wide, applied to the
  // controls this run added — including ScalePressable, which that suite does
  // not scan because it did not exist as a wrapper when it was written.
  const offenders = [];
  for (const f of NEW_SCREENS.concat(['screens/AccountScreen.tsx', 'components/Chrome.tsx'])) {
    const src = code(f);
    for (const tag of findTags(src, ['Pressable', 'ScalePressable', 'TouchableOpacity'])) {
      const label = attributeValue(tag.source, 'accessibilityLabel');
      if (!label) {
        const line = src.slice(0, tag.index).split('\n').length;
        offenders.push(`${f}:${line} <${tag.name}>`);
      }
    }
  }
  assert.deepEqual(offenders, [], `unlabelled: ${offenders.join(', ')}`);
});

test('ST-A02 AC 6: the shell subscribes to auth once and unsubscribes on unmount', () => {
  const shell = code('App.tsx');
  assert.match(shell, /startAuth\(/, 'the shell never starts the auth subscription');
  // `startAuth` returns its own unsubscribe, so returning it from the effect is
  // the cleanup. A leaked listener across sign-out/sign-in is how stale-user
  // bugs get in.
  assert.match(shell, /return startAuth\(/, 'the subscription is not cleaned up on unmount');
});

test('ST-A02 AC 7: determining renders as loading, never as guest', () => {
  const shell = code('App.tsx');
  assert.match(shell, /isDetermining\(auth\)/, 'the shell does not gate on the determining state');
  // `phase !== 'signed-in'` is the wrong check and is the one that produces the
  // 200ms guest flash at every cold start.
  assert.doesNotMatch(shell, /phase\s*!==\s*'signed-in'/);
});
