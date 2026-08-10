/**
 * verify-auth-config.mjs — ST-A01. Assert this Supabase project's auth toggles
 * match the decisions the run is built on.
 *
 *   npm run verify:auth
 *
 * Auth calls use the ANON key, because that is the only key the app has. The
 * service-role key is used for exactly one thing — deleting the scratch user this
 * script created — and never to assert anything. An assertion made with a key that
 * bypasses RLS proves nothing, which is the rule `scripts/verify-sessions.mjs`
 * states at the top of its own file.
 *
 * Failures name the exact dashboard toggle. A config check that reports "something
 * is wrong" costs more time than it saves.
 */

import { createClient } from '@supabase/supabase-js';
import { checkAuthConfig, OAUTH_REDIRECT } from '../lib/auth-config.mjs';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;
const pass = (m, d) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}${d ? ` — ${d}` : ''}`);
const fail = (m, d, hint) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}${d ? ` — ${d}` : ''}`);
  if (hint) console.log(`        → ${hint}`);
  failures++;
};

console.log('\nDuctective — Supabase Auth configuration (ST-A01)\n');
console.log(`  OAuth redirect under test: ${OAUTH_REDIRECT}\n`);

if (!url || !anonKey || !serviceKey) {
  fail('env missing', 'EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY', 'Run with --env-file=.env');
} else {
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const anon = createClient(url, anonKey, opts);
  const admin = createClient(url, serviceKey, opts);

  let cleanup = null;
  try {
    const run = await checkAuthConfig({ anon, admin });
    cleanup = run.cleanup;
    for (const c of run.checks) (c.ok ? pass : fail)(c.name, c.detail, c.hint);
  } catch (e) {
    fail('configuration probe threw', e.message);
  } finally {
    if (cleanup) {
      const stranded = await cleanup();
      if (stranded.length) {
        fail(`${stranded.length} scratch user(s) not deleted`, 'delete them in the dashboard', 'Authentication → Users');
      } else {
        pass('scratch users cleaned up via service role');
      }
    }
  }
}

console.log(
  failures === 0
    ? '\n✅ Auth configuration matches the decisions in 02-user-stories-accounts.md §2.\n'
    : `\n❌ ${failures} check(s) failed. Nothing downstream of ST-A01 should be trusted until these are green.\n`
);
process.exitCode = failures === 0 ? 0 : 1;
