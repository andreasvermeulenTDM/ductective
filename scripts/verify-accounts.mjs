/**
 * verify-accounts.mjs — every isolation claim in this run, measured against RLS.
 *
 *   npm run verify:accounts
 *
 * ###########################################################################
 * ##  THE ONE RULE                                                         ##
 * ###########################################################################
 * Fixtures are created and torn down with the **service-role** client. Every
 * **assertion** is made through `createClient(url, ANON_KEY)` carrying a real
 * user's JWT.
 *
 * Service role bypasses row-level security entirely, so an isolation assertion
 * made with it proves nothing at all — it would pass on a database with no
 * policies whatsoever. `scripts/verify-sessions.mjs` states the same rule at the
 * top of its own file, and this script extends that pattern rather than inventing
 * one. The single exception is proving **absence** after a deletion (ST-A12 AC 2),
 * where the whole point is that no row exists for anyone.
 *
 * Un-applied migrations report **BLOCKED**, never FAIL. A schema that has not been
 * created yet is not a defect, and reporting it as one sends the iterate-until-done
 * loop chasing something that is not broken — the same contract `tests/run-all.mjs`
 * states.
 *
 * Nothing here prints an address, a password or a token.
 */

import { createClient } from '@supabase/supabase-js';
import { isWellFormedJoinCode } from '../lib/join-code.mjs';
import { scratchEmail, scratchPassword } from '../lib/auth-config.mjs';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;
let blockedCount = 0;
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m     ${m}`);
const fail = (m, hint) => {
  console.log(`  \x1b[31mFAIL\x1b[0m     ${m}`);
  if (hint) console.log(`           → ${hint}`);
  failures++;
};
const blocked = (m, hint) => {
  console.log(`  \x1b[33mBLOCKED\x1b[0m  ${m}`);
  if (hint) console.log(`           → ${hint}`);
  blockedCount++;
};
const section = (m) => console.log(`\n${m}`);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

if (!url || !anonKey || !serviceKey) {
  blocked('Supabase env missing', 'Run with --env-file=.env');
  report();
} else {
  const admin = createClient(url, serviceKey, opts);
  const made = [];

  /**
   * A real account, and a client that is the app: the anon key plus that user's
   * JWT. `email_confirm: true` because ST-A01's "Confirm email" toggle is still
   * ON at the time of writing — the fixture must not depend on a mail round trip.
   */
  async function user(label) {
    const email = scratchEmail();
    const password = scratchPassword();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`fixture ${label}: ${error.message}`);
    made.push(data.user.id);

    const client = createClient(url, anonKey, opts);
    const { error: sErr } = await client.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(`fixture ${label} sign-in: ${sErr.message}`);
    return { id: data.user.id, client, label };
  }

  /** A bare anon client with no sign-in at all — the unauthenticated attacker. */
  const stranger = createClient(url, anonKey, opts);

  /**
   * Every session this script writes carries one of these titles, so teardown can
   * find them by service role even when the run failed halfway and even when the
   * row ended up owned by nobody. A verifier that leaves rows behind slowly turns
   * into the thing it is checking for.
   */
  const VERIFY_TITLE = 'verify:accounts high head pressure';
  const ANON_PROBE_TITLE = 'verify:accounts unauthenticated probe';

  const count = (res) => (res.error ? -1 : (res.data ?? []).length);

  try {
    // -----------------------------------------------------------------------
    section('Preconditions — which migrations have been applied');
    // -----------------------------------------------------------------------
    const applied = {};
    for (const [name, table] of [
      ['sql/010 profiles', 'profiles'],
      ['sql/012 companies', 'companies'],
      ['sql/012 memberships', 'memberships'],
      ['sql/013 join codes', 'company_join_codes'],
    ]) {
      const { error } = await admin.from(table).select('*').limit(1);
      applied[table] = !error;
      if (error) blocked(`${name} not applied`, `Run ${name.split(' ')[0]} in the Supabase SQL Editor.`);
      else pass(`${name} applied`);
    }

    const { data: nullRows } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: false })
      .is('user_id', null);
    const cutover = (nullRows ?? []).length === 0;
    if (!cutover) {
      blocked(
        `sql/011 cutover not applied — ${nullRows.length} session(s) still have user_id null`,
        'Run sql/011_session_rls_cutover.sql. Read ST-A14 first: it deletes them by default.'
      );
    } else {
      pass('sql/011 disposition done — no ownerless sessions (brief AC 7)');
    }

    // -----------------------------------------------------------------------
    section('Fixtures (service role — setup only, never an assertion)');
    // -----------------------------------------------------------------------
    const A = await user('A');
    const B = await user('B');
    pass('two real accounts created, each with a real JWT on an anon-key client');

    // -----------------------------------------------------------------------
    section('ST-A03 — profiles are private to their owner');
    // -----------------------------------------------------------------------
    if (!applied.profiles) {
      blocked('profile assertions', 'sql/010 not applied');
    } else {
      const own = await A.client.from('profiles').select('id').eq('id', A.id);
      count(own) === 1
        ? pass("AC 4: the trigger provisioned A's profile and A can read it")
        : fail(`AC 4: expected 1 own profile row, got ${count(own)}`, 'Is the on_auth_user_created trigger installed?');

      const foreign = await B.client.from('profiles').select('id').eq('id', A.id);
      count(foreign) === 0
        ? pass("AC 3 NEGATIVE: B reads 0 rows of A's profile")
        : fail(`AC 3 NEGATIVE: B read ${count(foreign)} row(s) of A's profile`);

      const hijack = await B.client
        .from('profiles')
        .update({ display_name: 'not yours' })
        .eq('id', A.id)
        .select('id');
      count(hijack) === 0
        ? pass("AC 3 NEGATIVE: B's update of A's profile affects 0 rows")
        : fail(`AC 3 NEGATIVE: B updated ${count(hijack)} row(s) of A's profile`);

      const strangerRead = await stranger.from('profiles').select('id');
      count(strangerRead) <= 0
        ? pass('unauthenticated read of profiles returns nothing')
        : fail(`an unauthenticated client read ${count(strangerRead)} profile row(s)`);
    }

    // -----------------------------------------------------------------------
    section('ST-A05 — sessions are isolated by policy (brief AC 2)');
    // -----------------------------------------------------------------------
    // Gated on the cutover, and this gate is load-bearing. Before sql/011 the
    // prototype policy in sql/002 lets any holder of the anon key read and write
    // every `user_id is null` row — by design, and its own comment says so. Every
    // assertion below would therefore fail, and reporting nine FAILs for a
    // migration that has not been run yet would be reporting the prototype as a
    // defect. BLOCKED is the honest verdict, and `tests/run-all.mjs` says the same.
    const mine = cutover
      ? await A.client
          .from('sessions')
          .insert({ title: VERIFY_TITLE, equipment: 'Trane Precedent YSC072' })
          .select('id, user_id')
          .single()
      : null;

    if (!cutover) {
      blocked(
        'every session-isolation assertion (brief AC 2)',
        'sql/011 has not been applied, so the prototype `user_id is null` policy is still in force and there is nothing to isolate yet.'
      );
    } else if (mine.error) {
      fail(`AC 8: A could not create their own session: ${mine.error.message}`);
    } else {
      const sid = mine.data.id;
      mine.data.user_id === A.id
        ? pass("AC 1: the database stamped user_id = A (default auth.uid()), not the client")
        : fail(`AC 1: session user_id is ${mine.data.user_id}, expected A`);

      const msg = await A.client
        .from('messages')
        .insert({ session_id: sid, kind: 'answer', body: 'Check condenser coil loading first.', seq: 0 })
        .select('id')
        .single();
      if (msg.error) {
        fail(`AC 8: A could not append a message: ${msg.error.message}`);
      } else {
        const cite = await A.client.from('citations').insert({
          message_id: msg.data.id,
          source_document: 'RT-SVX23R-EN — Precedent Rooftop IOM',
          page: 84,
          claim: 'High head pressure causes',
          ordinal: 1,
        });
        cite.error ? fail(`AC 8: citation insert: ${cite.error.message}`) : pass('AC 8: A appended a cited answer');

        // --- the core negative, six ways -------------------------------------
        const bSession = await B.client.from('sessions').select('id').eq('id', sid);
        count(bSession) === 0
          ? pass("AC 4 NEGATIVE: B reads 0 rows of A's session")
          : fail(`AC 4 NEGATIVE: B read ${count(bSession)} of A's sessions — brief AC 2 is BROKEN`);

        const bMessages = await B.client.from('messages').select('id').eq('session_id', sid);
        count(bMessages) === 0
          ? pass("AC 4 NEGATIVE: B reads 0 rows of A's messages")
          : fail(`AC 4 NEGATIVE: B read ${count(bMessages)} of A's messages`);

        const bCitations = await B.client.from('citations').select('id').eq('message_id', msg.data.id);
        count(bCitations) === 0
          ? pass("AC 4 NEGATIVE: B reads 0 rows of A's citations")
          : fail(`AC 4 NEGATIVE: B read ${count(bCitations)} of A's citations`);

        const bInsert = await B.client
          .from('messages')
          .insert({ session_id: sid, kind: 'user', body: 'injected', seq: 99 })
          .select('id');
        bInsert.error
          ? pass("AC 4 NEGATIVE: B cannot insert into A's session")
          : fail("AC 4 NEGATIVE: B INSERTED a message into A's session");

        const bDelete = await B.client.from('sessions').delete().eq('id', sid).select('id');
        count(bDelete) === 0
          ? pass("AC 4 NEGATIVE: B's delete of A's session affects 0 rows")
          : fail(`AC 4 NEGATIVE: B deleted ${count(bDelete)} of A's sessions`);

        const bSteal = await B.client.from('sessions').update({ user_id: B.id }).eq('id', sid).select('id');
        count(bSteal) === 0
          ? pass('AC 4 NEGATIVE: an ownership steal affects 0 rows')
          : fail(`AC 4 NEGATIVE: B took ownership of ${count(bSteal)} of A's sessions`);

        const stillThere = await A.client.from('sessions').select('id').eq('id', sid);
        count(stillThere) === 1
          ? pass("AC 4: A's session survived every attempt on it")
          : fail(`AC 4: A's session is gone after B's attempts (${count(stillThere)} rows)`);

        // --- the unauthenticated client (AC 3) --------------------------------
        const anonRead = await stranger.from('sessions').select('id');
        count(anonRead) <= 0
          ? pass('AC 3: an unauthenticated client reads 0 session rows')
          : fail(`AC 3: an unauthenticated client read ${count(anonRead)} session(s)`);

        const anonInsert = await stranger.from('sessions').insert({ title: ANON_PROBE_TITLE }).select('id');
        anonInsert.error
          ? pass(`AC 3: an unauthenticated insert is refused (${anonInsert.error.code ?? 'error'})`)
          : fail('AC 3: an unauthenticated client INSERTED a session');

        await A.client.from('sessions').delete().eq('id', sid);
      }
    }

    // -----------------------------------------------------------------------
    section('ST-A07 / ST-A09 — companies, roster and join codes');
    // -----------------------------------------------------------------------
    if (!applied.companies || !applied.memberships) {
      blocked('company assertions', 'sql/012 not applied');
    } else {
      const created = await A.client.rpc('create_company', { name: 'Verify HVAC Ltd' });
      if (created.error) {
        fail(`AC 4: create_company failed: ${created.error.message}`);
      } else {
        const companyId = created.data;
        pass('AC 4: create_company made the company and the owner membership in one call');

        const direct = await A.client.from('companies').insert({ name: 'Direct Insert Co' }).select('id');
        direct.error
          ? pass('AC 4: a direct insert on companies is refused for everyone')
          : fail('AC 4: a direct insert on companies SUCCEEDED — the chicken-and-egg hole is open');

        // The recursion check has to be live. Grepping the migration proves the
        // policy does not sub-select; only running it proves Postgres agrees.
        const roster = await A.client.from('memberships').select('role').eq('company_id', companyId);
        if (roster.error && /infinite recursion/i.test(roster.error.message)) {
          fail('AC 2: infinite recursion detected in policy for relation "memberships"', 'A policy is sub-selecting its own table. Use the SECURITY DEFINER helpers (§1c).');
        } else if (count(roster) === 1 && roster.data[0].role === 'owner') {
          pass('AC 2/11: the roster reads without recursion, and A is its owner');
        } else {
          fail(`AC 11: expected 1 owner membership, got ${count(roster)}`);
        }

        const strangerCompany = await B.client.from('companies').select('id').eq('id', companyId);
        count(strangerCompany) === 0
          ? pass('AC 5 NEGATIVE: a non-member reads 0 rows of the company, even knowing its uuid')
          : fail(`AC 5 NEGATIVE: a non-member read ${count(strangerCompany)} company row(s)`);

        const strangerRoster = await B.client.from('memberships').select('id').eq('company_id', companyId);
        count(strangerRoster) === 0
          ? pass('AC 5 NEGATIVE: a non-member reads 0 rows of the roster')
          : fail(`AC 5 NEGATIVE: a non-member read ${count(strangerRoster)} membership row(s)`);

        // --- join codes ---------------------------------------------------
        if (!applied.company_join_codes) {
          blocked('join-code assertions', 'sql/013 not applied');
        } else {
          const codeRes = await A.client.rpc('create_join_code', {
            p_company_id: companyId,
            p_expires_days: 14,
            p_max_uses: 1,
          });
          const row = Array.isArray(codeRes.data) ? codeRes.data[0] : codeRes.data;
          if (codeRes.error || !row?.code) {
            fail(`AC 7: create_join_code failed: ${codeRes.error?.message ?? 'no code returned'}`);
          } else {
            // The JS validator against a code the SQL generator actually issued.
            // This is what keeps lib/join-code.mjs honest about sql/013's alphabet.
            isWellFormedJoinCode(row.code)
              ? pass(`AC 2: an RPC-issued code is well-formed Crockford base32 (${row.code.length} chars)`)
              : fail('AC 2: an RPC-issued code failed the shared shape rule — SQL and JS have drifted');

            const memberSees = await B.client.from('company_join_codes').select('id');
            count(memberSees) === 0
              ? pass('AC 3 NEGATIVE: a non-owner reads 0 join codes — a code cannot be discovered by reading rows')
              : fail(`AC 3 NEGATIVE: a non-owner read ${count(memberSees)} join code(s)`);

            const anonSees = await stranger.from('company_join_codes').select('id');
            count(anonSees) <= 0
              ? pass('AC 3 NEGATIVE: an unauthenticated client reads 0 join codes')
              : fail(`AC 3 NEGATIVE: an unauthenticated client read ${count(anonSees)} join code(s)`);

            const bad = await B.client.rpc('redeem_join_code', { code: 'ZZZZZZZZZZ' });
            bad.error?.message === 'join_code_unknown'
              ? pass('AC 5: an unknown code returns its own defined error')
              : fail(`AC 5: unknown code returned ${bad.error?.message ?? 'success'}`);

            const joined = await B.client.rpc('redeem_join_code', { code: row.code });
            joined.error
              ? fail(`AC 4: redemption failed: ${joined.error.message}`)
              : pass('AC 4: B redeemed the code and is now a member');

            const again = await B.client.rpc('redeem_join_code', { code: row.code });
            again.error?.message === 'already_a_member'
              ? pass('AC 5: a second redemption by the same user is refused with `already_a_member`')
              : fail(`AC 5: second redemption returned ${again.error?.message ?? 'success'}`);

            // --- OQ-A1, the guard that matters most -------------------------
            const bSession = await B.client
              .from('sessions')
              .insert({ title: "B's own job" })
              .select('id')
              .single();
            const ownerSees = bSession.error
              ? null
              : await A.client.from('sessions').select('id').eq('id', bSession.data.id);
            if (!ownerSees) {
              blocked('OQ-A1 guard', `could not create B's session: ${bSession.error.message}`);
            } else if (count(ownerSees) === 0) {
              pass("ST-A05 AC 5 NEGATIVE (OQ-A1): the company owner reads 0 rows of a member's session");
            } else {
              fail(
                `ST-A05 AC 5 NEGATIVE (OQ-A1): the company owner read ${count(ownerSees)} of B's sessions`,
                'A company-read policy has appeared on sessions. That requires a signed Stage 0 brief amendment.'
              );
            }

            const memberEdits = await B.client
              .from('companies')
              .update({ name: 'Renamed by a member' })
              .eq('id', companyId)
              .select('id');
            count(memberEdits) === 0
              ? pass('AC 6 NEGATIVE: a member cannot rename the company')
              : fail('AC 6 NEGATIVE: a member renamed the company');

            const memberAdds = await B.client
              .from('memberships')
              .insert({ company_id: companyId, user_id: B.id, role: 'owner' })
              .select('id');
            memberAdds.error || count(memberAdds) === 0
              ? pass('AC 6 NEGATIVE: a member cannot add a membership (including promoting themselves)')
              : fail('AC 6 NEGATIVE: a member INSERTED a membership');

            /*
             * sql/017 — an OWNER cannot add somebody else either.
             *
             * The check above proves a *member* cannot write to `memberships`.
             * It passed while the real hole was open, because the hole needed an
             * owner: `memberships_insert_owner` constrained which company a row
             * went into and never whose membership it was, so anyone could
             * `create_company` and then add a stranger to it. That makes
             * `is_co_member(victim)` true and hands the attacker a standing read
             * of the victim's profile — surviving removal from the shop where
             * they learned the uuid.
             *
             * B owns their own company here, so this is the exact attacker
             * position, and A is the unconsenting subject.
             */
            const ownCompany = await B.client.rpc('create_company', { name: 'Subject Guard Co' });
            if (ownCompany.error) {
              fail(`sql/017: B could not create a company to test with: ${ownCompany.error.message}`);
            } else {
              const victimAdd = await B.client
                .from('memberships')
                .insert({ company_id: ownCompany.data, user_id: A.id, role: 'member' })
                .select('id');
              victimAdd.error || count(victimAdd) === 0
                ? pass('sql/017 NEGATIVE: an owner cannot add a user who did not ask to join')
                : fail('sql/017 NEGATIVE: an owner ADDED another user without consent');

              // The same end by the other road: rewrite an existing row's subject.
              const ownRow = await B.client
                .from('memberships')
                .select('id')
                .eq('company_id', ownCompany.data)
                .eq('user_id', B.id)
                .single();
              if (!ownRow.error) {
                await B.client.from('memberships').update({ user_id: A.id }).eq('id', ownRow.data.id);
                /*
                 * Read the result back with SERVICE ROLE, not with B's client.
                 * B's own select cannot answer this: a successful rewrite points
                 * the row at A, which removes B from the company, which makes the
                 * row invisible to B — so "0 rows" would look identical whether
                 * the write was blocked or whether it worked perfectly. That is a
                 * check that passes hardest exactly when it should fail.
                 */
                const actual = await admin
                  .from('memberships').select('user_id').eq('id', ownRow.data.id).maybeSingle();
                actual.data?.user_id === B.id
                  ? pass("sql/017 NEGATIVE: an owner cannot rewrite a membership's subject")
                  : fail(`sql/017 NEGATIVE: membership subject was rewritten to ${actual.data?.user_id ?? 'gone'}`);
              }
              /*
               * No "role changes still work" check here on purpose. The first
               * attempt demoted B — the *sole* owner of this throwaway company —
               * which `guard_last_owner` correctly refuses, so it failed for a
               * reason that had nothing to do with sql/017's column grant. The
               * capability is already covered properly above, on A's company,
               * where a second member exists: "ST-A08 AC 1: the owner removed B"
               * and the two last-owner guard checks all exercise UPDATE on `role`.
               * A second, weaker copy of an existing assertion is not coverage.
               */

              await admin.from('companies').delete().eq('id', ownCompany.data);
            }

            // --- ST-A08 AC 3, the last-owner guard --------------------------
            const ownerMembership = await A.client
              .from('memberships')
              .select('id')
              .eq('company_id', companyId)
              .eq('user_id', A.id)
              .single();
            if (!ownerMembership.error) {
              const demote = await A.client
                .from('memberships')
                .update({ role: 'member' })
                .eq('id', ownerMembership.data.id)
                .select('id');
              demote.error?.message === 'last_owner'
                ? pass('ST-A08 AC 3: the last owner cannot be demoted')
                : fail(`ST-A08 AC 3: demoting the last owner returned ${demote.error?.message ?? 'success'}`);

              const remove = await A.client
                .from('memberships')
                .delete()
                .eq('id', ownerMembership.data.id)
                .select('id');
              remove.error?.message === 'last_owner'
                ? pass('ST-A08 AC 3: the last owner cannot be removed')
                : fail(`ST-A08 AC 3: removing the last owner returned ${remove.error?.message ?? 'success'}`);
            }

            // --- ST-A08 AC 4/5, removal with the STALE token ----------------
            const bMembership = await A.client
              .from('memberships')
              .select('id')
              .eq('company_id', companyId)
              .eq('user_id', B.id)
              .single();
            if (!bMembership.error) {
              const bSessionsBefore = count(await B.client.from('sessions').select('id'));
              const removed = await A.client.from('memberships').delete().eq('id', bMembership.data.id).select('id');
              if (removed.error) {
                fail(`ST-A08 AC 1: the owner could not remove B: ${removed.error.message}`);
              } else {
                pass('ST-A08 AC 1: the owner removed B');

                // B is NOT signed in again. The token B already holds is the whole
                // point: JWTs cannot be revoked mid-flight, so "immediately" has to
                // mean the policies stop authorizing it on the very next request.
                const afterCompany = await B.client.from('companies').select('id').eq('id', companyId);
                count(afterCompany) === 0
                  ? pass("ST-A08 AC 4 NEGATIVE: B's pre-removal token reads 0 company rows — immediately")
                  : fail(`ST-A08 AC 4 NEGATIVE: B still reads ${count(afterCompany)} company row(s)`);

                const afterRoster = await B.client.from('memberships').select('id').eq('company_id', companyId);
                count(afterRoster) === 0
                  ? pass("ST-A08 AC 4 NEGATIVE: B's pre-removal token reads 0 roster rows")
                  : fail(`ST-A08 AC 4 NEGATIVE: B still reads ${count(afterRoster)} roster row(s)`);

                const afterRpc = await B.client.rpc('create_join_code', { p_company_id: companyId });
                afterRpc.error
                  ? pass('ST-A08 AC 4 NEGATIVE: every company-scoped RPC refuses B')
                  : fail('ST-A08 AC 4 NEGATIVE: B could still mint a join code for the company');

                const bSessionsAfter = count(await B.client.from('sessions').select('id'));
                bSessionsAfter === bSessionsBefore
                  ? pass('ST-A08 AC 5: removal is roster-only — B keeps every session, unchanged')
                  : fail(`ST-A08 AC 5: B's session count changed from ${bSessionsBefore} to ${bSessionsAfter}`);

                const bProfile = await B.client.from('profiles').select('active_company_id').eq('id', B.id).single();
                bProfile.data?.active_company_id === null
                  ? pass('ST-A08 AC 6: B is no longer pointing at a company they cannot read')
                  : fail(`ST-A08 AC 6: B.active_company_id is ${bProfile.data?.active_company_id}`);
              }
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    section('ST-A12 — account deletion');
    // -----------------------------------------------------------------------
    const probe = await A.client.rpc('delete_own_account');
    if (
      probe.error &&
      (probe.error.code === 'PGRST202' || /could not find the function/i.test(probe.error.message))
    ) {
      blocked('deletion assertions', 'sql/014 not applied. Run sql/probe_auth_delete_capability.sql first — see §8.4.');
    } else if (probe.error?.message === 'auth_delete_unavailable') {
      blocked(
        'path (A) refused: a SECURITY DEFINER function may not delete from auth.users on this project',
        'Take path (B), the delete-account Edge Function. See sql/014 and .pipeline/03-backend-accounts.md.'
      );
    } else if (probe.error) {
      fail(`delete_own_account: ${probe.error.message}`);
    } else {
      pass('ST-A12 AC 2: delete_own_account() completed for A');
      // Service role, used to prove ABSENCE. The only correct use of it here.
      const { data: gone } = await admin.auth.admin.getUserById(A.id);
      gone?.user ? fail('ST-A12 AC 2: the auth.users row survived') : pass('ST-A12 AC 2: the auth.users row is gone');
      const leftovers = await admin.from('sessions').select('id').eq('user_id', A.id);
      count(leftovers) === 0
        ? pass('ST-A12 AC 2: no session rows survive the deletion')
        : fail(`ST-A12 AC 2: ${count(leftovers)} session row(s) survived`);
      const idx = made.indexOf(A.id);
      if (idx >= 0) made.splice(idx, 1);
    }
  } catch (e) {
    fail(`harness error: ${e.message}`);
  } finally {
    // -----------------------------------------------------------------------
    section('Teardown');
    // -----------------------------------------------------------------------
    // Runs on failure too, so repeated runs do not accumulate users (ST-A15 AC 3).
    // Sessions first: before the cutover a probe row can end up owned by nobody,
    // and an ownerless row left behind here is exactly what ST-A14 exists to
    // eliminate. Service role, because that is the only client that can see a row
    // whose owner has just been deleted.
    const { error: sweepErr } = await admin
      .from('sessions')
      .delete()
      // 'anon' is the title an early revision of this script used for its
      // unauthenticated probe on 10 Aug 2026, before the titles were made
      // self-identifying. It left one ownerless row behind, which is precisely
      // the thing ST-A14 exists to eliminate, so it is swept here rather than
      // left for the migration to explain.
      .in('title', [VERIFY_TITLE, ANON_PROBE_TITLE, 'anon']);
    if (sweepErr) fail(`could not sweep probe sessions: ${sweepErr.message}`);
    else pass('probe sessions swept (no ownerless row left behind)');

    let stranded = 0;
    for (const id of made) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) stranded++;
    }
    stranded
      ? fail(`${stranded} fixture user(s) could not be deleted`, 'Remove them in Authentication → Users.')
      : pass(`${made.length} fixture user(s) removed`);
  }

  report();
}

function report() {
  console.log('');
  if (failures) {
    console.log(`❌ ${failures} check(s) failed${blockedCount ? `, ${blockedCount} blocked` : ''}.`);
    console.log('   An isolation failure is a Critical defect. Nothing ships past it.\n');
  } else if (blockedCount) {
    console.log(`⏸  ${blockedCount} check(s) BLOCKED on migrations that have not been applied.`);
    console.log('   Blocked is not failed. Apply the SQL in order and re-run.\n');
  } else {
    console.log('✅ Every isolation claim in this run holds, measured with the anon key.\n');
  }
  process.exitCode = failures === 0 ? 0 : 1;
}
