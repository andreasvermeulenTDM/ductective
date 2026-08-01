// scripts/verify-sessions.mjs — exercise the prototype's data path as the APP does.
//
// Uses the ANON key, not service_role. That is the point: it proves the RLS
// policies in sql/002_prototype_sessions.sql actually permit what the app needs
// and nothing more. Verifying this with service_role would prove nothing, because
// service_role bypasses RLS entirely.
//
// Run: npm run verify:sessions

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
let failures = 0;

const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m, hint) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
  if (hint) console.log(`        → ${hint}`);
  failures++;
};

if (!url || !anon) {
  fail('env missing', 'Run with --env-file=.env');
} else {
  const db = createClient(url, anon, { auth: { persistSession: false } });
  const RUN_SQL = 'Run sql/002_prototype_sessions.sql in the Supabase SQL Editor.';

  console.log('\nDuctective — session persistence (anon key, RLS enforced)\n');

  // 1. tables reachable
  const { error: tErr } = await db.from('sessions').select('id').limit(1);
  if (tErr) {
    fail(`sessions table unreachable: ${tErr.message}`, RUN_SQL);
  } else {
    pass('sessions readable via anon + RLS');

    // 2. insert a session
    const { data: session, error: sErr } = await db
      .from('sessions')
      .insert({ title: 'verify: high head pressure', equipment: 'Trane Precedent YSC072' })
      .select('id, title')
      .single();

    if (sErr) {
      fail(`session insert: ${sErr.message}`, RUN_SQL);
    } else {
      pass(`session inserted (${session.id.slice(0, 8)}…)`);

      // 3. messages, both turns
      const { data: msgs, error: mErr } = await db
        .from('messages')
        .insert([
          { session_id: session.id, kind: 'user', body: 'high head pressure', seq: 0 },
          { session_id: session.id, kind: 'answer', body: 'Check condenser coil loading first.', seq: 1 },
        ])
        .select('id, kind, seq');

      if (mErr) {
        fail(`message insert: ${mErr.message}`);
      } else {
        pass(`${msgs.length} messages inserted`);

        // 4. citation attached to the answer
        const answer = msgs.find((m) => m.kind === 'answer');
        const { error: cErr } = await db.from('citations').insert({
          message_id: answer.id,
          source_document: 'RT-SVX23R-EN — Precedent Rooftop IOM',
          page: 84,
          claim: 'High head pressure causes',
          ordinal: 1,
        });
        cErr ? fail(`citation insert: ${cErr.message}`) : pass('citation inserted');

        // 5. read back through the join the app uses
        const { data: readback, error: rErr } = await db
          .from('messages')
          .select('kind, body, seq, citations(source_document, page, ordinal)')
          .eq('session_id', session.id)
          .order('seq');

        if (rErr) {
          fail(`join read: ${rErr.message}`);
        } else {
          const cited = readback.find((m) => m.kind === 'answer')?.citations ?? [];
          readback.length === 2
            ? pass('both turns read back in order')
            : fail(`expected 2 turns, got ${readback.length}`);
          cited.length === 1
            ? pass(`citation resolves: ${cited[0].source_document} p.${cited[0].page}`)
            : fail(`expected 1 citation on the answer, got ${cited.length}`);
        }

        // 6. constraint holds — bad `kind` must be rejected
        const { error: badKind } = await db
          .from('messages')
          .insert({ session_id: session.id, kind: 'nonsense', body: 'x', seq: 99 });
        badKind
          ? pass('invalid message kind rejected by CHECK constraint')
          : fail('invalid message kind was ACCEPTED — the rendering contract is not enforced');

        // 7. cascade delete leaves nothing orphaned
        await db.from('sessions').delete().eq('id', session.id);
        const { data: after } = await db.from('messages').select('id').eq('session_id', session.id);
        (after?.length ?? 0) === 0
          ? pass('cascade delete removed messages with the session')
          : fail(`${after.length} orphaned messages after session delete`);
      }
    }
  }
}

console.log(failures === 0 ? '\n✅ Session persistence works via the anon key.\n' : `\n❌ ${failures} check(s) failed.\n`);
process.exitCode = failures === 0 ? 0 : 1;
