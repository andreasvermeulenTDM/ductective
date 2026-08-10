/**
 * measure-auth-linking.mjs — OQ-A9, measured rather than assumed.
 *
 *   npm run measure:linking
 *
 * §8.9 of `.pipeline/02-user-stories-accounts.md` requires Stage 3 to determine
 * **empirically** what this project does when the same email address arrives from
 * two different identity sources, because OQ-A9's two outcomes need different copy
 * and different flows:
 *
 *   1. Supabase links the new identity to the existing user  → nothing to build.
 *   2. Supabase creates a second user                        → the app must detect
 *      and explain it, or the technician's history "disappears" with nothing
 *      telling them why.
 *
 * **What this script can and cannot see, stated plainly.** Completing a real Apple
 * or Google authorization needs a browser, a provider account, and providers that
 * are actually enabled on the project — none of which an agent has, and the last of
 * which is BLOCKED on ST-A20. So this measures the *decidable substrate* underneath
 * OQ-A9, which is where the answer actually lives:
 *
 *   A. Can two `auth.users` rows hold the same email at all? If not, outcome 2 is
 *      structurally impossible and a provider collision must either link or error —
 *      it can never silently strand an account.
 *   B. What does `signUp` do with an address that already exists? This is the same
 *      collision the OAuth path hits, minus the provider.
 *   C. Is a freshly created address confirmed? GoTrue decides whether to link an
 *      OAuth identity to an existing user by whether that user's email is
 *      **confirmed**, so this is the switch OQ-A9 item 3 turns on.
 *
 * Every user created here is deleted before the script exits, including on failure.
 * Service role is used for fixture setup and teardown only — it asserts nothing.
 * No address, password or token is printed.
 */

import { createClient } from '@supabase/supabase-js';
import { scratchEmail, scratchPassword } from '../lib/auth-config.mjs';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const say = (m) => console.log(`  ${m}`);
const measure = (label, value) => console.log(`  \x1b[36mMEASURED\x1b[0m  ${label}\n              → ${value}`);

if (!url || !anonKey || !serviceKey) {
  console.error('env missing — run with --env-file=.env');
  process.exitCode = 1;
} else {
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const anon = createClient(url, anonKey, opts);
  const admin = createClient(url, serviceKey, opts);
  const created = [];

  console.log('\nDuctective — OQ-A9 account-linking behaviour (measured, not assumed)\n');

  try {
    const email = scratchEmail();
    const password = scratchPassword();

    // --- A. one email, two users? ------------------------------------------
    const first = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (first.error) {
      measure('A. two users, one email', `could not create the first user: ${first.error.message}`);
    } else {
      created.push(first.data.user.id);
      measure(
        'A0. identities on a fresh email/password user',
        (first.data.user.identities ?? []).map((i) => i.provider).join(', ') || '(none reported)'
      );
      measure(
        'A1. email_confirmed_at on an admin-created confirmed user',
        first.data.user.email_confirmed_at ? 'set' : 'NOT set'
      );

      const second = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (second.error) {
        measure(
          'A. two auth.users rows with the same email',
          `REFUSED — ${second.error.code ?? second.error.status}: ${second.error.message}`
        );
      } else {
        created.push(second.data.user.id);
        measure('A. two auth.users rows with the same email', 'ALLOWED — the project permits duplicates');
      }
    }

    // --- B. signUp against an existing address ------------------------------
    const dup = await anon.auth.signUp({ email, password: scratchPassword() });
    if (dup.error) {
      measure('B. anon signUp on an existing address', `ERROR ${dup.error.code ?? dup.error.status}: ${dup.error.message}`);
    } else {
      const identities = dup.data?.user?.identities ?? [];
      // A user object with zero identities is GoTrue's *decoy*: no row was created,
      // so its id does not exist and trying to delete it would report a spurious
      // teardown failure. Only enqueue a user we actually made.
      if (dup.data?.user?.id && identities.length > 0 && !created.includes(dup.data.user.id)) {
        created.push(dup.data.user.id);
      }
      measure(
        'B. anon signUp on an existing address',
        dup.data?.session
          ? 'a SESSION was returned — the address was silently re-registered'
          : identities.length === 0
            ? 'an obfuscated user with ZERO identities was returned (GoTrue user-enumeration protection: the call looks successful, no account was created, no session was issued)'
            : `a user with identities [${identities.map((i) => i.provider).join(', ')}] and no session was returned`
      );
    }

    // --- C. confirmation state of a self-service sign-up --------------------
    const fresh = scratchEmail();
    const s = await anon.auth.signUp({ email: fresh, password: scratchPassword() });
    if (s.error) {
      measure('C. self-service signUp confirmation state', `signUp failed: ${s.error.message}`);
      if (/rate limit/i.test(s.error.message)) {
        say('(a mail rate limit means confirmation email is being SENT — i.e. "Confirm email" is ON.)');
      }
    } else {
      if (s.data?.user?.id) created.push(s.data.user.id);
      measure(
        'C. self-service signUp confirmation state',
        `${s.data?.session ? 'session issued' : 'NO session issued'}; email_confirmed_at ${s.data?.user?.email_confirmed_at ? 'set' : 'NOT set'}`
      );
    }
  } finally {
    let stranded = 0;
    for (const id of created) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) stranded++;
    }
    console.log(`\n  cleanup: ${created.length - stranded}/${created.length} scratch user(s) deleted via service role.`);
    if (stranded) process.exitCode = 1;
  }

  console.log('\nRecord the output above in .pipeline/03-backend-accounts.md. This is a\nmeasurement, not a gate — it never fails the build.\n');
}
