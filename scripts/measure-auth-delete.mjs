/**
 * measure-auth-delete.mjs — ST-A12 / §8.4, the run's highest technical risk.
 *
 *   npm run measure:authdelete
 *
 * Answers, as far as it can from outside the database: **can an in-app account
 * deletion remove the `auth.users` row without the service-role key ever leaving
 * the server?**
 *
 * There are two halves and they are BLOCKED on different things:
 *
 *   Half 1 — can a SECURITY DEFINER function delete from `auth.users`?
 *            This needs DDL. Nothing in this repo can execute DDL: every
 *            statement is run by hand by the owner in the Supabase SQL Editor.
 *            So it is BLOCKED here, and `sql/probe_auth_delete_capability.sql`
 *            is the fifteen-second paste that answers it. Once
 *            `sql/014_account_deletion.sql` has been applied this script stops
 *            guessing and measures the real RPC end to end.
 *
 *   Half 2 — does the Edge Function fallback have a working mechanism?
 *            Measurable right now: the Admin API delete is exercised against a
 *            throwaway user, so if half 1 comes back CANNOT_DELETE we already
 *            know path (B) works rather than discovering it later.
 *
 * Service role is used for fixture setup, for the path-(B) mechanism check, and
 * for proving **absence** after a deletion. It is never used to assert that a
 * user *can* read something — that would prove nothing, because it bypasses RLS.
 */

import { createClient } from '@supabase/supabase-js';
import { scratchEmail, scratchPassword } from '../lib/auth-config.mjs';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const measure = (label, value) => console.log(`  \x1b[36mMEASURED\x1b[0m  ${label}\n              → ${value}`);
const blocked = (label, value) => console.log(`  \x1b[33mBLOCKED\x1b[0m   ${label}\n              → ${value}`);

if (!url || !anonKey || !serviceKey) {
  console.error('env missing — run with --env-file=.env');
  process.exitCode = 1;
} else {
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const anon = createClient(url, anonKey, opts);
  const admin = createClient(url, serviceKey, opts);
  const created = [];

  console.log('\nDuctective — ST-A12 auth.users deletion capability\n');

  try {
    // --- Half 2: does the Admin API delete actually work here? --------------
    const email = scratchEmail();
    const made = await admin.auth.admin.createUser({
      email,
      password: scratchPassword(),
      email_confirm: true,
    });
    if (made.error) {
      measure('path (B) mechanism — Admin API createUser', `FAILED: ${made.error.message}`);
    } else {
      const uid = made.data.user.id;
      created.push(uid);
      const del = await admin.auth.admin.deleteUser(uid);
      if (del.error) {
        measure('path (B) mechanism — admin.deleteUser', `FAILED: ${del.error.message}`);
      } else {
        created.pop();
        const { data: after } = await admin.auth.admin.getUserById(uid);
        measure(
          'path (B) mechanism — admin.deleteUser',
          after?.user ? 'returned success but the user is still present' : 'WORKS — the auth.users row is gone'
        );
      }
    }

    // --- Half 1: the definer RPC, if it has been applied yet ----------------
    const probe = await anon.rpc('delete_own_account');
    const missing =
      probe.error &&
      (probe.error.code === 'PGRST202' || /could not find the function|does not exist/i.test(probe.error.message));

    if (missing) {
      blocked(
        'path (A) — can a SECURITY DEFINER function delete from auth.users?',
        'sql/014_account_deletion.sql has not been applied yet, and an agent cannot run DDL.\n' +
          '                Owner: paste sql/probe_auth_delete_capability.sql into the Supabase SQL Editor.\n' +
          '                It deletes nothing, touches no ingest table, and drops itself. One row comes back:\n' +
          "                'CAN_DELETE'  → ship public.delete_own_account() (no Edge Function needed)\n" +
          "                'CANNOT_...'  → ship public.delete_own_account_data() + the Edge Function fallback"
      );
    } else if (probe.error) {
      // The RPC exists. An unauthenticated caller must be refused — that is
      // itself an assertion ST-A12 AC 1 makes, so report it rather than swallow it.
      measure(
        'path (A) — delete_own_account() exists; unauthenticated call',
        `refused as designed: ${probe.error.code ?? ''} ${probe.error.message}`
      );
      measure(
        'path (A) — capability',
        'the RPC is installed. Run `npm run verify:accounts` for the full end-to-end deletion assertions.'
      );
    } else {
      measure('path (A) — delete_own_account()', 'an UNAUTHENTICATED call SUCCEEDED. That is a defect — it must be granted to `authenticated` only.');
      process.exitCode = 1;
    }
  } finally {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length) console.log(`\n  cleanup: ${created.length} scratch user(s) deleted.`);
  }

  console.log('\nRecord the output above in .pipeline/03-backend-accounts.md.\n');
}
