// scripts/verify-connection.mjs — proves the Supabase rail is live.
// Run: npm run verify        (add ALLOW_STUBS=true to also exercise the stubs)
//
// Prints statuses only. It must never print a key value.

import { supabaseAdmin, embed, complete, usedMocks, EMBED_DIM } from '../lib/clients.mjs';

const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m, hint) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
  if (hint) console.log(`        → ${hint}`);
  failures++;
};
const skip = (m) => console.log(`  \x1b[90mSKIP\x1b[0m  ${m}`);
let failures = 0;

console.log('\nDuctective — connection verification\n');

// --- env ------------------------------------------------------------------
console.log('Environment');
for (const k of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  const v = process.env[k];
  v ? pass(`${k} set (${v.length} chars)`) : fail(`${k} missing`, 'Copy .env.example to .env and fill it in.');
}
if (process.env.EXPO_PUBLIC_SUPABASE_URL?.includes('/rest/v1')) {
  fail('EXPO_PUBLIC_SUPABASE_URL has a path', 'Use the origin only — supabase-js appends /rest/v1 itself.');
}

// --- supabase -------------------------------------------------------------
console.log('\nSupabase');
let db;
try {
  db = supabaseAdmin();
  pass('client constructed');
} catch (e) {
  fail('client construction', e.message);
}

if (db) {
  const { data, error } = await db.rpc('ductective_health');
  if (error) {
    fail(`health probe: ${error.message}`, 'Run sql/001_bootstrap.sql in the Supabase SQL Editor.');
  } else {
    pass(`postgres ${data.postgres}`);
    data.pgvector
      ? pass(`pgvector ${data.pgvector} installed`)
      : fail('pgvector not installed', 'Run sql/001_bootstrap.sql in the Supabase SQL Editor.');
    pass(`public schema: ${data.public_tables} base table(s)`);
  }
}

// --- embeddings & completion ----------------------------------------------
console.log('\nEmbeddings & completion');
for (const [name, fn] of [
  ['voyage', () => embed(['rooftop unit short cycling'], { inputType: 'query' })],
  ['anthropic', () => complete({ messages: [{ role: 'user', content: 'test' }] })],
]) {
  try {
    const r = await fn();
    const how = r.stub ? 'STUB' : 'live';
    const detail = r.embeddings
      ? ` — ${r.model}, ${r.embeddings[0].length}/${EMBED_DIM} dims, ${r.tokens} tokens`
      : ` — ${r.model}`;
    pass(`${name} (${how})${detail}`);
  } catch (e) {
    e.message.includes('ALLOW_STUBS') ? skip(`${name} — no key, stub not enabled`) : fail(name, e.message);
  }
}

// --- verdict --------------------------------------------------------------
const stubs = usedMocks();
if (stubs.length) {
  console.log(`\n  Stubs exercised: ${stubs.join(', ')} — no output above them is a real result.`);
}
console.log(failures === 0 ? '\n✅ Supabase rail is live.\n' : `\n❌ ${failures} check(s) failed.\n`);

// exitCode, not exit(): supabase-js leaves an undici handle open, and tearing the
// loop down under it trips a libuv assertion on Windows. Let Node drain instead.
process.exitCode = failures === 0 ? 0 : 1;
